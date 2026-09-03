// ==UserScript==
// @name         RingCentral Highlight [FIX]
// @name:zh-CN   RingCentral 高亮 [FIX] 消息
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.1.0
// @description  Highlight the inner RingCentral Adaptive Card when it contains [FIX] or [BATCH_FIX], and mark word/character diffs between Before and After translation text.
// @description:zh-CN  实时查找包含关键字 [FIX] 或 [BATCH_FIX] 的 RingCentral 消息，仅将内层自适应卡片背景标为黄色；并提取 Before/After 文本，在卡片内用红色标出词级或字符级差异。
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

    const KEYWORDS = ['[FIX]', '[BATCH_FIX]'];
    const STYLE_ID = '__TM_RC_FIX_HL_STYLE__';
    const HL_CLASS = 'tm-rc-fix-hl';
    const DIFF_CLASS = 'tm-rc-diff-hl';
    const DIFF_WS_CLASS = 'tm-rc-diff-ws';
    const DIFF_ATTR = 'data-tm-rc-diff';
    const MESSAGES_PATH_RE = /\/messages(\/|$)/;
    const COMPACT_WIDTH_RATIO = 0.85;
    const LABEL_BEFORE_RE = /^before:?$/i;
    const LABEL_AFTER_RE = /^after:?$/i;
    const TOKEN_RE = /\{\{[^{}]*\}\}|\{[^{}]*\}|\$\{[^}]+\}|%[0-9$]*[sdifSxX]|[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|\s+|[^\s\p{L}\p{N}]+/gu;
    const BULLET_RE = /^(\s*[•●○◦‣∙·]\s*)/;

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
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }
        // Paint only the compact inner card. Keep action buttons readable.
        // Diff marks: red text + coral chip so they stay visible on the yellow card.
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
            '.' + DIFF_CLASS + ' {',
            '  color: #b71c1c !important;',
            '  background-color: #ff8a80 !important;',
            '  font-weight: 700 !important;',
            '  border-radius: 2px;',
            '  padding: 0 1px;',
            '  box-decoration-break: clone;',
            '  -webkit-box-decoration-break: clone;',
            '}',
            '.' + DIFF_WS_CLASS + ' {',
            '  white-space: pre;',
            '  padding: 0 3px;',
            '  margin: 0 1px;',
            '  border-bottom: 2px solid #c62828;',
            '}',
        ].join('\n');
    }

    function isMessagesRoute() {
        return MESSAGES_PATH_RE.test(location.pathname || '');
    }

    function containsKeyword(text) {
        if (!text) return false;
        for (let i = 0; i < KEYWORDS.length; i++) {
            if (text.indexOf(KEYWORDS[i]) !== -1) return true;
        }
        return false;
    }

    function findKeywordTextHost(card) {
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            if (containsKeyword(node.nodeValue)) {
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
            if (!containsKeyword(el.textContent)) continue;
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

        const hit = containsKeyword(card.textContent);
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

        applyDiffs(card);
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

    // --- Before / After diff ------------------------------------------------

    function classString(el) {
        if (!el) return '';
        const c = el.className;
        if (!c) return '';
        return typeof c === 'string' ? c : String(c.baseVal || '');
    }

    function hasAcClass(el, name) {
        return classString(el).indexOf(name) !== -1;
    }

    function isColumnSet(el) {
        return !!(el && el.nodeType === 1 && (hasAcClass(el, 'ac-columnSet') || hasAcClass(el, 'ac-column-set')));
    }

    function isColumn(el) {
        if (!el || el.nodeType !== 1 || isColumnSet(el)) return false;
        return hasAcClass(el, 'ac-column');
    }

    function nfc(s) {
        s = s || '';
        return s.normalize ? s.normalize('NFC') : s;
    }

    function compactText(s) {
        return (s || '').replace(/\s+/g, ' ').trim();
    }

    function isHeaderLabelText(s) {
        const t = compactText(s);
        return LABEL_BEFORE_RE.test(t) || LABEL_AFTER_RE.test(t);
    }

    function splitBullet(text) {
        const m = (text || '').match(BULLET_RE);
        if (!m) return { bullet: '', body: text || '' };
        return { bullet: m[1], body: text.slice(m[1].length) };
    }

    function tokenize(text) {
        if (!text) return [];
        TOKEN_RE.lastIndex = 0;
        const m = text.match(TOKEN_RE);
        return m || [];
    }

    function lcsDiff(a, b) {
        const n = a.length;
        const m = b.length;
        if (n === 0 && m === 0) return [];
        if (n * m > 250000) {
            const out = [];
            if (n) out.push({ type: 'delete', text: a.join('') });
            if (m) out.push({ type: 'insert', text: b.join('') });
            return out;
        }
        const dp = new Array(n + 1);
        for (let i = 0; i <= n; i++) dp[i] = new Uint16Array(m + 1);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
                else dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
            }
        }
        const ops = [];
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (a[i] === b[j]) {
                ops.push({ type: 'equal', text: a[i] });
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                ops.push({ type: 'delete', text: a[i] });
                i++;
            } else {
                ops.push({ type: 'insert', text: b[j] });
                j++;
            }
        }
        while (i < n) ops.push({ type: 'delete', text: a[i++] });
        while (j < m) ops.push({ type: 'insert', text: b[j++] });
        return ops;
    }

    function coalesce(ops, mergeEqual) {
        const out = [];
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const last = out.length ? out[out.length - 1] : null;
            const canMerge = last && last.type === op.type && (mergeEqual || op.type !== 'equal');
            if (canMerge) last.text += op.text;
            else out.push({ type: op.type, text: op.text });
        }
        return out;
    }

    function isPureWord(s) {
        return /^[\p{L}\p{M}]+$/u.test(s || '');
    }

    function isTinyText(s) {
        if (!s) return true;
        return !/[\p{L}\p{M}]{2,}/u.test(s);
    }

    function isExpandableContext(token) {
        if (!token || /^\s+$/.test(token)) return false;
        if (/^\{[^{}]*\}$/.test(token) || /^\{\{[^{}]*\}\}$/.test(token)) return true;
        if (/^%[0-9$]*[sdifSxX]$/.test(token)) return true;
        if (/^\$\{[^}]+\}$/.test(token)) return true;
        return !/[\p{L}\p{N}]/u.test(token);
    }

    function shouldCharDiff(del, ins) {
        if (!del || !ins) return false;
        if (isPureWord(del) && isPureWord(ins)) return false;
        return true;
    }

    function refineReplaces(ops) {
        const out = [];
        let i = 0;
        while (i < ops.length) {
            if (ops[i].type === 'equal') {
                out.push(ops[i]);
                i++;
                continue;
            }
            let del = '';
            let ins = '';
            while (i < ops.length && ops[i].type !== 'equal') {
                if (ops[i].type === 'delete') del += ops[i].text;
                else ins += ops[i].text;
                i++;
            }
            if (del && ins && shouldCharDiff(del, ins)) {
                const charOps = coalesce(lcsDiff(Array.from(del), Array.from(ins)), true);
                for (let k = 0; k < charOps.length; k++) out.push(charOps[k]);
            } else {
                if (del) out.push({ type: 'delete', text: del });
                if (ins) out.push({ type: 'insert', text: ins });
            }
        }
        return out;
    }

    function markTiny(ops) {
        let i = 0;
        while (i < ops.length) {
            if (ops[i].type === 'equal') {
                i++;
                continue;
            }
            const start = i;
            let del = '';
            let ins = '';
            while (i < ops.length && ops[i].type !== 'equal') {
                if (ops[i].type === 'delete') del += ops[i].text;
                else ins += ops[i].text;
                i++;
            }
            const tiny = isTinyText(del) && isTinyText(ins);
            for (let k = start; k < i; k++) ops[k].tiny = tiny;
        }
        return ops;
    }

    function contextMarks(ops) {
        const mark = {};
        for (let i = 0; i < ops.length; i++) {
            if (!ops[i].tiny) continue;
            if (ops[i].type !== 'delete' && ops[i].type !== 'insert') continue;
            for (let j = i - 1; j >= 0; j--) {
                if (ops[j].type === 'equal') {
                    if (isExpandableContext(ops[j].text)) mark[j] = true;
                    break;
                }
            }
            for (let j = i + 1; j < ops.length; j++) {
                if (ops[j].type === 'equal') {
                    if (isExpandableContext(ops[j].text)) mark[j] = true;
                    break;
                }
            }
        }
        return mark;
    }

    function piecesForSide(ops, side, ctx) {
        const pieces = [];
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            if (op.type === 'equal') {
                pieces.push({ text: op.text, mark: !!ctx[i] });
            } else if (op.type === 'delete' && side === 'before') {
                pieces.push({ text: op.text, mark: true });
            } else if (op.type === 'insert' && side === 'after') {
                pieces.push({ text: op.text, mark: true });
            }
        }
        return pieces;
    }

    function mergePieces(pieces) {
        const out = [];
        for (let i = 0; i < pieces.length; i++) {
            const p = pieces[i];
            const last = out.length ? out[out.length - 1] : null;
            if (last && last.mark === p.mark) last.text += p.text;
            else out.push({ text: p.text, mark: p.mark });
        }
        return out;
    }

    function diffTexts(before, after) {
        const a = nfc(before);
        const b = nfc(after);
        const ops = markTiny(refineReplaces(coalesce(lcsDiff(tokenize(a), tokenize(b)), false)));
        const ctx = contextMarks(ops);
        return {
            before: mergePieces(piecesForSide(ops, 'before', ctx)),
            after: mergePieces(piecesForSide(ops, 'after', ctx)),
        };
    }

    function significantChildren(el) {
        const out = [];
        if (!el) return out;
        for (let i = 0; i < el.children.length; i++) {
            const ch = el.children[i];
            const tag = ch.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE') continue;
            out.push(ch);
        }
        return out;
    }

    function columnsOf(set) {
        const kids = significantChildren(set);
        const cols = [];
        for (let i = 0; i < kids.length; i++) {
            if (isColumn(kids[i])) cols.push(kids[i]);
        }
        return cols.length >= 2 ? cols : kids;
    }

    function overlapX(a, b) {
        const left = Math.max(a.left, b.left);
        const right = Math.min(a.right, b.right);
        return Math.max(0, right - left);
    }

    function deepestHost(el) {
        if (!el) return null;
        const target = el.textContent;
        let best = el;
        const all = el.getElementsByTagName('*');
        for (let i = 0; i < all.length; i++) {
            if (all[i].textContent === target) best = all[i];
        }
        return best;
    }

    function primaryTextEl(col) {
        if (!col) return null;
        const li = col.querySelector && col.querySelector('li');
        if (li && compactText(li.textContent)) return deepestHost(li);

        const blocks = [];
        const all = col.getElementsByTagName('*');
        for (let i = 0; i < all.length; i++) {
            if (hasAcClass(all[i], 'ac-textBlock') || hasAcClass(all[i], 'ac-text-block') ||
                hasAcClass(all[i], 'ac-richTextBlock')) {
                blocks.push(all[i]);
            }
        }
        if (blocks.length) {
            let best = blocks[0];
            let bestLen = -1;
            for (let i = 0; i < blocks.length; i++) {
                const t = compactText(blocks[i].textContent);
                if (isHeaderLabelText(t)) continue;
                if (t.length > bestLen) {
                    best = blocks[i];
                    bestLen = t.length;
                }
            }
            return deepestHost(best);
        }
        return deepestHost(col);
    }

    function canRewrite(el) {
        if (!el) return false;
        if (el.closest && el.closest('button, a, input, textarea, .ac-pushButton')) return false;
        const kids = el.getElementsByTagName('*');
        for (let i = 0; i < kids.length; i++) {
            const tag = kids[i].tagName;
            if (tag === 'SPAN' || tag === 'BR' || tag === 'B' || tag === 'STRONG' ||
                tag === 'I' || tag === 'EM' || tag === 'P' || tag === 'FONT') continue;
            return false;
        }
        return true;
    }

    function findLabelEls(root, re) {
        const hits = [];
        const all = root.getElementsByTagName('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (!re.test(compactText(el.textContent))) continue;
            hits.push(el);
        }
        const inner = [];
        for (let i = 0; i < hits.length; i++) {
            let nested = false;
            for (let j = 0; j < hits.length; j++) {
                if (hits[j] !== hits[i] && hits[i].contains(hits[j])) {
                    nested = true;
                    break;
                }
            }
            if (!nested) inner.push(hits[i]);
        }
        return inner;
    }

    function headerIndices(cols) {
        let before = -1;
        let after = -1;
        for (let i = 0; i < cols.length; i++) {
            const t = compactText(cols[i].textContent);
            if (LABEL_BEFORE_RE.test(t)) before = i;
            else if (LABEL_AFTER_RE.test(t)) after = i;
        }
        if (before >= 0 && after >= 0 && before !== after) return { before: before, after: after };
        return null;
    }

    function queryColumnSets(root) {
        const out = [];
        if (isColumnSet(root)) out.push(root);
        const all = root.getElementsByTagName('*');
        for (let i = 0; i < all.length; i++) {
            if (isColumnSet(all[i])) out.push(all[i]);
        }
        return out;
    }

    function rowOfLabel(label, card) {
        let el = label.parentElement;
        while (el && el !== card) {
            if (isColumnSet(el) || el.tagName === 'TR') return el;
            el = el.parentElement;
        }
        el = label.parentElement;
        while (el && el !== card) {
            if (isColumn(el)) {
                el = el.parentElement;
                continue;
            }
            if (significantChildren(el).length >= 2) return el;
            el = el.parentElement;
        }
        return label.parentElement;
    }

    function childContaining(parent, el) {
        let x = el;
        while (x && x.parentElement !== parent) x = x.parentElement;
        return x && x.parentElement === parent ? x : null;
    }

    function looksLikeContent(el) {
        if (!el) return false;
        const t = compactText(el.textContent);
        if (!t) return false;
        if (isHeaderLabelText(t)) return false;
        if (/^Commit:/i.test(t)) return false;
        if (/^Go to Dashboard$/i.test(t)) return false;
        if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})+$/i.test(t) && t.length <= 12) return false;
        return true;
    }

    function cellsFromRow(row, beforeCol, afterCol, bi, ai) {
        const kids = columnsOf(row);
        const bBox = beforeCol.getBoundingClientRect();
        if (bBox.width > 0) {
            const aBox = afterCol.getBoundingClientRect();
            let bEl = null;
            let aEl = null;
            let bOv = 0;
            let aOv = 0;
            for (let i = 0; i < kids.length; i++) {
                const r = kids[i].getBoundingClientRect();
                const ob = overlapX(r, bBox);
                const oa = overlapX(r, aBox);
                if (ob > bOv) {
                    bOv = ob;
                    bEl = kids[i];
                }
                if (oa > aOv) {
                    aOv = oa;
                    aEl = kids[i];
                }
            }
            if (bEl && aEl && bEl !== aEl && bOv > 0 && aOv > 0) {
                return { beforeEl: primaryTextEl(bEl), afterEl: primaryTextEl(aEl) };
            }
        }
        if (kids[bi] && kids[ai] && kids[bi] !== kids[ai]) {
            return { beforeEl: primaryTextEl(kids[bi]), afterEl: primaryTextEl(kids[ai]) };
        }
        return null;
    }

    function pairsFromTable(beforeLabel, afterLabel) {
        const cellB = beforeLabel.closest ? beforeLabel.closest('th, td') : null;
        const cellA = afterLabel.closest ? afterLabel.closest('th, td') : null;
        if (!cellB || !cellA) return null;
        const row = cellB.parentElement;
        if (!row || row !== cellA.parentElement) return null;
        const table = row.closest ? row.closest('table') : null;
        if (!table || !table.rows) return null;
        const bi = cellB.cellIndex;
        const ai = cellA.cellIndex;
        const pairs = [];
        let passed = false;
        for (let i = 0; i < table.rows.length; i++) {
            if (table.rows[i] === row) {
                passed = true;
                continue;
            }
            if (!passed) continue;
            const cells = table.rows[i].cells;
            if (!cells[bi] || !cells[ai] || cells[bi] === cells[ai]) continue;
            const bEl = primaryTextEl(cells[bi]);
            const aEl = primaryTextEl(cells[ai]);
            if (looksLikeContent(bEl) && looksLikeContent(aEl)) {
                pairs.push({ beforeEl: bEl, afterEl: aEl });
            }
        }
        return pairs;
    }

    function geometricPairs(card, headerRow, beforeCol, afterCol, addPair) {
        const bBox = beforeCol.getBoundingClientRect();
        const aBox = afterCol.getBoundingClientRect();
        const hBox = headerRow.getBoundingClientRect();
        if (bBox.width <= 0 || aBox.width <= 0 || hBox.height <= 0) return;

        let nextHeaderTop = Infinity;
        const otherBefores = findLabelEls(card, LABEL_BEFORE_RE);
        for (let i = 0; i < otherBefores.length; i++) {
            const row = rowOfLabel(otherBefores[i], card);
            if (!row || row === headerRow) continue;
            const top = row.getBoundingClientRect().top;
            if (top > hBox.top + 8 && top < nextHeaderTop) nextHeaderTop = top;
        }

        function whichCol(r) {
            const ob = overlapX(r, bBox);
            const oa = overlapX(r, aBox);
            const w = r.width || 0;
            if (w <= 0) return null;
            if (ob > w * 0.45 && ob > oa * 1.1) return 'before';
            if (oa > w * 0.45 && oa > ob * 1.1) return 'after';
            return null;
        }

        const items = [];
        const all = card.getElementsByTagName('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (headerRow.contains(el)) continue;
            if (el.closest && el.closest('button, .ac-pushButton, a')) continue;
            const r = el.getBoundingClientRect();
            if (r.height <= 0 || r.top + 2 < hBox.bottom) continue;
            if (r.top >= nextHeaderTop - 2) continue;
            const col = whichCol(r);
            if (!col || !looksLikeContent(el)) continue;
            items.push({ el: el, col: col, top: r.top, bottom: r.bottom });
        }

        const inner = [];
        for (let i = 0; i < items.length; i++) {
            let nested = false;
            for (let j = 0; j < items.length; j++) {
                if (items[j] !== items[i] && items[i].col === items[j].col &&
                    items[i].el.contains(items[j].el)) {
                    nested = true;
                    break;
                }
            }
            if (!nested) inner.push(items[i]);
        }

        const be = [];
        const ae = [];
        for (let i = 0; i < inner.length; i++) {
            if (inner[i].col === 'before') be.push(inner[i]);
            else ae.push(inner[i]);
        }
        be.sort(function (x, y) { return x.top - y.top; });
        ae.sort(function (x, y) { return x.top - y.top; });

        const used = {};
        for (let i = 0; i < be.length; i++) {
            let best = -1;
            let bestOy = 0;
            for (let j = 0; j < ae.length; j++) {
                if (used[j]) continue;
                const oy = Math.min(be[i].bottom, ae[j].bottom) - Math.max(be[i].top, ae[j].top);
                if (oy > bestOy) {
                    bestOy = oy;
                    best = j;
                }
            }
            if (best >= 0 && bestOy > 0) {
                used[best] = true;
                addPair(be[i].el, ae[best].el);
            }
        }
    }

    function findPairs(card) {
        const befores = findLabelEls(card, LABEL_BEFORE_RE);
        const afters = findLabelEls(card, LABEL_AFTER_RE);
        if (!befores.length || !afters.length) return [];

        const pairs = [];
        const usedAfter = new Set();
        const usedEls = new Set();

        function addPair(bEl, aEl) {
            if (!bEl || !aEl || bEl === aEl) return;
            if (!looksLikeContent(bEl) || !looksLikeContent(aEl)) return;
            if (usedEls.has(bEl) || usedEls.has(aEl)) return;
            usedEls.add(bEl);
            usedEls.add(aEl);
            pairs.push({ beforeEl: bEl, afterEl: aEl });
        }

        for (let i = 0; i < befores.length; i++) {
            const bLabel = befores[i];
            let afterLabel = null;
            const bRow = rowOfLabel(bLabel, card);
            for (let j = 0; j < afters.length; j++) {
                if (usedAfter.has(afters[j])) continue;
                if (rowOfLabel(afters[j], card) === bRow) {
                    afterLabel = afters[j];
                    break;
                }
            }
            if (!afterLabel) {
                for (let j = 0; j < afters.length; j++) {
                    if (!usedAfter.has(afters[j])) {
                        afterLabel = afters[j];
                        break;
                    }
                }
            }
            if (!afterLabel) continue;
            usedAfter.add(afterLabel);

            const tablePairs = pairsFromTable(bLabel, afterLabel);
            if (tablePairs && tablePairs.length) {
                for (let t = 0; t < tablePairs.length; t++) {
                    addPair(tablePairs[t].beforeEl, tablePairs[t].afterEl);
                }
                continue;
            }

            const headerRow = bRow;
            const beforeCol = childContaining(headerRow, bLabel) || bLabel;
            const afterCol = childContaining(headerRow, afterLabel) || afterLabel;
            const cols = columnsOf(headerRow);
            let idx = headerIndices(cols);
            if (!idx) {
                const bi = cols.indexOf(beforeCol);
                const ai = cols.indexOf(afterCol);
                if (bi >= 0 && ai >= 0 && bi !== ai) idx = { before: bi, after: ai };
            }
            if (!idx) continue;

            const addedBefore = pairs.length;
            const sets = queryColumnSets(card);
            const usedRows = [];
            let afterHeader = false;
            for (let s = 0; s < sets.length; s++) {
                const set = sets[s];
                if (set === headerRow) {
                    afterHeader = true;
                    continue;
                }
                if (!afterHeader) continue;
                if (headerRow.contains(set)) continue;
                let nested = false;
                for (let u = 0; u < usedRows.length; u++) {
                    if (usedRows[u].contains(set)) {
                        nested = true;
                        break;
                    }
                }
                if (nested) continue;
                if (headerIndices(columnsOf(set))) break;
                const cells = cellsFromRow(set, beforeCol, afterCol, idx.before, idx.after);
                if (cells) {
                    addPair(cells.beforeEl, cells.afterEl);
                    usedRows.push(set);
                }
            }

            // Sibling rows that are not columnSets (plain div grids).
            let sib = headerRow.nextElementSibling;
            while (sib) {
                if (isColumnSet(sib) && headerIndices(columnsOf(sib))) break;
                if (!isColumnSet(sib)) {
                    const cells = cellsFromRow(sib, beforeCol, afterCol, idx.before, idx.after);
                    if (cells) addPair(cells.beforeEl, cells.afterEl);
                }
                sib = sib.nextElementSibling;
            }

            if (pairs.length === addedBefore) {
                geometricPairs(card, headerRow, beforeCol, afterCol, addPair);
            }
        }

        return pairs;
    }

    function fillEl(el, bullet, pieces, sig) {
        while (el.firstChild) el.removeChild(el.firstChild);
        if (bullet) el.appendChild(document.createTextNode(bullet));
        for (let i = 0; i < pieces.length; i++) {
            const p = pieces[i];
            if (!p.text) continue;
            if (!p.mark) {
                el.appendChild(document.createTextNode(p.text));
                continue;
            }
            const span = document.createElement('span');
            span.className = /^\s+$/.test(p.text)
                ? DIFF_CLASS + ' ' + DIFF_WS_CLASS
                : DIFF_CLASS;
            span.textContent = p.text;
            el.appendChild(span);
        }
        el.setAttribute(DIFF_ATTR, sig);
    }

    function unwrapEl(el) {
        if (!el || !el.getAttribute || !el.getAttribute(DIFF_ATTR)) return;
        const text = el.textContent;
        el.removeAttribute(DIFF_ATTR);
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(document.createTextNode(text));
    }

    function unwrapOrphans(card, keep) {
        const old = card.querySelectorAll('[' + DIFF_ATTR + ']');
        for (let i = 0; i < old.length; i++) {
            if (!keep.has(old[i])) unwrapEl(old[i]);
        }
    }

    function paintPair(beforeEl, afterEl) {
        if (!canRewrite(beforeEl) || !canRewrite(afterEl)) return;
        const bRaw = beforeEl.textContent || '';
        const aRaw = afterEl.textContent || '';
        const bSplit = splitBullet(bRaw);
        const aSplit = splitBullet(aRaw);
        const sig = String(bRaw.length) + ':' + String(aRaw.length) + ':' + bRaw + '\u0001' + aRaw;
        if (beforeEl.getAttribute(DIFF_ATTR) === sig && afterEl.getAttribute(DIFF_ATTR) === sig) {
            return;
        }
        if (bSplit.body === aSplit.body) {
            beforeEl.setAttribute(DIFF_ATTR, sig);
            afterEl.setAttribute(DIFF_ATTR, sig);
            return;
        }
        const diff = diffTexts(bSplit.body, aSplit.body);
        fillEl(beforeEl, bSplit.bullet, diff.before, sig);
        fillEl(afterEl, aSplit.bullet, diff.after, sig);
    }

    function applyDiffs(card) {
        const text = card.textContent || '';
        if (!/before/i.test(text) || !/after/i.test(text)) {
            unwrapOrphans(card, new Set());
            return;
        }
        const pairs = findPairs(card);
        const keep = new Set();
        for (let i = 0; i < pairs.length; i++) {
            keep.add(pairs[i].beforeEl);
            keep.add(pairs[i].afterEl);
            paintPair(pairs[i].beforeEl, pairs[i].afterEl);
        }
        if (pairs.length) unwrapOrphans(card, keep);
    }

    injectStyles();
    startObserver();
    scheduleScan();
})();
