// ==UserScript==
// @name         RingCentral Highlight [FIX]
// @name:zh-CN   RingCentral 高亮 [FIX] 消息
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Highlight RingCentral message cards that contain [FIX] with a yellow background. Covers initial load and live incoming messages.
// @description:zh-CN  实时查找包含关键字 [FIX] 的 RingCentral 消息卡片，并将其背景标为黄色；对首屏加载与后续新弹出的消息均生效。
// @author       Anna-SAP
// @match        https://app.ringcentral.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ringcentral.com
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-fix-highlight.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-fix-highlight.user.js
// ==/UserScript==

(function () {
    'use strict';

    const KEYWORD = '[FIX]';
    const STYLE_ID = '__TM_RC_FIX_HL_STYLE__';
    const HL_CLASS = 'tm-rc-fix-hl';
    const MESSAGES_PATH_RE = /\/messages(\/|$)/;

    // Stable hooks used by existing RC userscripts in this repo.
    const CARD_SELECTOR = [
        '.conversation-card-wrapper[data-id]',
        '[data-test-automation-id="conversation-reply-post-tree"][data-id]',
        '[data-name="reply-window-conversation-card"][data-id]',
    ].join(',');
    const STYLED_CARD_SELECTOR = '[data-test-automation-id="styled-conversation-card"]';

    let scanScheduled = false;
    let observerStarted = false;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.' + HL_CLASS + ',',
            '.' + HL_CLASS + ' ' + STYLED_CARD_SELECTOR + ',',
            '.' + HL_CLASS + ' .ac-adaptiveCard,',
            '.' + HL_CLASS + ' .ac-container {',
            '  background-color: #fff176 !important;',
            '  background-image: none !important;',
            '}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function isMessagesRoute() {
        return MESSAGES_PATH_RE.test(location.pathname || '');
    }

    function applyCard(card) {
        if (!card || card.nodeType !== 1) return;
        const hit = (card.textContent || '').indexOf(KEYWORD) !== -1;
        if (card.classList.contains(HL_CLASS) === hit) return;
        card.classList.toggle(HL_CLASS, hit);
    }

    function scanRoot(root) {
        if (!root || !root.querySelectorAll) return;

        if (root.nodeType === 1 && root.matches && root.matches(CARD_SELECTOR)) {
            applyCard(root);
        }

        const cards = root.querySelectorAll(CARD_SELECTOR);
        for (let i = 0; i < cards.length; i++) applyCard(cards[i]);

        // Fallback when a styled card is not wrapped by the usual conversation-card container.
        const styled = root.querySelectorAll(STYLED_CARD_SELECTOR);
        for (let i = 0; i < styled.length; i++) {
            const el = styled[i];
            if (el.closest(CARD_SELECTOR)) continue;
            applyCard(el);
        }
    }

    function scheduleScan() {
        if (scanScheduled) return;
        scanScheduled = true;
        const run = function () {
            scanScheduled = false;
            if (!isMessagesRoute()) return;
            injectStyles();
            scanRoot(document);
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run);
        } else {
            setTimeout(run, 16);
        }
    }

    function startObserver() {
        if (observerStarted || typeof MutationObserver !== 'function') return;
        observerStarted = true;
        const observer = new MutationObserver(function () {
            if (!isMessagesRoute()) return;
            scheduleScan();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    injectStyles();
    startObserver();
    scheduleScan();
})();
