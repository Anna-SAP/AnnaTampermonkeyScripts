// ==UserScript==
// @name         Muse Highlight Active Chat
// @name:zh-CN   Muse 当前会话高亮
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.1
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

// v1.0.1 fix for the v1.0.0 bug: v1.0.0 fell back to [aria-current="page"]
// when no sidebar link matched, and that matched the Chat icon in the
// left icon rail; the ancestor walk-up then painted the whole rail
// yellow, and the pill was empty because the icon has no text.
// v1.0.1 therefore:
//   - removes the aria-current fallback entirely,
//   - never climbs ancestors (no closest('div'), no walk-up),
//   - only ever paints an element whose own box is row-sized
//     (width <= 500px, height <= 120px) - a whole rail/nav fails this
//     check and is left alone,
//   - uses document.title as the second strategy, matching a leaf
//     element in the left 500px whose text equals the title,
//   - only shows the floating pill when it has a real, non-empty title.
// If neither strategy finds a row-sized target, the script paints
// nothing and logs why in the console ([MuseHighlight]) instead of
// guessing. Open DevTools (F12) > Console to see it.

(function () {
  'use strict';

  // ---- Tune these colours if you like ----
  var BG = '#ffeb00';
  var TEXT = '#000000';
  var BORDER = '#ff9800';

  var STYLE_ID = 'muse-active-chat-highlight-style';
  var PILL_ID = 'muse-active-chat-pill';
  var TAG = '[MuseHighlight]';

  function log() {
    try { console.log.apply(console, [TAG].concat(Array.prototype.slice.call(arguments))); } catch (e) {}
  }

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

  // document.title is usually the chat name, e.g. "管理过长的旁聊列表".
  // Strip a trailing site suffix if one is present.
  function pageTitle() {
    var t = (document.title || '').trim();
    t = t.replace(/\s*[|\-–—]\s*Muse\s*$/i, '').trim();
    return t;
  }

  // Row-sized only: a sidebar row is a few hundred px wide and one
  // line tall. Anything wider/taller (a nav, an aside, the whole
  // sidebar, the icon rail) must never be painted.
  function isRowSized(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.width <= 500 && r.height > 0 && r.height <= 120;
  }

  function paint(el, how) {
    if (!el || !isRowSized(el)) {
      log('refusing to paint (not row-sized):', how, el && el.tagName, el && el.className);
      return null;
    }
    el.classList.add('muse-active-chat-strong');
    // Only a real <li> row may also be painted, and only if it too
    // is row-sized. Never a generic <div> ancestor.
    var li = el.closest ? el.closest('li') : null;
    if (li && li !== el && isRowSized(li)) li.classList.add('muse-active-chat-strong');
    var r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    }
    log('painted via', how, el.tagName, el.className, JSON.stringify((el.textContent || '').trim().slice(0, 60)));
    return el;
  }

  function showPill(title) {
    var pill = document.getElementById(PILL_ID);
    if (!title) {
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = PILL_ID;
      document.body.appendChild(pill);
    }
    pill.textContent = '当前会话：' + title;
  }

  function highlight() {
    injectCSS();
    var id = currentThreadId();
    var title = pageTitle();
    if (!id && !title) return;

    document.querySelectorAll('.muse-active-chat-strong').forEach(function (el) {
      el.classList.remove('muse-active-chat-strong');
    });

    var painted = null;

    // Strategy A: a sidebar link whose href contains the thread ID.
    if (id) {
      var links = Array.from(document.querySelectorAll('a[href*="/thread/"]'));
      var link = links.find(function (a) {
        return (a.getAttribute('href') || '').toLowerCase().indexOf(id) !== -1;
      });
      log('strategy A: thread links found:', links.length, 'match:', !!link);
      if (link) painted = paint(link, 'href-match');
    }

    // Strategy B: a leaf element in the left 500px whose text is
    // exactly the page title. Leaf = no child element carries the
    // same text, so we paint the text itself, not a big container.
    if (!painted && title) {
      var candidates = Array.from(document.querySelectorAll('body *')).filter(function (el) {
        var r;
        try { r = el.getBoundingClientRect(); } catch (e) { return false; }
        if (r.left > 500 || r.width < 40 || r.width > 500 || r.height < 16 || r.height > 120) return false;
        if ((el.textContent || '').trim() !== title) return false;
        var kids = Array.from(el.children || []).some(function (c) {
          return (c.textContent || '').trim() === title;
        });
        return !kids;
      });
      log('strategy B: title =', JSON.stringify(title), 'candidates:', candidates.length);
      if (candidates.length) painted = paint(candidates[0], 'title-match');
    }

    if (!painted) {
      log('no row-sized target found; painting nothing. threadId =', id, 'title =', JSON.stringify(title));
      showPill(null);
      return;
    }
    showPill(title || (painted.textContent || '').trim());
  }

  // Debug helper for the console: run __museHighlightDebug() in
  // DevTools and paste the result back if the highlight still lands
  // in the wrong place.
  window.__museHighlightDebug = function () {
    var id = currentThreadId();
    var info = {
      url: location.href,
      threadId: id,
      title: pageTitle(),
      threadLinks: Array.from(document.querySelectorAll('a[href*="/thread/"]')).slice(0, 5).map(function (a) {
        var r = a.getBoundingClientRect();
        return { href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 40), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      }),
      ariaCurrent: Array.from(document.querySelectorAll('[aria-current="page"]')).map(function (el) {
        var r = el.getBoundingClientRect();
        return { tag: el.tagName, cls: String(el.className).slice(0, 80), text: (el.textContent || '').trim().slice(0, 40), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      })
    };
    if (info.title) {
      info.titleMatches = Array.from(document.querySelectorAll('body *')).filter(function (el) {
        return (el.textContent || '').trim() === info.title;
      }).slice(0, 5).map(function (el) {
        var r = el.getBoundingClientRect();
        return { tag: el.tagName, cls: String(el.className).slice(0, 120), html: el.outerHTML.slice(0, 300), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      });
    }
    console.log(TAG, info);
    return info;
  };

  // Re-run on SPA navigation (Muse changes URL without a full reload)
  // and whenever the sidebar re-renders, debounced so the class
  // change itself does not re-trigger endlessly.
  var lastUrl = location.href;
  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(highlight, 300);
  }
  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      schedule();
      setTimeout(highlight, 1000);
    }
  }
  var _pushState = history.pushState;
  history.pushState = function () { _pushState.apply(this, arguments); checkUrlChange(); };
  var _replaceState = history.replaceState;
  history.replaceState = function () { _replaceState.apply(this, arguments); checkUrlChange(); };
  window.addEventListener('popstate', checkUrlChange);

  var observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  highlight();
  setTimeout(highlight, 800);
  setTimeout(highlight, 2000);
})();
