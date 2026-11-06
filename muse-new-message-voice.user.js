// ==UserScript==
// @name         Muse New Message Voice
// @name:zh-CN   Muse 新消息语音播报
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Speak "Muse「<chat>」有新的消息请查收" when a Muse chat gets a new message. Reads the chat list the page keeps in memory and refreshes it every 20 seconds, so side chats folded away in the sidebar are covered too.
// @description:zh-CN Muse 的主要聊天或任意旁聊收到新消息时，用浏览器语音朗读「Muse「[聊天标题]」有新的消息请查收」。Muse 的连接全程加密，脚本读取页面自己的聊天列表（含未读数和运行状态），每 20 秒让页面刷新一次，所以侧栏折叠起来的旁聊也能听到。正在看的那个聊天不播报；发完消息切走，回复到了会提醒。页面没点过之前浏览器不让出声，脚本会先排队，并在标签页图标上显示数字角标，点一下页面就补播。
// @author       Anna-SAP
// @match        https://muse.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=muse.ai
// @run-at       document-start
// @inject-into  page
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/muse-new-message-voice.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/muse-new-message-voice.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[MuseVoice]';
    const KEY_CONFIG = 'mnv:config';
    const KEY_STATE = 'mnv:state';
    const KEY_SPOKEN = 'mnv:spoken';
    const KEY_DEBUG = 'mnv:debug';
    const DEFAULTS = {
        enabled: true,
        template: 'Muse「{name}」有新的消息请查收',
        mainName: '主要聊天',
        maxName: 24,
        voice: '',
        rate: 1,
        pitch: 1,
        volume: 1,
        onLoad: 'away',
        toast: true,
        notify: false,
        pollSec: 20
    };
    const LIST_KEY = 'thread-sessions';
    const ROW_SELECTOR = '[data-testid="hatch-thread-row"]';
    const THREAD_PATH = /^\/thread\/([0-9a-f]{8}-[0-9a-f-]{27})/i;
    const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;
    const COOLDOWN_MS = 30000;
    const CROSS_TAB_MS = 15000;
    const HINT_DELAY_MS = 1200;
    const HINT_GAP_MS = 5000;

    const threads = new Map();
    const seenAt = new Map();
    const speech = { state: 'unknown', queue: [], busy: false, current: null, voice: null, voiceKey: '' };
    let config = loadConfig();
    let persisted = readJson(KEY_STATE, {});
    let client = null;
    let baselined = false;
    let primaryId = '';
    let watching = '';
    let lastAsk = 0;
    let lastList = 0;
    let pollTimer = 0;
    let hintTimer = 0;
    let uiRoot = null;
    let pill = null;
    let titleBadge = '';
    let iconLink = null;
    const warned = new Set();

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const value = JSON.parse(raw);
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

    // ---------- who is looking ----------
    function activeThreadId() {
        const match = location.pathname.match(THREAD_PATH);
        if (match) return match[1].toLowerCase();
        return location.pathname === '/' ? primaryId : '';
    }

    function attended() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    function viewing(id) {
        return attended() && activeThreadId() === id;
    }

    // Remembers when each chat was last on screen, so a reply the user already
    // read does not get announced by the next list refresh after they leave.
    function noteAttention() {
        const id = attended() ? activeThreadId() : '';
        if (id === watching) return;
        if (watching) seenAt.set(watching, Date.now());
        watching = id;
    }

    function hookHistory() {
        const nativePush = history.pushState;
        const nativeReplace = history.replaceState;
        history.pushState = function () {
            const result = nativePush.apply(this, arguments);
            noteAttention();
            return result;
        };
        history.replaceState = function () {
            const result = nativeReplace.apply(this, arguments);
            noteAttention();
            return result;
        };
        window.addEventListener('popstate', noteAttention);
    }

    // ---------- the chat list ----------
    // Everything on the gateway socket is Noise-encrypted, so the frames say
    // nothing. The decrypted chat list lands in the page's TanStack Query cache,
    // which also holds side chats the sidebar has folded away.
    function fiberOf(el) {
        const keys = Object.keys(el);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('__reactFiber$') === 0) return el[keys[i]];
        }
        return null;
    }

    function findClient() {
        const seeds = document.querySelectorAll('button, a, input, textarea');
        for (let i = 0; i < seeds.length && i < 40; i++) {
            let fiber = fiberOf(seeds[i]);
            for (let depth = 0; fiber && depth < 1000; depth++, fiber = fiber.return) {
                const props = fiber.memoizedProps;
                const found = props && (props.client || props.value);
                if (found && typeof found.getQueryCache === 'function') return found;
            }
            if (fiberOf(seeds[i])) return null;
        }
        return null;
    }

    function listQuery() {
        if (!client) return null;
        const all = client.getQueryCache().findAll({ queryKey: [LIST_KEY] }).filter(function (query) {
            return Array.isArray(query.state.data);
        });
        return all.filter(function (query) { return query.getObserversCount() > 0; })[0] || all[0] || null;
    }

    function readThread(item) {
        return {
            id: item.session_id,
            title: typeof item.title === 'string' ? item.title : '',
            primary: item.is_primary === true,
            unread: Number(item.unread_count) || 0,
            status: typeof item.status === 'string' ? item.status : '',
            updatedAt: Number(item.updated_at) || 0,
            announcedAt: 0
        };
    }

    function backlogIsNews(id) {
        if (config.onLoad === 'all') return true;
        if (config.onLoad === 'none') return false;
        const prev = persisted[id];
        return !!prev && prev.u === 0;
    }

    function isNews(prev, next) {
        if (viewing(next.id)) return false;
        if (next.updatedAt <= (seenAt.get(next.id) || 0)) return false;
        if (next.unread > prev.unread) return true;
        if (next.status === 'running' || next.updatedAt <= prev.updatedAt) return false;
        // Something was added and the turn is over. unread_count alone misses
        // this: it sat at 1 across a real reply while the page's mark-read was in
        // flight, and it stays 0 when the page marks the open chat read itself.
        // Renaming a chat may also move updated_at, so a read chat needs a turn
        // that just ended, or nobody at the page. A silent heartbeat moves nothing.
        return next.unread > 0 || prev.status === 'running' || !attended();
    }

    // Only lists from the server land here. A pushed update bumps unread_count
    // optimistically, and the server has been seen to take that back 2s later.
    function onServerList(list) {
        const news = [];
        let dirty = !baselined;
        lastList = Date.now();
        const main = list.filter(function (item) { return item && item.is_primary === true; })[0];
        if (main && typeof main.session_id === 'string') primaryId = main.session_id;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (!item || typeof item.session_id !== 'string' || item.archived === true) continue;
            const next = readThread(item);
            const prev = threads.get(next.id);
            if (prev) next.announcedAt = prev.announcedAt;
            threads.set(next.id, next);
            const fresh = prev
                ? isNews(prev, next)
                : next.unread > 0 && (baselined || backlogIsNews(next.id)) && !viewing(next.id);
            if (fresh) news.push(next);
            if (!prev || (prev.unread > 0) !== (next.unread > 0)) dirty = true;
        }
        baselined = true;
        noteAttention();
        updateTitle();
        if (dirty) savePersisted();
        if (news.length) announce(news);
    }

    function savePersisted() {
        const now = Date.now();
        const latest = readJson(KEY_STATE, {});
        threads.forEach(function (thread) {
            latest[thread.id] = { u: thread.unread > 0 ? 1 : 0, t: now };
        });
        const ids = Object.keys(latest);
        if (ids.length > 500) {
            ids.sort(function (a, b) { return (latest[a].t || 0) - (latest[b].t || 0); });
            for (let i = 0; i < ids.length - 500; i++) delete latest[ids[i]];
        }
        persisted = latest;
        writeJson(KEY_STATE, latest);
    }

    function pollMs() {
        const sec = Number(config.pollSec);
        return Number.isFinite(sec) && sec > 0 ? Math.max(10, sec) * 1000 : 0;
    }

    // Goes through the page's own query, so it uses the page's encrypted
    // connection. The page refreshes this list on its own but can lag by 20s
    // and sometimes fails, so it cannot be left to the page.
    function refresh() {
        lastAsk = Date.now();
        const query = listQuery();
        if (!query || query.state.fetchStatus !== 'idle') return;
        const ask = client.refetchQueries({ queryKey: query.queryKey, exact: true }, { cancelRefetch: false });
        if (ask && ask.catch) ask.catch(function () {});
    }

    function schedulePoll() {
        clearTimeout(pollTimer);
        const ms = pollMs();
        if (!ms) return;
        pollTimer = setTimeout(function () {
            refresh();
            schedulePoll();
        }, ms);
    }

    function hint() {
        if (hintTimer) return;
        const wait = Math.max(HINT_DELAY_MS, lastAsk + HINT_GAP_MS - Date.now());
        hintTimer = setTimeout(function () {
            hintTimer = 0;
            refresh();
        }, wait);
    }

    function onCacheEvent(event) {
        const query = event && event.query;
        if (!query) return;
        // Timers crawl in a background tab, but pushed frames still land here.
        const ms = pollMs();
        if (ms && Date.now() - lastAsk >= ms) {
            lastAsk = Date.now();
            setTimeout(refresh, 0);
        }
        if (query.queryKey[0] !== LIST_KEY || event.type !== 'updated') return;
        const action = event.action || {};
        if (action.type !== 'success' || !Array.isArray(query.state.data)) return;
        if (action.manual) hint();
        else onServerList(query.state.data);
    }

    function attach(tries) {
        const found = findClient();
        if (!found) {
            if (tries === 60) warnOnce('页面加载 60 秒了还没找到 Muse 的数据层，脚本继续等待');
            setTimeout(function () { attach(tries + 1); }, tries < 60 ? 1000 : 10000);
            return;
        }
        client = found;
        client.getQueryCache().subscribe(onCacheEvent);
        const query = listQuery();
        if (query) onServerList(query.state.data);
        schedulePoll();
        setTimeout(function () {
            if (!listQuery()) log('数据层已找到，但还没有聊天列表（可能未登录，或 Muse 改了缓存键）：' + LIST_KEY);
        }, 30000);
    }

    // ---------- announcements ----------
    function displayName(thread) {
        if (thread.primary) return String(config.mainName || DEFAULTS.mainName);
        const clean = thread.title.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
        const chars = Array.from(clean);
        const max = Number(config.maxName) > 0 ? Number(config.maxName) : DEFAULTS.maxName;
        return chars.slice(0, max).join('') || '新旁聊';
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
        list.forEach(function (thread) {
            if (fresh.indexOf(thread) !== -1) return;
            if (thread.announcedAt && now - thread.announcedAt < COOLDOWN_MS) return;
            thread.announcedAt = now;
            // Another Muse tab already read this one out.
            if (spoken[thread.id] && now - spoken[thread.id] < CROSS_TAB_MS) return;
            spoken[thread.id] = now;
            fresh.push(thread);
        });
        Object.keys(spoken).forEach(function (id) {
            if (now - spoken[id] > 86400000) delete spoken[id];
        });
        writeJson(KEY_SPOKEN, spoken);
        if (!fresh.length || !config.enabled) return;
        const names = fresh.map(displayName);
        const ids = fresh.map(function (thread) { return thread.id; });
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

    function rowThreadId(row) {
        let fiber = fiberOf(row);
        for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
            const meta = fiber.memoizedProps && fiber.memoizedProps.actionAnalyticsMetadata;
            if (meta && typeof meta === 'object') return meta.thread_id || '';
        }
        return '';
    }

    function openThread(id) {
        if (!id) return;
        const rows = document.querySelectorAll(ROW_SELECTOR);
        for (let i = 0; i < rows.length; i++) {
            if (rowThreadId(rows[i]) === id) {
                rows[i].click();
                return;
            }
        }
        location.assign(id === primaryId ? '/' : '/thread/' + id);
    }

    function fallback(item) {
        if (item.notified || !config.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        item.notified = true;
        try {
            const note = new Notification('Muse 新消息', { body: item.text, tag: 'mnv-' + (item.ids[0] || 'test') });
            note.onclick = function () {
                window.focus();
                openThread(item.ids[0]);
                note.close();
            };
        } catch (err) {}
    }

    // ---------- page UI ----------
    // Modern CSS colours serialize as oklch() or lab(), so let a canvas convert them.
    let colorCtx = null;

    function toRgba(value) {
        const key = String(value || '').trim();
        if (!key || key === 'none' || key === 'transparent') return null;
        const m = key.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
        if (m) {
            const alpha = m[4] == null ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : Number(m[4]));
            return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
        }
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
            return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
        } catch (err) {
            return null;
        }
    }

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
        uiRoot.id = 'mnv-root';
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
            pill.className = 'mnv-pill';
            root.insertBefore(pill, root.firstChild);
        }
        const pending = pendingItems();
        pill.classList.toggle('is-alert', pending.length > 0);
        pill.classList.toggle('is-dark', darkPage());
        pill.textContent = pending.length
            ? '🔔 ' + pending.length + ' 条 Muse 新消息待播报 · 点我收听'
            : '🔈 Muse 语音播报待启用 · 点一下页面任意处';
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
        updateFavicon(pending);
    }

    // A pinned tab shows no title, so put the waiting count on the tab icon.
    function updateFavicon(pending) {
        const head = document.head;
        if (!head) return;
        if (!pending) {
            if (!iconLink) return;
            iconLink.remove();
            iconLink = null;
            head.querySelectorAll('link[data-mnv-rel]').forEach(function (link) {
                link.rel = link.getAttribute('data-mnv-rel');
                link.removeAttribute('data-mnv-rel');
            });
            return;
        }
        const label = pending > 9 ? '9+' : String(pending);
        if (iconLink && iconLink.getAttribute('data-count') === label && iconLink.isConnected) return;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.arc(32, 32, 31, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + (label.length > 1 ? 34 : 44) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 32, 35);
        head.querySelectorAll('link[rel~="icon"]').forEach(function (link) {
            if (link === iconLink) return;
            link.setAttribute('data-mnv-rel', link.rel);
            link.rel = 'mnv-icon-off';
        });
        if (!iconLink) {
            iconLink = document.createElement('link');
            iconLink.rel = 'icon';
            iconLink.type = 'image/png';
        }
        iconLink.setAttribute('data-count', label);
        iconLink.href = canvas.toDataURL('image/png');
        if (!iconLink.isConnected) head.appendChild(iconLink);
    }

    function toast(text, id) {
        if (!config.toast) return;
        const root = ensureUiRoot();
        if (!root) return;
        const card = document.createElement('div');
        card.className = 'mnv-toast' + (darkPage() ? ' is-dark' : '');
        card.title = '点击打开这个聊天';
        const icon = document.createElement('span');
        icon.className = 'mnv-icon';
        icon.textContent = '🔊';
        const body = document.createElement('span');
        body.textContent = text;
        card.appendChild(icon);
        card.appendChild(body);
        card.addEventListener('click', function () {
            openThread(id);
            card.remove();
        });
        root.appendChild(card);
        const cards = root.querySelectorAll('.mnv-toast');
        for (let i = 0; i < cards.length - 4; i++) cards[i].remove();
        setTimeout(function () { card.classList.add('is-leaving'); }, 7000);
        setTimeout(function () { card.remove(); }, 7400);
    }

    function injectStyle() {
        if (document.getElementById('mnv-style')) return;
        const style = document.createElement('style');
        style.id = 'mnv-style';
        style.textContent = [
            '#mnv-root{position:fixed;top:64px;right:16px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;font-family:inherit;}',
            '#mnv-root>*{pointer-events:auto;}',
            '.mnv-pill{display:inline-flex;align-items:center;gap:6px;max-width:min(360px,calc(100vw - 32px));padding:8px 14px;border-radius:999px;border:1px solid #bfdbfe;background:#eff6ff;color:#1e3a8a;font:600 13px/1.35 inherit;box-shadow:0 4px 14px rgba(30,64,175,.14);cursor:pointer;}',
            '.mnv-pill.is-alert{border-color:#fdba74;background:#fff7ed;color:#9a3412;animation:mnv-pulse 1.6s ease-in-out infinite;}',
            '.mnv-pill.is-dark{border-color:rgba(147,197,253,.45);background:rgba(30,58,138,.55);color:#dbeafe;}',
            '.mnv-pill.is-dark.is-alert{border-color:rgba(251,146,60,.55);background:rgba(124,45,18,.6);color:#ffedd5;}',
            '.mnv-toast{display:flex;align-items:center;gap:8px;max-width:min(380px,calc(100vw - 32px));padding:10px 14px;border-radius:12px;border:1px solid #e5e7eb;background:#fff;color:#111827;font:500 13px/1.4 inherit;box-shadow:0 8px 24px rgba(0,0,0,.12);cursor:pointer;opacity:1;transform:none;transition:opacity .35s ease,transform .35s ease;}',
            '.mnv-toast.is-dark{border-color:rgba(255,255,255,.12);background:#1f2937;color:#f3f4f6;box-shadow:0 8px 24px rgba(0,0,0,.4);}',
            '.mnv-toast.is-leaving{opacity:0;transform:translateY(-6px);}',
            '.mnv-icon{flex:none;}',
            '@keyframes mnv-pulse{0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,.35);}50%{box-shadow:0 0 0 6px rgba(249,115,22,0);}}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    // ---------- console helpers ----------
    function exposeApi() {
        window.MuseVoice = {
            // Every chat the script knows, newest first.
            state: function () {
                const rows = Array.from(threads.values()).sort(function (a, b) {
                    return b.updatedAt - a.updatedAt;
                }).slice(0, 20).map(function (thread) {
                    return {
                        聊天: displayName(thread),
                        未读: thread.unread,
                        状态: thread.status,
                        更新于: new Date(thread.updatedAt).toLocaleString()
                    };
                });
                console.table(rows);
                return {
                    语音: speech.state,
                    数据层: client ? (listQuery() ? '已连接' : '已找到，但没有聊天列表') : '还没找到',
                    聊天数: threads.size,
                    上次列表: lastList ? Math.round((Date.now() - lastList) / 1000) + ' 秒前' : '还没有',
                    轮询: pollMs() ? pollMs() / 1000 + ' 秒一次' : '已关闭',
                    当前聊天: activeThreadId() ? displayName(threads.get(activeThreadId()) || { title: '' }) : '无',
                    待播报: pendingItems().map(function (item) { return item.text; })
                };
            },
            refresh: refresh,
            test: function (name) {
                say(fill(name || config.mainName || DEFAULTS.mainName), primaryId ? [primaryId] : []);
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
                if (client) schedulePoll();
                if (patch.notify === true && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    Notification.requestPermission();
                }
                refreshUi();
                return Object.assign({}, config);
            },
            debug: function (on) {
                try {
                    if (on === false) localStorage.removeItem(KEY_DEBUG);
                    else localStorage.setItem(KEY_DEBUG, '1');
                } catch (err) {}
                return on === false ? '调试日志已关闭' : '调试日志已开启';
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
        if (window.__MNV_TEST__) {
            window.__MNV = { threads: threads, seenAt: seenAt, speech: speech, onServerList: onServerList, isNews: isNews, viewing: viewing, displayName: displayName };
        }
    }

    // ---------- boot ----------
    function boot() {
        if (window.top !== window.self) return;
        if (window.__MNV_INSTALLED__) return;
        window.__MNV_INSTALLED__ = true;
        hookHistory();
        exposeApi();
        ['pointerdown', 'keydown', 'touchend'].forEach(function (type) {
            window.addEventListener(type, onGesture, true);
        });
        ['focus', 'blur'].forEach(function (type) {
            window.addEventListener(type, noteAttention);
        });
        document.addEventListener('visibilitychange', noteAttention);
        const s = synth();
        if (s && s.addEventListener) {
            s.addEventListener('voiceschanged', function () { speech.voiceKey = ''; });
        }
        const start = function () {
            injectStyle();
            probe();
            attach(0);
        };
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    }

    boot();
})();
