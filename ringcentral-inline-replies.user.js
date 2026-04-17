// ==UserScript==
// @name         RingCentral Inline Replies (Flatten / Restore)
// @namespace    user.ringcentral.inline-replies
// @version      1.5.2
// @author       Anna-SAP
// @description  Flatten thread replies inline under parent messages on RingCentral (preserving text / files / link previews / emoji reactions / user avatars; collapses unrenderable image/video previews to single-line chips), with Ctrl+F searchable content and persistent state across reloads. Caps at 30 replies per thread.
// @match        https://app.ringcentral.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://gist.githubusercontent.com/Anna-SAP/b6bcda56677578241d30949e53578777/raw/ringcentral-inline-replies.user.js
// @downloadURL  https://gist.githubusercontent.com/Anna-SAP/b6bcda56677578241d30949e53578777/raw/ringcentral-inline-replies.user.js
// @supportURL   https://gist.github.com/Anna-SAP/b6bcda56677578241d30949e53578777
// ==/UserScript==

(function () {
  'use strict';

  const SEL = {
    parentCardWrapper: '.conversation-card-wrapper[data-id]',
    parentCardPostTree: '[data-test-automation-id="conversation-reply-post-tree"][data-id]',
    replyBtnOld: '[data-test-automation-id="conversation-parent-post-reply-button"]',
    replyBtnNew: '[data-test-automation-id="conversation-reply-parent-view-all-replies"]',
    drawer: '[role="complementary"]',
    drawerCloseBtn: '[data-test-automation-id="rightRail-reply-drawer-close-button"]',
    replyCardInDrawer: '[data-name="reply-window-conversation-card"][data-id]',
    styledCard: '[data-test-automation-id="styled-conversation-card"]',
    imagePreview: '[data-test-automation-class="file-item-image-preview"]',
    emojiReactionItem: '[data-test-automation-class="emoji-reaction-item"]',
    emojiMart: '.emoji-mart-emoji',
    votedCount: '[data-test-automation-class="voted-count"]',
    avatarContainer: '.RcAvatar-avatarContainer',
  };

  // 注意：emoji-reaction-quick-pick / emoji-snackbar-more-button 是“+”添加按钮，继续剥掉；
  // 真实的 reactions 用 emoji-reaction-item（class，不是 id）承载，由 restoreEmojiReactions 单独处理。
  const NOISE_TAIDS = [
    'reply-post-checkbox',
    'cardHeaderRightSection',
    'footer-emoji-open-more',
    'action-bar',
    'emoji-reaction-quick-pick',
    'emoji-snackbar-more-button',
    'message-action-forward',
    'message-action-quote',
    'message-action-mark-reply-as-unread',
    'message-action-more',
    'message-toolbar',
    'message-toolbar-more',
    'ai-writer-inline-shortcut-button',
    'jumpToConversation',
    'conversation-message-editTag',
    'fileActionMore',
    'imagePopOutButton',
    'download-button',
  ];

  const STORAGE_KEY = 'rcInlineRepliesMode';
  const INJECTED_ATTR = 'data-rc-inline-replies-injected';
  const INJECTED_CLASS = 'rc-inline-replies-block';
  const REPLY_LIMIT = 30;

  const log = (...a) => console.log('%c[RC-Inline]', 'color:#4a90e2', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let isProcessing = false;
  let isCancelled = false;
  let floatingBtn = null;

  const getMode = () => localStorage.getItem(STORAGE_KEY) || 'expanded';
  const setMode = (m) => localStorage.setItem(STORAGE_KEY, m);

  const isDrawerOpen = () => {
    const d = document.querySelector(SEL.drawer);
    if (!d) return false;
    const r = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    return r.width > 200 && cs.visibility !== 'hidden' && cs.display !== 'none' && !!d.offsetParent;
  };

  const waitUntil = async (fn, timeoutMs = 4000, stepMs = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isCancelled) return false;
      if (fn()) return true;
      await sleep(stepMs);
    }
    return false;
  };

  const closeDrawer = async () => {
    if (!isDrawerOpen()) return true;
    const btn = document.querySelector(SEL.drawerCloseBtn);
    if (btn) btn.click();
    return await waitUntil(() => !isDrawerOpen(), 2000);
  };

  const getParentCardFromButton = (btn) =>
    btn.closest(SEL.parentCardWrapper) || btn.closest(SEL.parentCardPostTree);
  const getParentDataId = (card) => card && card.getAttribute('data-id');

  const scanReplyButtons = () => {
    const nodes = document.querySelectorAll(`${SEL.replyBtnOld}, ${SEL.replyBtnNew}`);
    return Array.from(nodes).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  };

  // 紧凑 chip：用来替换无法渲染的富内容块（图片 / 视频 / iframe 等）
  const makeChip = (icon, label, onOpenOriginal, parentDataId) => {
    const chip = document.createElement('span');
    chip.className = 'rc-inline-chip';
    chip.style.cssText = [
      'display:inline-flex','align-items:center','gap:6px',
      'padding:3px 10px','margin:2px 4px 2px 0',
      'background:rgba(74,144,226,0.10)','border:1px solid rgba(74,144,226,0.35)',
      'border-radius:12px','font-size:12px','color:#2a5d9e','cursor:pointer',
      'max-width:100%','overflow:hidden','text-overflow:ellipsis','white-space:nowrap',
    ].join(';');
    chip.title = `${label} — click to open original drawer`;
    chip.textContent = `${icon} ${label}`;
    if (onOpenOriginal) {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        try { onOpenOriginal(parentDataId); } catch (err) { log('chip click failed', err); }
      });
    }
    return chip;
  };

  // ---- 头像快照：抓 canvas 像素，克隆后替换为 <img src="data:..."> ----
  // 必须在 cloneNode 之前对“活”的 card 调用，因为克隆后的 canvas 里没有像素。
  const snapshotAvatars = (liveCard) => {
    const canvases = liveCard.querySelectorAll(`${SEL.avatarContainer} canvas`);
    const shots = [];
    canvases.forEach((cv) => {
      let dataUrl = '';
      try {
        // 仅 toDataURL 即可；若 canvas 被 CORS 污染会抛 SecurityError
        dataUrl = cv.toDataURL('image/png');
      } catch (e) {
        log('avatar toDataURL failed', e && e.message);
      }
      shots.push({
        dataUrl,
        w: cv.width || 64,
        h: cv.height || 64,
        styleHeight: cv.style && cv.style.height || '100%',
      });
    });
    return shots;
  };

  const restoreAvatars = (clonedRoot, snapshots) => {
    if (!snapshots || !snapshots.length) return;
    const canvases = clonedRoot.querySelectorAll(`${SEL.avatarContainer} canvas`);
    canvases.forEach((cv, i) => {
      const shot = snapshots[i];
      if (!shot || !shot.dataUrl) return; // 抓取失败就保持原占位
      const img = document.createElement('img');
      img.src = shot.dataUrl;
      img.alt = '';
      img.decoding = 'async';
      img.style.cssText = [
        'width:100%','height:100%',
        'border-radius:50%','object-fit:cover',
        'display:block',
      ].join(';');
      cv.replaceWith(img);
    });
  };

  // ---- Emoji reaction 重建：把 canvas 渲染的 emoji + count 还原成可见 pill ----
  const unifiedToEmoji = (unified) => {
    if (!unified) return '';
    try {
      const cps = unified.split('-').map((p) => parseInt(p, 16)).filter((n) => !isNaN(n));
      if (!cps.length) return '';
      return String.fromCodePoint(...cps);
    } catch (_) { return ''; }
  };

  const extractEmojiGlyph = (em) => {
    if (!em) return '';
    const aria = em.getAttribute('aria-label') || '';
    if (aria) {
      const head = aria.split(',')[0].trim();
      if (head) return head;
    }
    return unifiedToEmoji(em.getAttribute('data-unified'));
  };

  const extractEmojiName = (em, btn) => {
    const aria = em && em.getAttribute('aria-label');
    if (aria && aria.includes(',')) return aria.split(',').slice(1).join(',').trim();
    const btnAria = btn && btn.getAttribute('aria-label');
    if (btnAria) return btnAria.split(':')[0].trim();
    return 'reaction';
  };

  const buildReactionPill = (glyph, count, name) => {
    const pill = document.createElement('span');
    pill.className = 'rc-inline-reaction';
    pill.title = name ? `${name}${count ? ' · ' + count : ''}` : (count || '');
    pill.style.cssText = [
      'display:inline-flex','align-items:center','gap:4px',
      'padding:2px 8px','margin:2px 4px 2px 0',
      'background:rgba(74,144,226,0.08)','border:1px solid rgba(74,144,226,0.30)',
      'border-radius:12px','font-size:12px','line-height:1.4','color:#333',
      'vertical-align:middle','user-select:none',
    ].join(';');
    const g = document.createElement('span');
    g.style.cssText = 'font-size:14px;line-height:1;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;';
    g.textContent = glyph || '';
    pill.appendChild(g);
    if (count) {
      const c = document.createElement('span');
      c.style.cssText = 'font-size:11px;color:#555;font-weight:500;';
      c.textContent = count;
      pill.appendChild(c);
    }
    return pill;
  };

  const restoreEmojiReactions = (root) => {
    const items = root.querySelectorAll(SEL.emojiReactionItem);
    items.forEach((btn) => {
      const em = btn.querySelector(SEL.emojiMart);
      const btnAria = btn.getAttribute('aria-label') || '';
      // “+ 添加表情”按钮共用同一个 class 但没有 .emoji-mart-emoji 子节点 + aria-label 为空，剥掉
      if (!em || !btnAria) {
        btn.remove();
        return;
      }
      const glyph = extractEmojiGlyph(em);
      const countEl = btn.querySelector(SEL.votedCount);
      const count = countEl ? (countEl.textContent || '').trim() : '';
      const name = extractEmojiName(em, btn);
      // 兜底：取不到字形就丢弃，绝不渲染 ❓ 占位符
      if (!glyph) { btn.remove(); return; }
      const pill = buildReactionPill(glyph, count, name);
      btn.replaceWith(pill);
    });
  };

  const sanitizeClone = (node, openOriginalFn, parentDataId) => {
    // 1) 先重建 emoji reactions（必须放在 noise 删除之前，避免误删它们的祖先容器）
    restoreEmojiReactions(node);

    // 2) 按 taid 移除噪声
    NOISE_TAIDS.forEach((t) => {
      node.querySelectorAll(`[data-test-automation-id="${t}"]`).forEach((n) => n.remove());
    });

    // 3) 图片预览（canvas 渲染，克隆后必为空白）→ 替换成 chip
    node.querySelectorAll(SEL.imagePreview).forEach((preview) => {
      const aria = preview.getAttribute('aria-label') || '';
      const name = aria.replace(/^Image name:\s*/i, '').trim() || 'image';
      const chip = makeChip('🖼️', name, openOriginalFn, parentDataId);
      preview.replaceWith(chip);
    });

    // 4) video / iframe → chip
    node.querySelectorAll('video, iframe').forEach((m) => {
      const label = m.tagName === 'VIDEO' ? 'video attachment' : 'embedded content';
      const chip = makeChip('🎬', label, openOriginalFn, parentDataId);
      m.replaceWith(chip);
    });

    // 5) 残留的 checkbox / radio
    node.querySelectorAll('input').forEach((n) => {
      if (/^(checkbox|radio)$/i.test(n.type)) n.remove();
    });

    // 6) 让内容可被 Ctrl+F 搜到
    node.querySelectorAll('[tabindex="-1"]').forEach((n) => n.removeAttribute('tabindex'));
    node.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.removeAttribute('aria-hidden'));

    // 7) 兜底：空大容器 → chip
    const isEmptyBig = (el) => {
      if (el.children.length === 0) return false;
      const text = (el.textContent || '').trim();
      if (text.length > 0) return false;
      const hasMedia = el.querySelector('img, svg use, picture source') !== null;
      if (hasMedia) return false;
      const w = parseInt(el.getAttribute('width') || '0', 10);
      const h = parseInt(el.getAttribute('height') || '0', 10);
      return w > 100 && h > 100;
    };
    node.querySelectorAll('div[width][height]').forEach((el) => {
      if (isEmptyBig(el)) {
        const chip = makeChip('📎', 'attachment preview', openOriginalFn, parentDataId);
        el.replaceWith(chip);
      }
    });

    return node;
  };

  const buildInlineBlock = ({ clonedNodes, totalReplies, originalBtn, parentDataId, openOriginalFn }) => {
    const wrap = document.createElement('div');
    wrap.className = INJECTED_CLASS;
    wrap.style.cssText = [
      'margin:4px 0 8px 56px','padding:8px 12px',
      'border-left:3px solid #4a90e2','background:rgba(74,144,226,0.06)',
      'border-radius:4px','font-size:13px','line-height:1.5',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'font-weight:600;color:#4a90e2;margin-bottom:6px;font-size:11px;letter-spacing:0.5px;';
    const shown = clonedNodes.length;
    header.textContent = `INLINE VIEW · ${shown}${shown < totalReplies ? ' / ' + totalReplies : ''} ${totalReplies === 1 ? 'REPLY' : 'REPLIES'}`;
    wrap.appendChild(header);

    clonedNodes.forEach((n, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px 0;' + (i === 0 ? '' : 'border-top:1px dashed rgba(0,0,0,0.08);');
      row.appendChild(n);
      wrap.appendChild(row);
    });

    if (shown < totalReplies) {
      const more = document.createElement('a');
      more.href = '#';
      more.style.cssText = 'display:inline-block;margin-top:8px;padding:4px 10px;background:#4a90e2;color:#fff;border-radius:4px;font-size:12px;text-decoration:none;cursor:pointer;';
      more.textContent = `… +${totalReplies - shown} more replies — open original drawer`;
      more.addEventListener('click', (e) => { e.preventDefault(); openOriginalFn(parentDataId); });
      wrap.appendChild(more);
    }

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:6px;font-size:10px;color:#888;';
    hint.textContent = 'searchable with Ctrl+F · click any 🖼️/🎬/📎 chip to view in original drawer';
    wrap.appendChild(hint);

    return wrap;
  };

  // 根据 parent data-id 在当前页面找原始 "N replies" 按钮并点一下
  const openOriginalDrawerByParentId = (parentDataId) => {
    if (!parentDataId) return;
    const card =
      document.querySelector(`${SEL.parentCardWrapper}[data-id="${parentDataId}"]`) ||
      document.querySelector(`${SEL.parentCardPostTree}[data-id="${parentDataId}"]`);
    if (!card) { log('parent card not in DOM any more; please scroll to it and retry'); return; }
    const btn = card.querySelector(SEL.replyBtnNew) || card.querySelector(SEL.replyBtnOld);
    if (btn) btn.click();
  };

  const processOneButton = async (btn) => {
    if (isCancelled) return { ok: false, reason: 'cancelled' };
    const parentCard = getParentCardFromButton(btn);
    const parentId = getParentDataId(parentCard);
    if (!parentCard || !parentId) return { ok: false, reason: 'no-parent' };
    if (parentCard.nextElementSibling?.getAttribute?.(INJECTED_ATTR) === parentId) {
      return { ok: true, skipped: true };
    }
    if (isDrawerOpen()) { await closeDrawer(); await sleep(200); }
    if (isCancelled) return { ok: false, reason: 'cancelled' };

    btn.click();
    const opened = await waitUntil(isDrawerOpen, 3500);
    if (isCancelled) { await closeDrawer(); return { ok: false, reason: 'cancelled' }; }
    if (!opened) return { ok: false, reason: 'drawer-not-open' };
    await sleep(500);
    if (isCancelled) { await closeDrawer(); return { ok: false, reason: 'cancelled' }; }

    const drawer = document.querySelector(SEL.drawer);
    if (!drawer) return { ok: false, reason: 'no-drawer' };
    const allCards = Array.from(drawer.querySelectorAll(SEL.replyCardInDrawer));
    if (allCards.length === 0) { await closeDrawer(); return { ok: false, reason: 'no-reply-cards' }; }

    const replyCards = allCards.slice(1);
    const totalReplies = replyCards.length;
    const toClone = replyCards.slice(0, REPLY_LIMIT);

    const clonedNodes = toClone.map((c) => {
      const inner = c.querySelector(SEL.styledCard) || c;
      // 关键：必须在 cloneNode 之前抓 live canvas 像素
      const avatarShots = snapshotAvatars(inner);
      const clone = inner.cloneNode(true);
      restoreAvatars(clone, avatarShots);
      sanitizeClone(clone, openOriginalDrawerByParentId, parentId);
      return clone;
    });

    if (isCancelled) { await closeDrawer(); return { ok: false, reason: 'cancelled' }; }

    if (parentCard.nextElementSibling?.classList?.contains(INJECTED_CLASS)) {
      parentCard.nextElementSibling.remove();
    }

    const block = buildInlineBlock({
      clonedNodes, totalReplies, originalBtn: btn,
      parentDataId: parentId, openOriginalFn: openOriginalDrawerByParentId,
    });
    block.setAttribute(INJECTED_ATTR, parentId);
    parentCard.parentNode.insertBefore(block, parentCard.nextSibling);

    await closeDrawer();
    await sleep(150);
    return { ok: true, count: clonedNodes.length, total: totalReplies };
  };

  const flattenAll = async () => {
    if (isProcessing) return;
    isProcessing = true; isCancelled = false; updateFloatingBtn('working');
    try {
      if (isDrawerOpen()) await closeDrawer();
      let safety = 0;
      while (safety++ < 200) {
        if (isCancelled) break;
        if (getMode() !== 'collapsed' && safety > 1) break;
        const buttons = scanReplyButtons().filter((b) => {
          const card = getParentCardFromButton(b);
          const id = getParentDataId(card);
          if (!card || !id) return false;
          const next = card.nextElementSibling;
          return !(next && next.getAttribute?.(INJECTED_ATTR) === id);
        });
        if (buttons.length === 0) break;
        const r = await processOneButton(buttons[0]);
        log('processed', r);
        if (isCancelled) break;
        await sleep(120);
      }
      if (!isCancelled) setMode('collapsed');
    } finally {
      isProcessing = false;
      if (isCancelled) {
        document.querySelectorAll(`.${INJECTED_CLASS}`).forEach((n) => n.remove());
        await closeDrawer();
      }
      updateFloatingBtn();
    }
  };

  const restoreOrigin = async () => {
    isCancelled = true; setMode('expanded');
    document.querySelectorAll(`.${INJECTED_CLASS}`).forEach((n) => n.remove());
    if (isDrawerOpen()) await closeDrawer();
    updateFloatingBtn();
  };

  const createFloatingBtn = () => {
    if (document.getElementById('rc-inline-replies-fab')) return;
    const btn = document.createElement('button');
    btn.id = 'rc-inline-replies-fab';
    btn.style.cssText = [
      'position:fixed','right:24px','bottom:90px','z-index:999999',
      'padding:10px 18px','border:none','border-radius:999px',
      'background:#4a90e2','color:#fff','font:600 13px system-ui','cursor:pointer',
      'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
      'display:flex','align-items:center','gap:6px',
    ].join(';');
    btn.addEventListener('click', () => {
      if (getMode() === 'collapsed' || isProcessing) restoreOrigin();
      else flattenAll();
    });
    document.body.appendChild(btn);
    floatingBtn = btn;
    updateFloatingBtn();
  };

  const updateFloatingBtn = (state) => {
    if (!floatingBtn) return;
    if (state === 'working') {
      floatingBtn.textContent = '⏳ Working… (click to cancel)';
      floatingBtn.style.opacity = '0.85';
      return;
    }
    floatingBtn.style.opacity = '1';
    floatingBtn.textContent =
      getMode() === 'collapsed' ? '↩️ Back to origin replies view' : '📂 Flatten all replies';
  };

  let reapplyTimer = null;
  const scheduleReapplyIfCollapsed = () => {
    if (isProcessing) return;
    clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(() => {
      if (getMode() !== 'collapsed') return;
      if (isProcessing) return;
      flattenAll();
    }, 900);
  };

  const observer = new MutationObserver(() => {
    createFloatingBtn();
    if (getMode() === 'collapsed') scheduleReapplyIfCollapsed();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const hookHistory = (method) => {
    const orig = history[method];
    history[method] = function () {
      const ret = orig.apply(this, arguments);
      window.dispatchEvent(new Event('rc-locationchange'));
      return ret;
    };
  };
  hookHistory('pushState'); hookHistory('replaceState');
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('rc-locationchange')));
  window.addEventListener('rc-locationchange', () => {
    isCancelled = true;
    document.querySelectorAll(`.${INJECTED_CLASS}`).forEach((n) => n.remove());
    setTimeout(() => { if (getMode() === 'collapsed') scheduleReapplyIfCollapsed(); }, 1200);
  });

  const init = () => {
    createFloatingBtn();
    if (getMode() === 'collapsed') {
      setTimeout(() => { if (getMode() === 'collapsed') flattenAll(); }, 1500);
    }
  };
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();