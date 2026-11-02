// ==UserScript==
// @name         Grok Bot New Message Voice
// @name:zh-CN   Grok Bot 新消息语音播报
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Speak "<Bot> 机器人有新的消息请查收" when any Grok Bot gets a new message. Reads the bot channel the grok.com page already has open, and the unread dots in the sidebar Bots list.
// @description:zh-CN 任意 Grok Bot 收到新消息时，用浏览器语音朗读「[Bot名称] 机器人有新的消息请查收」。数据来自页面自己的 Bot WebSocket 和左侧「机器人」列表的未读蓝点，折叠在「展开」里的 Bot 也能听到。页面没点过之前浏览器不让出声，脚本会先排队提示，点一下页面就补播。
// @author       Anna-SAP
// @match        https://grok.com/*
// @match        https://www.grok.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=grok.com
// @run-at       document-start
// @inject-into  page
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/grok-bot-new-message-voice.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/grok-bot-new-message-voice.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[GrokBotVoice]';
    const KEY_CONFIG = 'gbv:config';
    const KEY_STATE = 'gbv:state';
    const KEY_SPOKEN = 'gbv:spoken';
    const KEY_DEBUG = 'gbv:debug';
    const DEFAULTS = {
        enabled: true,
        template: '{name} 机器人有新的消息请查收',
        fullName: false,
        voice: '',
        rate: 1,
        pitch: 1,
        volume: 1,
        onLoad: 'away',
        toast: true,
        notify: false,
        entrySelector: '',
        dotSelector: ''
    };
    // Unread state seen in the first seconds after load is the backlog, not news.
    const WARMUP_MS = 6000;
    const ENTRY_WARMUP_MS = 2500;
    // React can drop a dot for a frame while it re-renders the list.
    const READ_GRACE_MS = 2500;
    const COOLDOWN_MS = 30000;
    const CROSS_TAB_MS = 15000;
    const SLOW_LOAD_MS = 60000;
    const BOT_HREF = /\/bot\/([0-9a-z][0-9a-z-]{7,})/i;
    const AGENT_ID = /^[0-9a-z][0-9a-z-]{7,63}$/i;
    const NAME_SPLIT = /\s*[·•・｜]\s*|\s+\|\s+/;
    const COUNT_TEXT = /^\d{1,3}\+?$/;
    const OBSERVED_ATTRS = ['class', 'style', 'hidden', 'href', 'data-state', 'data-active', 'data-unread', 'aria-hidden'];

    const nativeParse = JSON.parse;
    const bots = new Map();
    const knownAgents = new Set();
    const speech = { state: 'unknown', queue: [], busy: false, current: null, voice: null, voiceKey: '' };
    let config = loadConfig();
    let persisted = readJson(KEY_STATE, {});
    const bootPersisted = Object.assign({}, persisted);
    let bootAt = 0;
    let sidebarRoot = null;
    let uiRoot = null;
    let pill = null;
    let titleBadge = '';
    let scanTimer = 0;
    let socketSeen = false;
    const warned = new Set();

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const value = nativeParse(raw);
            return value && typeof value === 'object' ? value : fallback;
        } catch (err) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
    }

    function loadConfig() {
        return Object.assign({}, DEFAULTS, readJson(KEY_CONFIG, {}));
    }

    function debugOn() {
        try { return localStorage.getItem(KEY_DEBUG) === '1'; } catch (err) { return false; }
    }

    function log() {
        if (!debugOn()) return;
        console.info.apply(console, [TAG].concat(Array.prototype.slice.call(arguments)));
    }

    function warnOnce(text) {
        if (warned.has(text)) return;
        warned.add(text);
        console.warn(TAG, text);
    }

    function visible(el) {
        return !!el && el.getClientRects().length > 0;
    }

    function shortName(full) {
        return (String(full || '').split(NAME_SPLIT)[0] || '').trim() || String(full || '').trim();
    }

    function currentBotId() {
        const match = location.pathname.match(BOT_HREF);
        return match ? match[1] : '';
    }

    // ---------- bot state ----------
    // Each bot keeps what the bot socket says (net) and what the sidebar shows
    // (dom). Either one can raise the alarm; a shared cooldown keeps it to one.
    function botFor(id, now) {
        let bot = bots.get(id);
        if (!bot) {
            if (!bootAt) {
                bootAt = now;
                later(WARMUP_MS + 120);
            }
            bot = {
                id: id,
                name: '',
                short: '',
                firstSeen: now,
                ready: false,
                announcedAt: 0,
                seenUnread: false,
                dom: { level: 0, readSince: 0, seen: false, via: '' },
                net: { unread: null, msgId: '' },
                anchor: null
            };
            bots.set(id, bot);
            later(ENTRY_WARMUP_MS + 120);
        }
        return bot;
    }

    function unreadNow(bot) {
        return bot.dom.level > 0 || bot.net.unread === true;
    }

    function backlogIsNews(bot) {
        if (config.onLoad === 'all') return true;
        if (config.onLoad === 'none') return false;
        const prev = persisted[bot.id];
        return !!prev && prev.u === 0;
    }

    // The unread flag can land a few seconds after the list on a slow load.
    // A bot that was already unread last session is not news yet.
    function lateBacklog(bot, now) {
        if (bot.seenUnread || now - bootAt > SLOW_LOAD_MS) return false;
        const prev = bootPersisted[bot.id];
        return !!prev && prev.u === 1;
    }

    function viewing(id) {
        return id === currentBotId() && document.visibilityState === 'visible';
    }

    function settle(news, now) {
        let dirty = false;
        bots.forEach(function (bot) {
            if (bot.ready || now < Math.max(bootAt + WARMUP_MS, bot.firstSeen + ENTRY_WARMUP_MS)) return;
            bot.ready = true;
            dirty = true;
            if (unreadNow(bot) && backlogIsNews(bot)) news.push(bot);
        });
        return dirty;
    }

    function savePersisted() {
        const now = Date.now();
        const latest = readJson(KEY_STATE, {});
        bots.forEach(function (bot) {
            if (!bot.ready) return;
            latest[bot.id] = { u: unreadNow(bot) ? 1 : 0, n: bot.short || bot.name || '', t: now };
        });
        const ids = Object.keys(latest);
        if (ids.length > 300) {
            ids.sort(function (a, b) { return (latest[a].t || 0) - (latest[b].t || 0); });
            for (let i = 0; i < ids.length - 300; i++) delete latest[ids[i]];
        }
        persisted = latest;
        writeJson(KEY_STATE, latest);
    }

    function later(ms) {
        setTimeout(function () { queueScan(0); }, ms);
    }

    // ---------- channel 1: the bot WebSocket ----------
    // grok.com talks JSON-RPC over wss://grok.com/ws/bot/. bot.command(listAgents)
    // returns every bot with hasUnread and lastMessageId, including the ones the
    // sidebar keeps folded behind 展开. Later frames that carry the same fields
    // are read the same way, whatever their method name.
    function readAgent(obj) {
        const id = typeof obj.agentId === 'string' ? obj.agentId : (typeof obj.id === 'string' ? obj.id : '');
        if (!id || !AGENT_ID.test(id)) return null;
        // Turn and tool events also carry agentId, and a tool has a name of its
        // own. Only a bot profile (roster / listAgents) may rename the bot.
        const profile = 'avatarShape' in obj || 'avatarColor' in obj || 'lastTurnAt' in obj;
        if (profile || typeof obj.agentId === 'string') knownAgents.add(id);
        else if (!knownAgents.has(id)) return null;
        const unread = typeof obj.hasUnread === 'boolean' ? obj.hasUnread : (typeof obj.unread === 'boolean' ? obj.unread : null);
        const msgId = typeof obj.lastMessageId === 'string' ? obj.lastMessageId : '';
        const name = profile && typeof obj.name === 'string' ? obj.name.trim() : '';
        if (unread === null && !msgId && !name) return null;
        return { id: id, name: name, unread: unread, msgId: msgId };
    }

    function agentRecords(value) {
        const out = [];
        const stack = [{ v: value, d: 0 }];
        const seen = new Set();
        let steps = 0;
        while (stack.length && steps < 5000) {
            const item = stack.pop();
            const v = item.v;
            if (!v || typeof v !== 'object' || seen.has(v)) continue;
            seen.add(v);
            steps++;
            if (!Array.isArray(v)) {
                const rec = readAgent(v);
                if (rec) out.push(rec);
            }
            if (item.d >= 7) continue;
            const keys = Object.keys(v);
            for (let i = 0; i < keys.length && i < 400; i++) {
                const child = v[keys[i]];
                if (child && typeof child === 'object') stack.push({ v: child, d: item.d + 1 });
            }
        }
        return out;
    }

    function netObserve(records) {
        const now = Date.now();
        const news = [];
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            const bot = botFor(rec.id, now);
            if (rec.name) {
                bot.name = rec.name;
                bot.short = shortName(rec.name);
            }
            const net = bot.net;
            const prevUnread = net.unread;
            const prevMsg = net.msgId;
            if (rec.unread !== null) net.unread = rec.unread;
            if (rec.msgId) net.msgId = rec.msgId;
            if (bot.ready && !viewing(bot.id)) {
                const rose = prevUnread === false && net.unread === true;
                // Another message on a bot that is still unread. Only the bot can
                // write while unread: opening the chat clears the flag first.
                const another = prevUnread === true && net.unread === true && !!prevMsg && !!rec.msgId && rec.msgId !== prevMsg;
                if (rose || another) news.push(bot);
            }
            if (net.unread) bot.seenUnread = true;
        }
        const dirty = settle(news, now) || records.length > 0;
        if (dirty) savePersisted();
        if (news.length) announce(news);
    }

    function onSocketFrame(event) {
        const data = event && event.data;
        if (typeof data !== 'string' || data.length < 20 || data.length > 8000000) return;
        // Skip pings and streamed tokens without parsing them.
        if (data.indexOf('nread') === -1 && data.indexOf('lastMessageId') === -1 && data.indexOf('avatarColor') === -1 && data.indexOf('avatarShape') === -1) return;
        let parsed;
        try {
            parsed = nativeParse(data);
        } catch (err) {
            return;
        }
        socketSeen = true;
        const records = agentRecords(parsed);
        if (debugOn()) {
            const label = parsed && (parsed.method || (parsed.id ? 'result#' + parsed.id : '')) || '?';
            log('bot socket', label, records.length + ' 个 Bot 记录', records.slice(0, 20));
        }
        if (records.length) netObserve(records);
    }

    function hookSockets() {
        const Native = window.WebSocket;
        if (!Native || Native.__gbv) return;
        function WrappedWebSocket(url, protocols) {
            const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
            try {
                if (/\/ws\/bot\b/i.test(String(url))) ws.addEventListener('message', onSocketFrame);
            } catch (err) {}
            return ws;
        }
        WrappedWebSocket.prototype = Native.prototype;
        WrappedWebSocket.CONNECTING = Native.CONNECTING;
        WrappedWebSocket.OPEN = Native.OPEN;
        WrappedWebSocket.CLOSING = Native.CLOSING;
        WrappedWebSocket.CLOSED = Native.CLOSED;
        WrappedWebSocket.__gbv = true;
        try {
            window.WebSocket = WrappedWebSocket;
        } catch (err) {
            warnOnce('无法挂接 WebSocket，只能靠侧栏蓝点判断');
        }
    }

    function onRoute() {
        const id = currentBotId();
        const bot = id && bots.get(id);
        // Opening a bot reads it, even when the sidebar row is folded away.
        if (bot && bot.net.unread) {
            bot.net.unread = false;
            if (bot.ready) savePersisted();
        }
        queueScan();
    }

    function hookHistory() {
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
    }

    // ---------- channel 2: the sidebar list ----------
    // Tailwind v4 serializes colors as oklch(), so let a canvas convert them.
    const colorCache = new Map();
    let colorCtx = null;

    function toRgba(value) {
        const key = String(value || '').trim();
        if (!key || key === 'none' || key === 'transparent') return null;
        if (colorCache.has(key)) return colorCache.get(key);
        let out = null;
        const m = key.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
        if (m) {
            const alpha = m[4] == null ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : Number(m[4]));
            out = { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
        } else {
            try {
                if (!colorCtx) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 1;
                    canvas.height = 1;
                    colorCtx = canvas.getContext('2d', { willReadFrequently: true });
                }
                colorCtx.clearRect(0, 0, 1, 1);
                colorCtx.fillStyle = 'transparent';
                colorCtx.fillStyle = key;
                colorCtx.fillRect(0, 0, 1, 1);
                const d = colorCtx.getImageData(0, 0, 1, 1).data;
                out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
            } catch (err) {
                out = null;
            }
        }
        if (colorCache.size > 300) colorCache.clear();
        colorCache.set(key, out);
        return out;
    }

    // A badge colour is saturated. Gray, white and black UI chrome are not.
    function vivid(rgba) {
        if (!rgba || rgba.a < 0.5) return false;
        const r = rgba.r / 255;
        const g = rgba.g / 255;
        const b = rgba.b / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        if (delta < 0.18) return false;
        const light = (max + min) / 2;
        const sat = delta / (1 - Math.abs(2 * light - 1));
        return sat >= 0.35 && light >= 0.15 && light <= 0.9;
    }

    function colored(style) {
        return vivid(toRgba(style.backgroundColor)) || (style.backgroundImage || '').indexOf('gradient') !== -1;
    }

    function roundish(style, w, h) {
        const raw = style.borderTopLeftRadius || '';
        if (raw.indexOf('%') !== -1) return parseFloat(raw) >= 30;
        return (parseFloat(raw) || 0) >= Math.min(w, h) * 0.35;
    }

    function visualMark(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'img' || tag === 'svg' || tag === 'path' || tag === 'g' || tag === 'video' || tag === 'canvas' || tag === 'picture') return null;
        const rect = el.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w < 4 || h < 4 || w > 40 || h > 24) return null;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || parseFloat(style.opacity) < 0.3) return null;
        if (tag === 'circle' || tag === 'ellipse') {
            if (w > 14 || Math.abs(w - h) > 3 || !vivid(toRgba(style.fill))) return null;
            return { level: 1, via: 'svg-dot', el: el };
        }
        const text = (el.textContent || '').trim();
        if (!text) {
            // Avatars are 24px and wrap an image. The unread dot is a bare 8px circle.
            if (w > 14 || h > 14 || Math.abs(w - h) > 3 || el.children.length) return null;
            if (!roundish(style, w, h) || !colored(style)) return null;
            return { level: 1, via: 'dot', el: el };
        }
        if (!COUNT_TEXT.test(text) || w < 12 || h < 12) return null;
        if (!roundish(style, w, h) || !colored(style)) return null;
        return { level: parseInt(text, 10) || 1, via: 'badge', el: el };
    }

    function pseudoMark(el) {
        if (el instanceof SVGElement) return null;
        const sides = ['::after', '::before'];
        for (let i = 0; i < sides.length; i++) {
            const style = getComputedStyle(el, sides[i]);
            const content = style.content;
            if (!content || content === 'none' || content === 'normal') continue;
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const w = parseFloat(style.width);
            const h = parseFloat(style.height);
            if (!(w >= 4 && h >= 4 && w <= 14 && h <= 14) || Math.abs(w - h) > 3) continue;
            if (!roundish(style, w, h) || !colored(style)) continue;
            return { level: 1, via: 'pseudo' + sides[i], el: el };
        }
        return null;
    }

    function selectorMark(row) {
        let hit = null;
        try {
            hit = row.querySelector(config.dotSelector);
        } catch (err) {
            warnOnce('dotSelector 不是合法的 CSS 选择器：' + config.dotSelector);
            return null;
        }
        if (!visible(hit)) return { level: 0, via: 'selector' };
        const text = (hit.textContent || '').trim();
        return { level: COUNT_TEXT.test(text) ? (parseInt(text, 10) || 1) : 1, via: 'selector', el: hit };
    }

    function domMark(row) {
        if (config.dotSelector) {
            const picked = selectorMark(row);
            if (picked) return picked;
        }
        const nodes = row.querySelectorAll('*');
        const limit = Math.min(nodes.length, 80);
        for (let i = -1; i < limit; i++) {
            const el = i < 0 ? row : nodes[i];
            if (!visible(el)) continue;
            const found = visualMark(el) || pseudoMark(el);
            if (found) return found;
        }
        return { level: 0, via: 'dom' };
    }

    // Each sidebar row gets an `agent` prop whose boolean `unread` paints the dot.
    function agentOf(anchor) {
        let fiber = null;
        try {
            const keys = Object.keys(anchor);
            for (let i = 0; i < keys.length; i++) {
                if (keys[i].indexOf('__reactFiber$') === 0) {
                    fiber = anchor[keys[i]];
                    break;
                }
            }
        } catch (err) {
            return null;
        }
        for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
            const props = fiber.memoizedProps;
            const agent = props && props.agent;
            if (agent && typeof agent === 'object' && typeof agent.agentId === 'string') return agent;
        }
        return null;
    }

    function botIdOf(el) {
        const holders = [el];
        if (el.tagName !== 'A') {
            const inner = el.querySelector('a[href*="/bot/"]');
            if (inner) holders.push(inner);
        }
        for (let i = 0; i < holders.length; i++) {
            const match = (holders[i].getAttribute('href') || '').match(BOT_HREF);
            if (match) return match[1];
        }
        return el.getAttribute('data-bot-id') || el.getAttribute('data-agent-id') || '';
    }

    function pickAnchors() {
        if (config.entrySelector) {
            try {
                return Array.prototype.filter.call(document.querySelectorAll(config.entrySelector), visible);
            } catch (err) {
                warnOnce('entrySelector 不是合法的 CSS 选择器：' + config.entrySelector);
                return [];
            }
        }
        const all = Array.prototype.filter.call(document.querySelectorAll('a[href*="/bot/"]'), function (a) {
            return BOT_HREF.test(a.getAttribute('href') || '') && visible(a);
        });
        if (!all.length) return all;
        // The bot tab above the transcript links to /bot/ too; keep the sidebar only.
        const scoped = ['[data-sidebar="sidebar"]', 'nav, aside, [role="navigation"]'];
        for (let i = 0; i < scoped.length; i++) {
            const inside = all.filter(function (a) { return a.closest(scoped[i]); });
            if (inside.length) return inside;
        }
        return all.filter(function (a) {
            return a.getBoundingClientRect().left < window.innerWidth * 0.4;
        });
    }

    function rowOf(anchor) {
        const item = anchor.closest('[data-sidebar="menu-item"], li');
        if (item && item.querySelectorAll('a[href*="/bot/"]').length === 1) return item;
        return anchor;
    }

    function nameOf(anchor, row, agent) {
        if (agent && typeof agent.name === 'string' && agent.name.trim()) return agent.name.trim();
        const label = (anchor.getAttribute('aria-label') || anchor.getAttribute('title') || '').trim();
        const raw = label || anchor.innerText || row.innerText || '';
        const lines = raw.split(/\n+/).map(function (line) {
            return line.replace(/\s+/g, ' ').trim();
        }).filter(function (line) {
            return line && !COUNT_TEXT.test(line);
        });
        let best = '';
        for (let i = 0; i < lines.length && i < 3; i++) {
            if (lines[i].length > best.length) best = lines[i];
        }
        return best;
    }

    function collectEntries() {
        const anchors = pickAnchors();
        const byId = new Map();
        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            const id = botIdOf(anchor);
            if (!id) continue;
            const row = rowOf(anchor);
            const agent = agentOf(anchor);
            let mark;
            if (agent && typeof agent.unread === 'boolean' && !config.dotSelector) {
                mark = { level: agent.unread ? 1 : 0, via: 'agent.unread' };
                if (agent.unread) mark.el = domMark(row).el || null;
            } else {
                mark = domMark(row);
            }
            const prev = byId.get(id);
            if (prev && prev.level >= mark.level) continue;
            const name = nameOf(anchor, row, agent);
            byId.set(id, {
                id: id,
                anchor: anchor,
                row: row,
                name: name,
                short: shortName(name),
                level: mark.level,
                via: mark.via,
                el: mark.el || null
            });
        }
        return Array.from(byId.values());
    }

    function updateSidebarRoot(entries) {
        if (!entries.length) {
            sidebarRoot = null;
            return;
        }
        let root = entries[0].anchor.closest('[data-sidebar="sidebar"]');
        if (!root) {
            root = entries[0].row.parentElement || entries[0].row;
            for (let i = 1; i < entries.length && root; i++) {
                while (root && !root.contains(entries[i].row)) root = root.parentElement;
            }
        }
        sidebarRoot = root;
    }

    function scan() {
        const now = Date.now();
        const entries = collectEntries();
        updateSidebarRoot(entries);
        updateTitle();
        const news = [];
        let dirty = false;
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const bot = botFor(entry.id, now);
            knownAgents.add(entry.id);
            if (entry.name) {
                bot.name = entry.name;
                bot.short = entry.short || shortName(entry.name);
            }
            bot.anchor = entry.anchor;
            const dom = bot.dom;
            dom.via = entry.via;
            dom.seen = true;
            if (!bot.ready) {
                dom.level = entry.level;
                if (entry.level > 0) bot.seenUnread = true;
                continue;
            }
            if (entry.level > 0) {
                dom.readSince = 0;
                // The socket already reported this unread (and spoke, or filed it
                // as backlog); the dot is only the page catching up.
                const socketHadIt = dom.level === 0 && bot.net.unread === true;
                if (entry.level > dom.level && !socketHadIt && !viewing(bot.id)) {
                    if (dom.level === 0 && lateBacklog(bot, now)) log('迟到的旧未读，不播报', bot.short);
                    else news.push(bot);
                }
                if (entry.level !== dom.level) {
                    dom.level = entry.level;
                    dirty = true;
                }
                bot.seenUnread = true;
            } else if (dom.level > 0 || bot.net.unread) {
                if (!dom.readSince) {
                    dom.readSince = now;
                    later(READ_GRACE_MS + 120);
                } else if (now - dom.readSince >= READ_GRACE_MS) {
                    dom.level = 0;
                    dom.readSince = 0;
                    // The row has no dot, so whatever the socket last said is stale.
                    if (bot.net.unread) bot.net.unread = false;
                    dirty = true;
                }
            }
        }
        if (settle(news, now)) dirty = true;
        if (dirty) savePersisted();
        if (news.length) announce(news);
        if (!entries.length && !bots.size) log('还没有找到 Bot：侧栏里没有 /bot/ 链接，Bot WebSocket 也还没有数据');
    }

    function queueScan(delay) {
        if (scanTimer) return;
        scanTimer = setTimeout(function () {
            scanTimer = 0;
            try {
                scan();
            } catch (err) {
                console.error(TAG, err);
            }
        }, delay == null ? 300 : delay);
    }

    // ---------- announcements ----------
    function displayName(bot) {
        const name = config.fullName ? (bot.name || bot.short) : (bot.short || bot.name);
        return name || '未命名';
    }

    function fill(name) {
        const template = String(config.template || DEFAULTS.template);
        return template.indexOf('{name}') === -1 ? name + ' ' + template : template.split('{name}').join(name);
    }

    function phrasesFor(names) {
        if (names.length <= 3) return names.map(fill);
        return [fill(names.slice(0, 2).join('、') + ' 等 ' + names.length + ' 个')];
    }

    function announce(list) {
        const now = Date.now();
        const spoken = readJson(KEY_SPOKEN, {});
        const fresh = [];
        list.forEach(function (bot) {
            if (fresh.indexOf(bot) !== -1) return;
            if (bot.announcedAt && now - bot.announcedAt < COOLDOWN_MS) return;
            bot.announcedAt = now;
            // Another Grok tab already read this one out.
            if (spoken[bot.id] && now - spoken[bot.id] < CROSS_TAB_MS) return;
            spoken[bot.id] = now;
            fresh.push(bot);
        });
        Object.keys(spoken).forEach(function (id) {
            if (now - spoken[id] > 86400000) delete spoken[id];
        });
        writeJson(KEY_SPOKEN, spoken);
        if (!fresh.length || !config.enabled) return;
        const names = fresh.map(displayName);
        const ids = fresh.map(function (bot) { return bot.id; });
        console.info(TAG, '新消息：' + names.join('、'));
        phrasesFor(names).forEach(function (text, i) {
            say(text, names.length <= 3 ? [ids[i]] : ids);
        });
    }

    function say(text, ids) {
        const item = { text: text, ids: ids || [], at: Date.now() };
        toast(text, item.ids[0]);
        if (!synth()) {
            speech.state = 'unsupported';
            fallback(item);
            return;
        }
        speech.queue.push(item);
        if (speech.queue.length > 20) speech.queue.splice(0, speech.queue.length - 20);
        pump();
    }

    // ---------- speech ----------
    function synth() {
        return typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function'
            ? window.speechSynthesis
            : null;
    }

    function activated() {
        const ua = navigator.userActivation;
        return !!(ua && ua.hasBeenActive);
    }

    function pickVoice(voices) {
        if (!voices.length) return null;
        if (config.voice) {
            const wanted = String(config.voice).toLowerCase();
            for (let i = 0; i < voices.length; i++) {
                if (voices[i].name.toLowerCase() === wanted) return voices[i];
            }
            for (let i = 0; i < voices.length; i++) {
                if (voices[i].name.toLowerCase().indexOf(wanted) !== -1) return voices[i];
            }
        }
        let best = null;
        let bestScore = 0;
        for (let i = 0; i < voices.length; i++) {
            const voice = voices[i];
            const lang = String(voice.lang || '').toLowerCase().replace('_', '-');
            if (lang.indexOf('zh') !== 0 && !/chinese|中文|普通话/i.test(voice.name)) continue;
            let score = 1;
            if (lang === 'zh-cn' || lang.indexOf('zh-hans') === 0) score += 4;
            else if (lang.indexOf('zh-tw') === 0 || lang.indexOf('zh-hk') === 0) score += 1;
            if (/natural|neural/i.test(voice.name)) score += 3;
            if (/xiaoxiao|xiaoyi|yunxi|晓晓/i.test(voice.name)) score += 2;
            if (/google/i.test(voice.name)) score += 2;
            if (score > bestScore) {
                best = voice;
                bestScore = score;
            }
        }
        return best;
    }

    function currentVoice() {
        const s = synth();
        if (!s) return null;
        const voices = s.getVoices() || [];
        const key = config.voice + '|' + voices.length;
        if (key !== speech.voiceKey) {
            speech.voiceKey = key;
            speech.voice = pickVoice(voices);
        }
        return speech.voice;
    }

    function clamp(value, min, max, fallbackValue) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallbackValue;
        return Math.min(max, Math.max(min, n));
    }

    function pump() {
        const s = synth();
        if (!s || speech.busy || !speech.queue.length) {
            refreshUi();
            return;
        }
        if (speech.state === 'locked' && !activated()) {
            refreshUi();
            return;
        }
        const item = speech.queue[0];
        const voice = item.plain ? null : currentVoice();
        const utter = new SpeechSynthesisUtterance(item.text);
        utter.lang = voice ? voice.lang : 'zh-CN';
        if (voice) utter.voice = voice;
        utter.rate = clamp(config.rate, 0.5, 2, 1);
        utter.pitch = clamp(config.pitch, 0, 2, 1);
        utter.volume = item.silent ? 0 : clamp(config.volume, 0, 1, 1);
        let over = false;
        let guard = 0;
        const finish = function (keep) {
            if (over) return;
            over = true;
            clearTimeout(guard);
            speech.busy = false;
            speech.current = null;
            if (!keep) {
                const index = speech.queue.indexOf(item);
                if (index !== -1) speech.queue.splice(index, 1);
            }
            refreshUi();
        };
        utter.onstart = function () {
            if (speech.state !== 'ready') {
                speech.state = 'ready';
                refreshUi();
            }
        };
        utter.onend = function () {
            finish(false);
            setTimeout(pump, 0);
        };
        utter.onerror = function (event) {
            const code = event && event.error;
            // Chrome refuses to speak until the page has had a click or a key press.
            if (code === 'not-allowed') {
                speech.state = 'locked';
                if (item.silent) {
                    finish(false);
                    return;
                }
                fallback(item);
                finish(true);
                return;
            }
            // A cloud voice can fail offline. Retry once with the default voice.
            if (!item.plain && voice && /synthesis-failed|network|voice-unavailable|language-unavailable/.test(code || '')) {
                item.plain = true;
                finish(true);
                setTimeout(pump, 0);
                return;
            }
            log('语音出错', code);
            finish(false);
            setTimeout(pump, 0);
        };
        guard = setTimeout(function () {
            if (over) return;
            finish(false);
            try { s.cancel(); } catch (err) {}
            setTimeout(pump, 0);
        }, 12000 + item.text.length * 250);
        speech.busy = true;
        // Chrome drops the end event if the utterance is garbage collected.
        speech.current = utter;
        try {
            if (s.paused) s.resume();
            s.speak(utter);
        } catch (err) {
            finish(false);
        }
    }

    // A silent utterance tells whether this page may speak before any click.
    function probe() {
        const s = synth();
        if (!s) {
            speech.state = 'unsupported';
            return;
        }
        if (activated()) {
            speech.state = 'ready';
            return;
        }
        speech.queue.unshift({ text: '。', ids: [], silent: true, at: Date.now() });
        pump();
    }

    function onGesture() {
        if (speech.state === 'locked' || speech.state === 'unknown') speech.state = 'ready';
        // Speak inside the gesture so engines that want a fresh activation accept it.
        pump();
    }

    function openBot(id) {
        if (!id) return;
        const bot = bots.get(id);
        const anchor = bot && bot.anchor && bot.anchor.isConnected
            ? bot.anchor
            : document.querySelector('a[href$="/bot/' + id + '"]');
        if (anchor) anchor.click();
        else location.assign('/bot/' + id);
    }

    function fallback(item) {
        if (item.notified || !config.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        item.notified = true;
        try {
            const note = new Notification('Grok Bot 新消息', { body: item.text, tag: 'gbv-' + (item.ids[0] || 'test') });
            note.onclick = function () {
                window.focus();
                openBot(item.ids[0]);
                note.close();
            };
        } catch (err) {}
    }

    // ---------- page UI ----------
    function darkPage() {
        const root = document.documentElement;
        if (root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark') return true;
        const targets = [document.body, root];
        for (let i = 0; i < targets.length; i++) {
            if (!targets[i]) continue;
            const rgba = toRgba(getComputedStyle(targets[i]).backgroundColor);
            if (rgba && rgba.a > 0.25) {
                return (0.2126 * rgba.r + 0.7152 * rgba.g + 0.0722 * rgba.b) / 255 < 0.45;
            }
        }
        return false;
    }

    function ensureUiRoot() {
        if (uiRoot && uiRoot.isConnected) return uiRoot;
        if (!document.body) return null;
        uiRoot = document.createElement('div');
        uiRoot.id = 'gbv-root';
        document.body.appendChild(uiRoot);
        return uiRoot;
    }

    function pendingItems() {
        return speech.queue.filter(function (item) { return !item.silent; });
    }

    function refreshUi() {
        updateTitle();
        const show = speech.state === 'locked' && config.enabled;
        if (!show) {
            if (pill) {
                pill.remove();
                pill = null;
            }
            return;
        }
        const root = ensureUiRoot();
        if (!root) return;
        if (!pill || !pill.isConnected) {
            pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'gbv-pill';
            root.insertBefore(pill, root.firstChild);
        }
        const pending = pendingItems();
        pill.classList.toggle('is-alert', pending.length > 0);
        pill.classList.toggle('is-dark', darkPage());
        pill.textContent = pending.length
            ? '🔔 ' + pending.length + ' 条 Bot 新消息待播报 · 点我收听'
            : '🔈 Bot 语音播报待启用 · 点一下页面任意处';
        pill.title = pending.length
            ? pending.map(function (item) { return item.text; }).join('\n')
            : '浏览器要求先和页面交互一次，才允许网页朗读语音。';
    }

    function updateTitle() {
        const pending = speech.state === 'locked' ? pendingItems().length : 0;
        const badge = pending ? '(🔔' + pending + ') ' : '';
        let base = document.title;
        if (titleBadge && base.indexOf(titleBadge) === 0) base = base.slice(titleBadge.length);
        titleBadge = badge;
        const next = badge + base;
        if (next !== document.title) document.title = next;
    }

    function toast(text, id) {
        if (!config.toast) return;
        const root = ensureUiRoot();
        if (!root) return;
        const card = document.createElement('div');
        card.className = 'gbv-toast' + (darkPage() ? ' is-dark' : '');
        card.title = '点击打开这个 Bot';
        const icon = document.createElement('span');
        icon.className = 'gbv-icon';
        icon.textContent = '🔊';
        const body = document.createElement('span');
        body.textContent = text;
        card.appendChild(icon);
        card.appendChild(body);
        card.addEventListener('click', function () {
            openBot(id);
            card.remove();
        });
        root.appendChild(card);
        const cards = root.querySelectorAll('.gbv-toast');
        for (let i = 0; i < cards.length - 4; i++) cards[i].remove();
        setTimeout(function () { card.classList.add('is-leaving'); }, 7000);
        setTimeout(function () { card.remove(); }, 7400);
    }

    function injectStyle() {
        if (document.getElementById('gbv-style')) return;
        const style = document.createElement('style');
        style.id = 'gbv-style';
        style.textContent = [
            '#gbv-root{position:fixed;top:64px;right:16px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;font-family:inherit;}',
            '#gbv-root>*{pointer-events:auto;}',
            '.gbv-pill{display:inline-flex;align-items:center;gap:6px;max-width:min(360px,calc(100vw - 32px));padding:8px 14px;border-radius:999px;border:1px solid #bfdbfe;background:#eff6ff;color:#1e3a8a;font:600 13px/1.35 inherit;box-shadow:0 4px 14px rgba(30,64,175,.14);cursor:pointer;}',
            '.gbv-pill.is-alert{border-color:#fdba74;background:#fff7ed;color:#9a3412;animation:gbv-pulse 1.6s ease-in-out infinite;}',
            '.gbv-pill.is-dark{border-color:rgba(147,197,253,.45);background:rgba(30,58,138,.55);color:#dbeafe;}',
            '.gbv-pill.is-dark.is-alert{border-color:rgba(251,146,60,.55);background:rgba(124,45,18,.6);color:#ffedd5;}',
            '.gbv-toast{display:flex;align-items:center;gap:8px;max-width:min(380px,calc(100vw - 32px));padding:10px 14px;border-radius:12px;border:1px solid #e5e7eb;background:#fff;color:#111827;font:500 13px/1.4 inherit;box-shadow:0 8px 24px rgba(0,0,0,.12);cursor:pointer;opacity:1;transform:none;transition:opacity .35s ease,transform .35s ease;}',
            '.gbv-toast.is-dark{border-color:rgba(255,255,255,.12);background:#1f2937;color:#f3f4f6;box-shadow:0 8px 24px rgba(0,0,0,.4);}',
            '.gbv-toast.is-leaving{opacity:0;transform:translateY(-6px);}',
            '.gbv-icon{flex:none;}',
            '@keyframes gbv-pulse{0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,.35);}50%{box-shadow:0 0 0 6px rgba(249,115,22,0);}}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    // ---------- console helpers ----------
    function describe(el, row) {
        if (!el) return '';
        const parts = [];
        let cur = el;
        for (let i = 0; cur && i < 3; i++) {
            let part = cur.tagName.toLowerCase();
            const cls = typeof cur.className === 'string' ? cur.className : (cur.getAttribute('class') || '');
            const names = cls.split(/\s+/).filter(Boolean).slice(0, 4);
            for (let j = 0; j < names.length; j++) part += '.' + (window.CSS && CSS.escape ? CSS.escape(names[j]) : names[j]);
            parts.unshift(part);
            if (cur === row) break;
            cur = cur.parentElement;
        }
        return parts.join(' > ');
    }

    function findEntry(query) {
        const entries = collectEntries();
        if (!query) {
            return entries.filter(function (e) { return e.level > 0; })[0] || entries[0] || null;
        }
        const q = String(query).toLowerCase();
        return entries.filter(function (e) {
            return e.id === query || e.name.toLowerCase().indexOf(q) !== -1;
        })[0] || null;
    }

    function outline(el, color) {
        const prev = [el.style.outline, el.style.outlineOffset];
        el.style.outline = '2px dashed ' + color;
        el.style.outlineOffset = '2px';
        return function () {
            el.style.outline = prev[0];
            el.style.outlineOffset = prev[1];
        };
    }

    function exposeApi() {
        window.GrokBotVoice = {
            // Every bot the script knows, from the socket and from the sidebar.
            state: function () {
                const rows = [];
                bots.forEach(function (bot) {
                    rows.push({
                        id: bot.id,
                        名称: bot.short,
                        接口未读: bot.net.unread,
                        侧栏未读: bot.dom.seen ? bot.dom.level : '不在侧栏',
                        就绪: bot.ready
                    });
                });
                console.table(rows);
                return { 语音: speech.state, 接口通道: socketSeen ? '已收到数据' : '还没收到数据', 待播报: pendingItems().map(function (item) { return item.text; }), bots: rows };
            },
            // What the sidebar shows right now, and which element counts as the dot.
            scan: function () {
                const rows = collectEntries().map(function (e) {
                    return { id: e.id, 名称: e.short, 完整名称: e.name, 未读: e.level, 判定依据: e.via, 标记元素: describe(e.el, e.row) };
                });
                console.table(rows);
                return rows;
            },
            highlight: function (ms) {
                const undo = [];
                collectEntries().forEach(function (e) {
                    undo.push(outline(e.row, e.level ? '#ef4444' : '#3b82f6'));
                    if (e.el) undo.push(outline(e.el, '#ef4444'));
                });
                setTimeout(function () { undo.forEach(function (fn) { fn(); }); }, ms || 6000);
                return undo.length;
            },
            inspect: function (query) {
                const entry = findEntry(query);
                if (!entry) {
                    console.warn(TAG, '侧栏里没有找到这个 Bot：', query);
                    return [];
                }
                const out = [];
                const nodes = [entry.row].concat(Array.prototype.slice.call(entry.row.querySelectorAll('*'), 0, 60));
                nodes.forEach(function (el) {
                    const rect = el.getBoundingClientRect();
                    const style = getComputedStyle(el);
                    out.push({
                        元素: describe(el, entry.row),
                        尺寸: Math.round(rect.width) + '×' + Math.round(rect.height),
                        背景: style.backgroundColor,
                        圆角: style.borderTopLeftRadius,
                        文本: el.children.length ? '' : (el.textContent || '').trim().slice(0, 24)
                    });
                    ['::before', '::after'].forEach(function (side) {
                        const ps = getComputedStyle(el, side);
                        if (!ps.content || ps.content === 'none' || ps.content === 'normal') return;
                        out.push({ 元素: describe(el, entry.row) + side, 尺寸: ps.width + '×' + ps.height, 背景: ps.backgroundColor, 圆角: ps.borderTopLeftRadius, 文本: ps.content });
                    });
                });
                console.log(TAG, entry.name, '未读=' + entry.level, '依据=' + entry.via);
                console.table(out);
                return out;
            },
            test: function (name) {
                const entry = findEntry();
                say(fill(name || (entry && entry.short) || '测试'), entry ? [entry.id] : []);
                return speech.state;
            },
            voices: function () {
                const s = synth();
                const list = s ? s.getVoices() : [];
                const chosen = currentVoice();
                const rows = list.filter(function (v) { return /^zh/i.test(v.lang) || /chinese|中文/i.test(v.name); }).map(function (v) {
                    return { 名称: v.name, 语言: v.lang, 本地: v.localService, 选中: chosen === v ? '✓' : '' };
                });
                if (!list.length) console.info(TAG, '语音列表还没加载出来，稍后再试一次。');
                console.table(rows);
                return rows;
            },
            config: function () {
                return Object.assign({}, config);
            },
            set: function (patch) {
                if (!patch || typeof patch !== 'object') return Object.assign({}, config);
                const stored = readJson(KEY_CONFIG, {});
                Object.keys(patch).forEach(function (key) {
                    if (!(key in DEFAULTS)) return;
                    if (patch[key] === null) delete stored[key];
                    else stored[key] = patch[key];
                });
                writeJson(KEY_CONFIG, stored);
                config = loadConfig();
                speech.voiceKey = '';
                if (patch.notify === true && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    Notification.requestPermission();
                }
                refreshUi();
                queueScan(0);
                return Object.assign({}, config);
            },
            debug: function (on) {
                try {
                    if (on === false) localStorage.removeItem(KEY_DEBUG);
                    else localStorage.setItem(KEY_DEBUG, '1');
                } catch (err) {}
                return on === false ? '调试日志已关闭' : '调试日志已开启，Bot WebSocket 的每帧解析结果会打印在控制台';
            },
            reset: function () {
                try {
                    localStorage.removeItem(KEY_STATE);
                    localStorage.removeItem(KEY_SPOKEN);
                } catch (err) {}
                persisted = {};
                return '已清空历史记录；下次加载页面时，当前的未读会被当作旧消息';
            }
        };
        if (window.__GBV_TEST__) {
            window.__GBV = { bots: bots, netObserve: netObserve, agentRecords: agentRecords, onSocketFrame: onSocketFrame, domMark: domMark, scan: scan, speech: speech };
        }
    }

    // ---------- boot ----------
    function observe() {
        const observer = new MutationObserver(function (records) {
            if (scanTimer) return;
            for (let i = 0; i < records.length; i++) {
                let node = records[i].target;
                if (node && node.nodeType !== 1) node = node.parentElement;
                if (!node || (uiRoot && uiRoot.contains(node))) continue;
                if (!sidebarRoot || !sidebarRoot.isConnected || sidebarRoot.contains(node) || node.contains(sidebarRoot)) {
                    queueScan();
                    return;
                }
            }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: OBSERVED_ATTRS
        });
        setInterval(function () { queueScan(); }, 5000);
        document.addEventListener('visibilitychange', function () { queueScan(); });
    }

    function boot() {
        if (window.top !== window.self) return;
        if (window.__GBV_INSTALLED__) return;
        window.__GBV_INSTALLED__ = true;
        hookSockets();
        hookHistory();
        exposeApi();
        ['pointerdown', 'keydown', 'touchend'].forEach(function (type) {
            window.addEventListener(type, onGesture, true);
        });
        const s = synth();
        if (s && s.addEventListener) {
            s.addEventListener('voiceschanged', function () { speech.voiceKey = ''; });
        }
        const start = function () {
            injectStyle();
            observe();
            probe();
            queueScan(0);
        };
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    }

    boot();
})();
