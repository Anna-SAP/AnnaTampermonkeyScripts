// ==UserScript==
// @name         Grok Bot Message Time
// @name:zh-CN   Grok Bot 消息精确时间
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Show the exact send time on each Grok Bot message. The grok.com/bot transcript hides precise timestamps; this reads them from the page's own loaded transcript and paints a clock on the message card.
// @description:zh-CN 在 grok.com/bot 的每条 Bot 消息上显示精确发送时间。页面只给出「周一早上」「傍晚」这类说法，脚本从页面已经加载的会话数据里取出时间戳，标在对应消息块顶部。
// @author       Anna-SAP
// @match        https://grok.com/*
// @match        https://www.grok.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=grok.com
// @run-at       document-start
// @inject-into  page
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/grok-bot-message-time.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/grok-bot-message-time.user.js
// ==/UserScript==

(function () {
    'use strict';

    const testing = !!globalThis.__GMT_TEST__;
    const MIN_MS = Date.UTC(2020, 0, 1);
    const MAX_FUTURE_MS = 36 * 60 * 60 * 1000;
    const TIME_FIELDS = [
        'timestampMs', 'timestamp_ms', 'sentAtMs', 'sent_at_ms',
        'createdAtMs', 'created_at_ms', 'createTime', 'createdAt',
        'created_at', 'sentAt', 'sent_at', 'composedAtMs', 'create_time',
        'updatedAtMs', 'updated_at_ms'
    ];
    const MOUNT_TAGS = new Set(['DIV', 'ARTICLE', 'SECTION', 'LI', 'MAIN', 'BLOCKQUOTE']);
    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const CLOCK_SVG = '<svg class="gmt-clock" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.6"></circle><path d="M8 4.6V8.1l2.35 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

    const messageById = new Map();
    const seenPayloads = new Set();
    const seenPaths = [];

    function acceptMs(ms) {
        if (!Number.isFinite(ms)) return null;
        const rounded = Math.round(ms);
        if (rounded < MIN_MS || rounded > Date.now() + MAX_FUTURE_MS) return null;
        return rounded;
    }

    function fromNumber(n) {
        if (!Number.isFinite(n) || n <= 0) return null;
        if (n < 1e11) return acceptMs(n * 1000);
        if (n < 1e14) return acceptMs(n);
        if (n < 1e17) return acceptMs(n / 1000);
        return null;
    }

    function toMs(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return fromNumber(value);
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            if (/^-?\d+(\.\d+)?$/.test(trimmed)) return fromNumber(Number(trimmed));
            const parsed = Date.parse(trimmed);
            if (!Number.isNaN(parsed)) return acceptMs(parsed);
            return null;
        }
        if (typeof value === 'object') {
            if (value.$date != null) return toMs(value.$date);
            const seconds = value.seconds != null ? value.seconds : value.sec;
            if (seconds != null && (typeof seconds === 'number' || typeof seconds === 'string')) {
                const sec = Number(seconds);
                const nanos = Number(value.nanos || value.nanosecs || 0);
                if (Number.isFinite(sec)) {
                    return fromNumber(sec + (Number.isFinite(nanos) ? nanos / 1e9 : 0));
                }
            }
        }
        return null;
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .replace(/\u00a0/g, ' ')
            .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
            .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
            .replace(/https?:\/\/\S+/g, ' ')
            .replace(/[`*_~#>]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function textOf(value, depth) {
        if (value == null || depth > 6) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return '';
        if (Array.isArray(value)) {
            let out = '';
            for (let i = 0; i < value.length && i < 80; i++) {
                const piece = textOf(value[i], depth + 1);
                if (!piece) continue;
                out += (out ? '\n' : '') + piece;
            }
            return out;
        }
        if (typeof value !== 'object') return '';
        if (typeof value.content === 'string') return value.content;
        if (typeof value.text === 'string' && typeof value.type === 'string') return value.text;
        if (value.message != null && value.message !== value) {
            const nested = textOf(value.message, depth + 1);
            if (nested) return nested;
        }
        if (typeof value.markdown === 'string') return value.markdown;
        if (typeof value.body === 'string') return value.body;
        if (typeof value.text === 'string') return value.text;
        if (Array.isArray(value.content)) return textOf(value.content, depth + 1);
        if (Array.isArray(value.parts)) return textOf(value.parts, depth + 1);
        return '';
    }

    function readRole(obj) {
        const direct = obj.role || obj.sender || obj.author || obj.senderType || obj.sender_type || obj.from;
        if (direct && typeof direct === 'object') {
            return direct.role || direct.type || direct.name || '';
        }
        return direct == null ? '' : String(direct);
    }

    function readKind(obj) {
        return String(obj.kind || obj.entryKind || obj.entry_kind || obj.type || '').toLowerCase();
    }

    // Bot bubbles are assistant/bot turns, plus Grok Bot "send-message" entries
    // (the message the bot actually sends into the chat). User turns are skipped.
    function classify(obj) {
        const kind = readKind(obj);
        const role = readRole(obj).toLowerCase();
        if (role === 'human' || role === 'user' || role === 'me') return 'user';
        if (/tool|function_call|function-call|reasoning|thinking/.test(kind)) return null;
        if (role === 'assistant' || role === 'bot' || role === 'grok' || role === 'agent' || role === 'ai' || role === 'model') {
            return 'bot';
        }
        if (kind === 'send-message' || kind === 'send_message') return 'bot';
        return null;
    }

    function readId(obj) {
        const keys = ['responseId', 'response_id', 'entryId', 'entry_id', 'messageId', 'message_id', 'id'];
        for (let i = 0; i < keys.length; i++) {
            const value = obj[keys[i]];
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.length >= 1 && trimmed.length <= 120 && !/\s/.test(trimmed)) return trimmed;
            } else if (typeof value === 'number' && Number.isFinite(value)) {
                return String(value);
            }
        }
        return '';
    }

    function readTime(obj) {
        for (let i = 0; i < TIME_FIELDS.length; i++) {
            const key = TIME_FIELDS[i];
            if (obj[key] == null) continue;
            const ms = toMs(obj[key]);
            if (ms) return ms;
        }
        if (obj.time && typeof obj.time === 'object') return toMs(obj.time);
        return null;
    }

    function hashText(value) {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function debugOn() {
        try {
            return localStorage.getItem('gmtDebug') === '1';
        } catch (err) {
            return false;
        }
    }

    function upsertMessage(msg) {
        const prev = messageById.get(msg.id);
        if (!prev) {
            messageById.set(msg.id, msg);
        } else {
            if (msg.text.length >= prev.text.length) prev.text = msg.text;
            if (msg.ms) prev.ms = msg.ms;
        }
        if (debugOn()) {
            console.info('[GrokMsgTime]', msg.id, new Date(msg.ms).toISOString(), msg.text.length);
        }
        schedule();
    }

    function absorb(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
        if (classify(obj) !== 'bot') return;
        const ms = readTime(obj);
        if (!ms) return;
        const text = textOf(obj, 0).replace(/\s+/g, ' ').trim();
        if (normalizeText(text).length < 2) return;
        const clipped = text.slice(0, 2000);
        const id = readId(obj) || ('auto:' + ms + ':' + hashText(normalizeText(clipped).slice(0, 180)));
        upsertMessage({ id: id, ms: ms, text: clipped });
    }

    function harvest(value) {
        const stack = [{ value: value, depth: 0 }];
        const seen = new WeakSet();
        let visited = 0;
        while (stack.length && visited < 15000) {
            const item = stack.pop();
            const current = item.value;
            if (!current || typeof current !== 'object') continue;
            if (seen.has(current)) continue;
            seen.add(current);
            visited++;
            if (!Array.isArray(current)) absorb(current);
            if (item.depth >= 8) continue;
            if (Array.isArray(current)) {
                for (let i = 0; i < current.length && i < 4000; i++) {
                    if (current[i] && typeof current[i] === 'object') {
                        stack.push({ value: current[i], depth: item.depth + 1 });
                    }
                }
            } else {
                const keys = Object.keys(current);
                const limit = Math.min(keys.length, 60);
                for (let i = 0; i < limit; i++) {
                    const child = current[keys[i]];
                    if (child && typeof child === 'object') {
                        stack.push({ value: child, depth: item.depth + 1 });
                    }
                }
            }
        }
    }

    function hasTimeHint(text) {
        return text.indexOf('timestampMs') !== -1 ||
            text.indexOf('timestamp_ms') !== -1 ||
            text.indexOf('createTime') !== -1 ||
            text.indexOf('createdAt') !== -1 ||
            text.indexOf('created_at') !== -1 ||
            text.indexOf('sentAt') !== -1 ||
            text.indexOf('sent_at') !== -1 ||
            text.indexOf('createdAtMs') !== -1 ||
            text.indexOf('send-message') !== -1;
    }

    function rememberPayload(text) {
        const fingerprint = text.length + ':' + text.slice(0, 96) + ':' + text.slice(-48);
        if (seenPayloads.has(fingerprint)) return true;
        if (seenPayloads.size > 300) seenPayloads.clear();
        seenPayloads.add(fingerprint);
        return false;
    }

    function notePath(url) {
        const raw = String(url || '');
        if (!/transcript|conversation|message|response|\/api\/|\/rest\/|\/bot/i.test(raw)) return;
        let path = raw;
        try {
            path = new URL(raw, location.href).pathname;
        } catch (err) {
            path = raw.slice(0, 180);
        }
        if (seenPaths.indexOf(path) === -1 && seenPaths.length < 40) seenPaths.push(path);
    }

    function ingestText(text) {
        if (typeof text !== 'string' || text.length < 30 || text.length > 12000000) return;
        if (!hasTimeHint(text) || rememberPayload(text)) return;
        try {
            harvest(nativeJSONParse(text));
        } catch (err) {
            // Not a single JSON value (SSE frames are handled separately).
        }
    }

    function ingestLine(line) {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        const data = trimmed.indexOf('data:') === 0 ? trimmed.slice(5).trim() : trimmed;
        if (!data || data === '[DONE]') return;
        ingestText(data);
    }

    let nativeJSONParse = JSON.parse;
    let schedule = function () {};

    function installHooks(page) {
        nativeJSONParse = page.JSON.parse;
        const wrappedParse = function (text, reviver) {
            const value = reviver === undefined ? nativeJSONParse(text) : nativeJSONParse(text, reviver);
            if (typeof text === 'string' && text.length >= 30 && text.length <= 12000000 && hasTimeHint(text) && !rememberPayload(text)) {
                try { harvest(value); } catch (err) {}
            }
            return value;
        };
        try {
            page.JSON.parse = wrappedParse;
        } catch (err) {
            console.warn('[GrokMsgTime] 无法挂钩 JSON.parse');
        }

        if (page.Response && page.Response.prototype && !page.Response.prototype.__gmtJson) {
            const nativeJson = page.Response.prototype.json;
            page.Response.prototype.json = function () {
                return nativeJson.call(this).then(function (value) {
                    try { harvest(value); } catch (err) {}
                    return value;
                });
            };
            page.Response.prototype.__gmtJson = true;
        }

        if (page.fetch && !page.fetch.__gmt) {
            const nativeFetch = page.fetch;
            const wrappedFetch = function (input) {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                const pending = nativeFetch.apply(this, arguments);
                pending.then(function (res) {
                    try {
                        notePath(url);
                        const type = (res.headers && res.headers.get('content-type')) || '';
                        if (type.indexOf('event-stream') !== -1 && res.body && res.clone) readEventStream(res.clone());
                    } catch (err) {}
                }, function () {});
                return pending;
            };
            wrappedFetch.__gmt = true;
            try { page.fetch = wrappedFetch; } catch (err) {}
        }

        const xhrProto = page.XMLHttpRequest && page.XMLHttpRequest.prototype;
        if (xhrProto && !xhrProto.__gmtOpen) {
            const nativeOpen = xhrProto.open;
            const nativeSend = xhrProto.send;
            xhrProto.open = function (method, url) {
                this.__gmtUrl = url;
                return nativeOpen.apply(this, arguments);
            };
            xhrProto.send = function () {
                this.addEventListener('load', function () {
                    try {
                        notePath(this.__gmtUrl || '');
                        if (this.responseType === 'json' && this.response) {
                            harvest(this.response);
                            return;
                        }
                        if (this.responseType && this.responseType !== 'text') return;
                        ingestText(this.responseText || '');
                    } catch (err) {}
                });
                return nativeSend.apply(this, arguments);
            };
            xhrProto.__gmtOpen = true;
        }

        if (page.WebSocket && !page.WebSocket.__gmt) {
            const NativeWebSocket = page.WebSocket;
            function WrappedWebSocket(url, protocols) {
                const ws = protocols === undefined
                    ? new NativeWebSocket(url)
                    : new NativeWebSocket(url, protocols);
                ws.addEventListener('message', function (event) {
                    if (typeof event.data === 'string') ingestLine(event.data);
                });
                return ws;
            }
            WrappedWebSocket.prototype = NativeWebSocket.prototype;
            WrappedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
            WrappedWebSocket.OPEN = NativeWebSocket.OPEN;
            WrappedWebSocket.CLOSING = NativeWebSocket.CLOSING;
            WrappedWebSocket.CLOSED = NativeWebSocket.CLOSED;
            WrappedWebSocket.__gmt = true;
            try { page.WebSocket = WrappedWebSocket; } catch (err) {}
        }

        if (page.EventSource && !page.EventSource.__gmt) {
            const NativeEventSource = page.EventSource;
            function WrappedEventSource(url, config) {
                const source = config === undefined
                    ? new NativeEventSource(url)
                    : new NativeEventSource(url, config);
                source.addEventListener('message', function (event) {
                    if (typeof event.data === 'string') ingestLine(event.data);
                });
                return source;
            }
            WrappedEventSource.prototype = NativeEventSource.prototype;
            WrappedEventSource.CONNECTING = NativeEventSource.CONNECTING;
            WrappedEventSource.OPEN = NativeEventSource.OPEN;
            WrappedEventSource.CLOSED = NativeEventSource.CLOSED;
            WrappedEventSource.__gmt = true;
            try { page.EventSource = WrappedEventSource; } catch (err) {}
        }
    }

    function readEventStream(res) {
        if (!res.body || !res.body.getReader) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let bytes = 0;
        const pump = function () {
            reader.read().then(function (result) {
                if (result.done) return;
                bytes += result.value.byteLength;
                buffer += decoder.decode(result.value, { stream: true });
                let index = buffer.indexOf('\n');
                while (index >= 0) {
                    ingestLine(buffer.slice(0, index));
                    buffer = buffer.slice(index + 1);
                    index = buffer.indexOf('\n');
                }
                if (buffer.length > 500000) buffer = buffer.slice(-2000);
                if (bytes > 4000000) {
                    reader.cancel();
                    return;
                }
                pump();
            }, function () {});
        };
        pump();
    }

    function currentBotId() {
        const href = location.pathname + location.search + location.hash;
        const match = href.match(/\/bot\/([0-9a-z-]{8,})/i);
        return match ? match[1] : '';
    }

    function isBotPage() {
        const root = document.documentElement;
        if (root && root.dataset.gmtForce === '1') return true;
        return currentBotId() !== '';
    }

    function localDayIndex(ms) {
        const date = new Date(ms);
        return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
    }

    function formatRelative(ms, now) {
        const date = new Date(ms);
        const current = new Date(now);
        const dayGap = localDayIndex(current.getTime()) - localDayIndex(date.getTime());
        if (dayGap === 0) {
            const sec = Math.round((now - ms) / 1000);
            if (sec < 45) return '刚刚';
            const min = Math.round(sec / 60);
            if (min < 60) return Math.max(min, 1) + '分钟前';
            return Math.max(Math.round(min / 60), 1) + '小时前';
        }
        if (dayGap === 1) return '昨天';
        if (dayGap === 2) return '前天';
        if (dayGap > 2 && dayGap < 30) return dayGap + '天前';
        return '';
    }

    function formatAbsolute(ms) {
        const date = new Date(ms);
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
            WEEKDAYS[date.getDay()] + ' ' + hh + ':' + mm + ':' + ss;
    }

    function hoverText(ms) {
        let zone = 'local';
        try {
            zone = Intl.DateTimeFormat().resolvedOptions().timeZone || zone;
        } catch (err) {}
        return new Date(ms).toISOString().replace('.000Z', 'Z') + ' · ' + zone;
    }

    function buildKeys(list) {
        const norms = [];
        for (let i = 0; i < list.length; i++) {
            list[i].norm = normalizeText(list[i].text);
            norms.push(list[i].norm);
        }
        for (let i = 0; i < list.length; i++) {
            const norm = list[i].norm;
            let len = Math.min(32, norm.length);
            let key = norm.slice(0, len);
            while (len < norm.length) {
                let count = 0;
                for (let j = 0; j < norms.length; j++) {
                    if (norms[j].indexOf(key) !== -1) count++;
                }
                if (count <= 1) break;
                len = Math.min(norm.length, len + 32);
                key = norm.slice(0, len);
            }
            list[i].key = key;
        }
    }

    function elementMatches(elNorm, msg) {
        if (!msg.key || elNorm.indexOf(msg.key) === -1) return false;
        if (msg.norm.length < 24 && elNorm.length > msg.norm.length * 6 + 80) return false;
        return true;
    }

    function normOf(el) {
        if (!el.querySelector('.grok-msg-time')) return normalizeText(el.textContent || '');
        const clone = el.cloneNode(true);
        const badges = clone.querySelectorAll('.grok-msg-time');
        for (let i = 0; i < badges.length; i++) badges[i].remove();
        return normalizeText(clone.textContent || '');
    }

    function inChrome(el) {
        return !!el.closest('nav, aside, header, [role="navigation"], [role="banner"]');
    }

    function inSidebar(el) {
        if (inChrome(el)) return true;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return false;
        return rect.left < 24 && rect.width < 320 && rect.width < window.innerWidth * 0.4;
    }

    function inComposer(el) {
        return !!el.closest('textarea, [contenteditable="true"]');
    }

    function isScrollBox(el) {
        const style = getComputedStyle(el);
        return style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay';
    }

    function looksLikeBubble(el) {
        const style = getComputedStyle(el);
        const radius = parseFloat(style.borderTopLeftRadius) || 0;
        const bg = style.backgroundColor || '';
        const transparent = bg === 'transparent' || /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(bg);
        return radius >= 8 && !transparent;
    }

    function isHugeShell(parent, child) {
        const parentRect = parent.getBoundingClientRect();
        const childRect = child.getBoundingClientRect();
        return parentRect.height > childRect.height + 160 && parentRect.height > window.innerHeight * 0.85;
    }

    function mountable(el) {
        let cur = el;
        while (cur && cur !== document.body) {
            if (MOUNT_TAGS.has(cur.tagName)) return cur;
            cur = cur.parentElement;
        }
        return null;
    }

    function hitCount(norm, msgs) {
        let count = 0;
        for (let i = 0; i < msgs.length; i++) {
            if (elementMatches(norm, msgs[i])) count++;
            if (count > 1) break;
        }
        return count;
    }

    function ascend(start, msg, msgs) {
        let el = mountable(start);
        if (!el || inSidebar(el) || inComposer(el)) return null;
        let best = el;
        while (el.parentElement && el.parentElement !== document.body && el.parentElement !== document.documentElement) {
            const parent = el.parentElement;
            if (!MOUNT_TAGS.has(parent.tagName)) break;
            if (inSidebar(parent) || inChrome(parent)) break;
            const norm = normOf(parent);
            if (!elementMatches(norm, msg) || hitCount(norm, msgs) !== 1) break;
            if (isHugeShell(parent, el)) break;
            if (isScrollBox(parent) && parent.scrollHeight > parent.clientHeight + 24) break;
            const composer = parent.querySelector('textarea, [contenteditable="true"]');
            if (composer && parent.getBoundingClientRect().height > el.getBoundingClientRect().height + 180) break;
            if (looksLikeBubble(el)) {
                const parentRect = parent.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                if (!looksLikeBubble(parent) || parentRect.height > elRect.height + 80) break;
            }
            best = parent;
            el = parent;
        }
        return best;
    }

    function insertionPoint(host) {
        const style = getComputedStyle(host);
        const row = style.display === 'flex' || style.display === 'inline-flex';
        if (row && (style.flexDirection === 'row' || style.flexDirection === 'row-reverse')) {
            let best = null;
            let bestLen = 0;
            const kids = host.children;
            for (let i = 0; i < kids.length; i++) {
                const kid = kids[i];
                if (!kid.classList || kid.classList.contains('grok-msg-time')) continue;
                if (!MOUNT_TAGS.has(kid.tagName)) continue;
                const len = (kid.textContent || '').length;
                if (len > bestLen) {
                    best = kid;
                    bestLen = len;
                }
            }
            if (best && bestLen > 20) return best;
        }
        return host;
    }

    function isDarkSurface(el) {
        let cur = el;
        for (let i = 0; i < 6 && cur; i++) {
            const bg = getComputedStyle(cur).backgroundColor || '';
            const match = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
            if (match) {
                const alpha = match[4] == null ? 1 : Number(match[4]);
                if (alpha > 0.25) {
                    const lum = (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255;
                    return lum < 0.45;
                }
            }
            cur = cur.parentElement;
        }
        return false;
    }

    function fillBadge(el, msg) {
        const relative = formatRelative(msg.ms, Date.now());
        const dark = isDarkSurface(el.parentElement || el);
        el.classList.toggle('is-dark', dark);
        const signature = msg.ms + '|' + relative + '|' + (dark ? 'd' : 'l');
        el.dateTime = new Date(msg.ms).toISOString();
        el.title = hoverText(msg.ms);
        if (el.dataset.sig === signature) return;
        el.dataset.sig = signature;
        el.dataset.ms = String(msg.ms);
        el.dataset.gmtId = msg.id;
        const relHtml = relative
            ? '<span class="gmt-sep"></span><span class="gmt-rel">' + relative + '</span>'
            : '';
        el.innerHTML = CLOCK_SVG +
            '<span class="gmt-prefix">发送于</span>' +
            '<span class="gmt-abs">' + formatAbsolute(msg.ms) + '</span>' +
            relHtml;
    }

    function paint(host, msg) {
        if (!host || inSidebar(host) || inComposer(host)) return;
        const rect = host.getBoundingClientRect();
        if (rect.width < Math.min(180, window.innerWidth * 0.45) || rect.height < 8) return;
        const point = insertionPoint(host);
        let badge = null;
        const existing = host.querySelectorAll('.grok-msg-time');
        for (let i = 0; i < existing.length; i++) {
            if (existing[i].dataset.gmtId === msg.id) badge = existing[i];
        }
        if (!badge) {
            badge = document.createElement('time');
            badge.className = 'grok-msg-time';
            badge.dataset.gmtId = msg.id;
            point.insertBefore(badge, point.firstChild);
        } else if (badge.parentElement !== point) {
            point.insertBefore(badge, point.firstChild);
        }
        fillBadge(badge, msg);
    }

    function clearBadges() {
        const badges = document.querySelectorAll('.grok-msg-time');
        for (let i = 0; i < badges.length; i++) badges[i].remove();
    }

    function collectCandidates() {
        const main = document.querySelector('main, [role="main"]');
        const root = main && main.querySelectorAll('div').length > 4 ? main : document.body;
        if (!root) return [];
        const nodes = root.querySelectorAll('div, article, section, li, blockquote');
        const list = [];
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (el.classList.contains('grok-msg-time') || el.closest('.grok-msg-time')) continue;
            if (inChrome(el) || inSidebar(el) || inComposer(el)) continue;
            const raw = el.textContent || '';
            if (raw.length < 2 || raw.length > 60000) continue;
            if (el.getClientRects().length === 0) continue;
            list.push({ el: el, norm: normOf(el), len: raw.length });
        }
        return list;
    }

    function render() {
        if (!isBotPage()) {
            clearBadges();
            return;
        }
        const msgs = [];
        messageById.forEach(function (msg) { msgs.push(msg); });
        if (!msgs.length) return;
        buildKeys(msgs);
        const badges = document.querySelectorAll('.grok-msg-time');
        for (let i = 0; i < badges.length; i++) {
            const badge = badges[i];
            const msg = messageById.get(badge.dataset.gmtId || '');
            const host = badge.parentElement;
            if (!msg || !host || !elementMatches(normOf(host), msg)) badge.remove();
        }
        const candidates = collectCandidates();
        const used = new Set();
        const ordered = msgs.slice().sort(function (a, b) { return a.ms - b.ms; });
        for (let i = 0; i < ordered.length; i++) {
            const msg = ordered[i];
            if (!msg.key) continue;
            // Prefer the block whose text length is closest to the full message.
            // A sidebar preview contains only the opening line and must lose to the card.
            let tight = null;
            let tightScore = Infinity;
            for (let j = 0; j < candidates.length; j++) {
                const candidate = candidates[j];
                if (used.has(candidate.el)) continue;
                if (!elementMatches(candidate.norm, msg)) continue;
                const score = Math.abs(candidate.norm.length - msg.norm.length);
                if (score < tightScore || (score === tightScore && candidate.len < tight.len)) {
                    tight = candidate;
                    tightScore = score;
                }
            }
            if (!tight) continue;
            const host = ascend(tight.el, msg, msgs) || tight.el;
            if (used.has(host)) continue;
            used.add(host);
            used.add(tight.el);
            paint(host, msg);
        }
    }

    let renderTimer = 0;
    function armSchedule() {
        schedule = function () {
            if (renderTimer) return;
            renderTimer = setTimeout(function () {
                renderTimer = 0;
                try { render(); } catch (err) {
                    console.error('[GrokMsgTime]', err);
                }
            }, 160);
        };
    }

    function injectStyle() {
        if (document.getElementById('gmt-style')) return;
        const style = document.createElement('style');
        style.id = 'gmt-style';
        style.textContent = [
            '.grok-msg-time{box-sizing:border-box !important;display:inline-flex !important;align-items:center !important;flex-wrap:wrap !important;gap:6px !important;width:fit-content !important;max-width:100% !important;margin:0 0 10px !important;padding:4px 10px 4px 7px !important;border-radius:999px !important;border:1px solid #f0c7a4 !important;background:#fff6ee !important;box-shadow:0 1px 1px rgba(120,53,15,.05) !important;color:#7c2d12 !important;font-family:inherit !important;font-size:12.5px !important;font-weight:600 !important;font-variant-numeric:tabular-nums !important;line-height:1.35 !important;letter-spacing:.01em !important;user-select:text !important;cursor:text !important;text-transform:none !important;float:none !important;}',
            '.grok-msg-time.is-dark{border-color:rgba(251,146,60,.5) !important;background:rgba(124,45,18,.38) !important;color:#ffedd5 !important;box-shadow:none !important;}',
            '.grok-msg-time .gmt-clock{display:block !important;flex:none !important;color:#ea580c !important;}',
            '.grok-msg-time.is-dark .gmt-clock{color:#fdba74 !important;}',
            '.grok-msg-time .gmt-prefix{font-weight:500 !important;opacity:.78 !important;}',
            '.grok-msg-time .gmt-abs{font-weight:700 !important;white-space:nowrap !important;}',
            '.grok-msg-time .gmt-rel{font-weight:600 !important;opacity:.75 !important;white-space:nowrap !important;}',
            '.grok-msg-time .gmt-sep{width:3px !important;height:3px !important;border-radius:50% !important;background:currentColor !important;opacity:.4 !important;display:inline-block !important;flex:none !important;}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    let diagnosed = false;
    let activeBotId = '';

    function diagnose() {
        if (diagnosed || !isBotPage()) return;
        diagnosed = true;
        if (document.querySelector('.grok-msg-time')) return;
        if (messageById.size === 0) {
            console.info('[GrokMsgTime] 还没有从接口数据里解析到 Bot 消息时间。观察到的路径：', seenPaths.slice());
        } else {
            console.info('[GrokMsgTime] 已解析 ' + messageById.size + ' 条 Bot 消息时间，但没有对上画面里的消息块。', seenPaths.slice());
        }
    }

    function onRoute() {
        const id = currentBotId();
        if (id !== activeBotId) {
            activeBotId = id;
            diagnosed = false;
            setTimeout(diagnose, 8000);
        }
        schedule();
    }

    function watchDom() {
        injectStyle();
        const target = document.body || document.documentElement;
        const observer = new MutationObserver(function (records) {
            for (let i = 0; i < records.length; i++) {
                const node = records[i].target;
                if (node && node.nodeType === 1 && (node.classList.contains('grok-msg-time') || node.closest('.grok-msg-time'))) {
                    continue;
                }
                schedule();
                return;
            }
        });
        observer.observe(target, { childList: true, subtree: true });
        setInterval(function () {
            if (isBotPage()) schedule();
        }, 2000);
        setInterval(function () {
            const badges = document.querySelectorAll('.grok-msg-time');
            for (let i = 0; i < badges.length; i++) {
                const msg = messageById.get(badges[i].dataset.gmtId || '');
                if (msg) fillBadge(badges[i], msg);
            }
        }, 30000);
        activeBotId = currentBotId();
        setTimeout(diagnose, 8000);
        schedule();
    }

    function boot() {
        if (window.top !== window.self) return;
        if (window.__GMT_INSTALLED__) return;
        window.__GMT_INSTALLED__ = true;

        armSchedule();
        const page = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
        installHooks(page);

        const nativePush = history.pushState;
        const nativeReplace = history.replaceState;
        history.pushState = function () {
            const result = nativePush.apply(this, arguments);
            onRoute();
            return result;
        };
        history.replaceState = function () {
            const result = nativeReplace.apply(this, arguments);
            onRoute();
            return result;
        };
        window.addEventListener('popstate', onRoute);
        window.addEventListener('hashchange', onRoute);
        window.addEventListener('pageshow', schedule);

        const start = function () {
            if (document.documentElement && document.documentElement.dataset.gmtForce === '1') {
                window.__gmtRender = function () { render(); };
                window.__gmtMessages = messageById;
            }
            watchDom();
        };
        if (document.body) start();
        else {
            const ready = new MutationObserver(function () {
                if (!document.body) return;
                ready.disconnect();
                start();
            });
            ready.observe(document.documentElement, { childList: true });
        }
    }

    if (testing) {
        globalThis.__GMT = {
            toMs: toMs,
            normalizeText: normalizeText,
            harvest: harvest,
            messages: messageById,
            formatAbsolute: formatAbsolute,
            formatRelative: formatRelative,
            absorb: absorb
        };
    } else if (typeof document !== 'undefined') {
        boot();
    }
})();
