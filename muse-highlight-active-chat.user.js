// ==UserScript==
// @name         Muse Highlight Active Chat
// @name:zh-CN   Muse 当前会话高亮
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Make the currently open Muse chat in the left sidebar impossible to miss: bright yellow background, bold text, orange border, auto-scroll into view, plus a floating pill showing the full chat title.
// @description:zh-CN 把 muse.ai 左侧列表里当前打开的会话涂成亮黄色、加粗、加橙色边框，列表长时自动滚到它那一行，页面顶部再浮一个写着完整会话名的小条，不用再靠淡淡的浅灰底去找。
// @author       Anna-SAP
// @match        https://muse.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=muse.ai
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/muse-highlight-active-chat.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/muse-highlight-active-chat.user.js
// ==/UserScript==

// NOTE: this script deliberately does not depend on Muse's sidebar class
// names. It matches the sidebar link whose href contains the thread ID
// from the address bar, with aria-current="page" as fallback.

(function () {
  'use strict';

  // ---- Tune these colours if you like ----
  var BG = '#ffeb00';        // bright yellow, like your screenshot
  var TEXT = '#000000';
  var BORDER = '#ff9800';

  var STYLE_ID = 'muse-active-chat-highlight-style';
  var PILL_ID = 'muse-active-chat-pill';

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.muse-active-chat-strong {',
      '  background: ' + BG + ' !important;',
      '  color: ' + TEXT + ' !important;',
      '  font-weight: 700 !important;',
      '  border-left: 4px solid ' + BORDER + ' !important;',
      '  border-radius: 6px !important;',
      '  box-shadow: inset 0 0 0 2px ' + BORDER + ' !important;',
      '}',
      '.muse-active-chat-strong * {',
      '  color: ' + TEXT + ' !important;',
      '  font-weight: 700 !important;',
      '}',
      '#' + PILL_ID + ' {',
      '  position: fixed; top: 10px; left: 50%; transform: translateX(-50%);',
      '  z-index: 999999; background: ' + BG + '; color: ' + TEXT + ';',
      '  font-weight: 700; font-size: 14px; padding: 6px 14px; border-radius: 999px;',
      '  border: 2px solid ' + BORDER + '; box-shadow: 0 2px 10px rgba(0,0,0,.25);',
      '  max-width: 70vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
      '  pointer-events: none; font-family: sans-serif;',
      '}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function currentThreadId() {
    var m = location.pathname.match(/\/thread\/([0-9a-f-]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  function highlight() {
    injectCSS();
    var id = currentThreadId();
    if (!id) return;

    // Remove old highlight
    document.querySelectorAll('.muse-active-chat-strong').forEach(function (el) {
      el.classList.remove('muse-active-chat-strong');
    });

    // Most reliable hook: the sidebar link whose href is /thread/<current id>.
    // Fall back to aria-current="page" if the href match is not found.
    var links = Array.from(document.querySelectorAll('a[href*="/thread/"]'));
    var target = links.find(function (a) {
      return (a.getAttribute('href') || '').toLowerCase().indexOf(id) !== -1;
    });
    if (!target) {
      target = document.querySelector('[aria-current="page"]');
    }
    if (!target) return;

    // Highlight the link itself and its closest list-item / row container.
    var row = target.closest('li, [role="menuitem"], div') || target;
    // Prefer the widest sensible ancestor that is still inside the sidebar:
    // walk up at most 3 levels while the element is narrow and contains the link text.
    var el = target;
    for (var i = 0; i < 3; i++) {
      var p = el.parentElement;
      if (!p || p === document.body) break;
      // Stop if parent looks like the whole sidebar / nav.
      if (p.querySelectorAll('a[href*="/thread/"]').length > 1) break;
      el = p;
    }
    el.classList.add('muse-active-chat-strong');
    row.classList.add('muse-active-chat-strong');

    // Auto-scroll the sidebar item into view (only if it is off-screen).
    try {
      var r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch (e) {}

    // Floating pill with the full title (sidebar truncates it with "...").
    var title = (target.textContent || '').trim().replace(/\s+/g, ' ');
    var pill = document.getElementById(PILL_ID);
    if (!pill) {
      pill = document.createElement('div');
      pill.id = PILL_ID;
      document.body.appendChild(pill);
    }
    if (title) pill.textContent = '当前会话：' + title;
  }

  // Re-run on SPA navigation (Muse changes URL without a full reload)
  // and whenever the sidebar re-renders.
  var lastUrl = location.href;
  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(highlight, 300);
      setTimeout(highlight, 1000);
    }
  }
  var _pushState = history.pushState;
  history.pushState = function () { _pushState.apply(this, arguments); checkUrlChange(); };
  var _replaceState = history.replaceState;
  history.replaceState = function () { _replaceState.apply(this, arguments); checkUrlChange(); };
  window.addEventListener('popstate', checkUrlChange);

  var observer = new MutationObserver(function () { highlight(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  highlight();
  setTimeout(highlight, 800);
  setTimeout(highlight, 2000);
})();
