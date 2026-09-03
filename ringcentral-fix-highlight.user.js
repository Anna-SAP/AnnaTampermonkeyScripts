// ==UserScript==
// @name         RingCentral Highlight [FIX]
// @name:zh-CN   RingCentral 高亮 [FIX] 消息
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.1
// @description  Highlight the inner RingCentral Adaptive Card (not the full message row) when it contains [FIX]. Covers initial load and live incoming messages.
// @description:zh-CN  实时查找包含关键字 [FIX] 的 RingCentral 消息，仅将红框内的自适应卡片背景标为黄色，而不是整行铺黄。
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
    const COMPACT_WIDTH_RATIO = 0.85;

    // Outer message rows — used only to find messages, never painted yellow.
    const CARD_SELECTOR = [
        '.conversation-card-wrapper[data-id]',
        '[data-test-automation-id="conversation-reply-post-tree"][data-id]',
        '[data-name="reply-window-conversation-card"][data-id]',
    ].join(',');
    const STYLED_CARD_SELECTOR = '[data-test-automation-id="styled-conversation-card"]';
    const ADAPTIVE_SELECTOR = [
        '.ac-adaptiveCard',
        '.ac-adaptive-card',
        '[class*="ac-adaptiveCard"]',
    ].join(',');

    let scanScheduled = false;
    let observerStarted = false;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        // Paint only the compact inner card. Keep action buttons readable.
        style.textContent = [
            '.' + HL_CLASS + ',',
            '.' + HL_CLASS + ' .ac-container {',
            '  background-color: #fff176 !important;',
            '  background-image: none !important;',
            '}',
            '.' + HL_CLASS + ' .ac-pushButton,',
            '.' + HL_CLASS + ' button {',
            '  background-color: #fff !important;',
            '}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function isMessagesRoute() {
        return MESSAGES_PATH_RE.test(location.pathname || '');
    }

    function findKeywordTextHost(card) {
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            if ((node.nodeValue || '').indexOf(KEYWORD) !== -1) {
                return node.parentElement;
            }
        }
        return null;
    }

    // Climb to the outermost box that is still clearly narrower than the
    // full-width conversation row — that is the visual Adaptive Card.
    function outermostCompactAncestor(start, card) {
        if (!start || start === card) return null;
        const cardWidth = card.getBoundingClientRect().width;
        if (cardWidth <= 0) return start;
        const limit = cardWidth * COMPACT_WIDTH_RATIO;
        let best = start;
        let el = start.parentElement;
        while (el && el !== card && card.contains(el)) {
            const width = el.getBoundingClientRect().width;
            if (width > limit) break;
            if (width > 0) best = el;
            el = el.parentElement;
        }
        return best === card ? start : best;
    }

    function findHighlightTargets(card) {
        const targets = [];
        const seen = new Set();

        function add(el) {
            if (!el || el === card || seen.has(el)) return;
            seen.add(el);
            targets.push(el);
        }

        const adaptives = card.querySelectorAll(ADAPTIVE_SELECTOR);
        let foundAdaptive = false;
        for (let i = 0; i < adaptives.length; i++) {
            const el = adaptives[i];
            if ((el.textContent || '').indexOf(KEYWORD) === -1) continue;
            foundAdaptive = true;
            add(outermostCompactAncestor(el, card) || el);
        }
        if (foundAdaptive) return targets;

        const host = findKeywordTextHost(card);
        if (host) add(outermostCompactAncestor(host, card) || host);
        return targets;
    }

    function applyCard(card) {
        if (!card || card.nodeType !== 1) return;

        const hit = (card.textContent || '').indexOf(KEYWORD) !== -1;
        const targets = hit ? findHighlightTargets(card) : [];
        const keep = new Set(targets);

        if (card.classList.contains(HL_CLASS) && !keep.has(card)) {
            card.classList.remove(HL_CLASS);
        }

        const old = card.querySelectorAll('.' + HL_CLASS);
        for (let i = 0; i < old.length; i++) {
            if (!keep.has(old[i])) old[i].classList.remove(HL_CLASS);
        }

        for (let i = 0; i < targets.length; i++) {
            targets[i].classList.add(HL_CLASS);
        }
    }

    function scanRoot(root) {
        if (!root || !root.querySelectorAll) return;

        if (root.nodeType === 1 && root.matches && root.matches(CARD_SELECTOR)) {
            applyCard(root);
        }

        const cards = root.querySelectorAll(CARD_SELECTOR);
        for (let i = 0; i < cards.length; i++) applyCard(cards[i]);

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
