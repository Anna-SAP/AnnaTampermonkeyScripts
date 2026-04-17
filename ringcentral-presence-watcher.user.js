// ==UserScript==
// @name         RingCentral Group Member Watcher (群成员在线一览)
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.2.1
// @description  悬浮按钮 + 弹出面板，显示当前 RingCentral 群组成员的在线状态与个性签名。v1.2.1 用首字母彩色头像取代 /file-service URL（该端点需要 RC 内部鉴权，外部加载失败）。
// @author       Anna Su
// @match        https://app.ringcentral.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ringcentral.com
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-presence-watcher.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-presence-watcher.user.js
// ==/UserScript==
(function () {
    // ---------- 0. CSS ----------
    const CSS = [
        "#__RCPW_FAB__{position:fixed;right:22px;bottom:22px;width:54px;height:54px;border-radius:50%;background:#ff7a00;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer;box-shadow:0 6px 20px rgba(255,122,0,.45);z-index:2147483000;transition:transform .15s ease;user-select:none}",
        "#__RCPW_FAB__:hover{transform:scale(1.08)}",
        "#__RCPW_PANEL__{position:fixed;right:22px;bottom:90px;width:360px;max-height:70vh;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.22);z-index:2147483001;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#222}",
        "#__RCPW_PANEL__ .hdr{background:#ff7a00;color:#fff;padding:14px 16px;display:flex;align-items:flex-start;justify-content:space-between}",
        "#__RCPW_PANEL__ .hdr h3{margin:0;font-size:16px;font-weight:600}",
        "#__RCPW_PANEL__ .hdr .ver{opacity:.85;font-weight:400;font-size:12px;margin-left:6px}",
        "#__RCPW_PANEL__ .hdr .sub{font-size:12px;opacity:.9;margin-top:4px}",
        "#__RCPW_PANEL__ .hdr .x{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}",
        "#__RCPW_PANEL__ .bar{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid #eee;align-items:center}",
        "#__RCPW_PANEL__ .bar button{border:1px solid #e3e3e3;background:#fafafa;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px}",
        "#__RCPW_PANEL__ .bar button:hover{background:#f0f0f0}",
        "#__RCPW_PANEL__ .bar .tip{flex:1;text-align:right;font-size:11px;color:#888}",
        "#__RCPW_PANEL__ .list{overflow-y:auto;flex:1}",
        "#__RCPW_PANEL__ .sec{padding:8px 14px;font-size:12px;font-weight:600;color:#ff7a00;background:#fff7ee;display:flex;align-items:center;gap:6px}",
        "#__RCPW_PANEL__ .sec .dot{width:8px;height:8px;border-radius:50%}",
        "#__RCPW_PANEL__ .row{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid #f3f3f3;align-items:center}",
        "#__RCPW_PANEL__ .row:hover{background:#fafafa}",
        "#__RCPW_PANEL__ .avatar{width:40px;height:40px;border-radius:50%;background:#bbb;position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:14px;letter-spacing:.5px}",
        "#__RCPW_PANEL__ .avatar .p{position:absolute;right:-1px;bottom:-1px;width:12px;height:12px;border-radius:50%;border:2px solid #fff;background:#bbb}",
        "#__RCPW_PANEL__ .avatar .p.available{background:#2ecc71}",
        "#__RCPW_PANEL__ .avatar .p.do-not-disturb{background:#e74c3c}",
        "#__RCPW_PANEL__ .avatar .p.away{background:#f1c40f}",
        "#__RCPW_PANEL__ .avatar .p.invisible,#__RCPW_PANEL__ .avatar .p.offline,#__RCPW_PANEL__ .avatar .p.unknown{background:#bbb}",
        "#__RCPW_PANEL__ .meta{flex:1;min-width:0}",
        "#__RCPW_PANEL__ .name{font-size:14px;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        "#__RCPW_PANEL__ .sig{font-size:12px;color:#888;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        "#__RCPW_PANEL__ .sig.empty{color:#bbb;font-style:italic}"
    ].join("\n");

    'use strict';
    const LOG = (...a) => console.log('%c[RCPW]', 'color:#ff7a00;font-weight:bold', ...a);
    const WARN = (...a) => console.warn('[RCPW]', ...a);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const collator = new Intl.Collator(['zh-Hans', 'en'], { sensitivity: 'base', numeric: true });

    // ---------- Avatar helpers (NEW in v1.2.1) ----------
    function deriveInitials(name) {
        if (!name) return '?';
        const t = name.trim();
        if (/^[\u4e00-\u9fa5]/.test(t)) return t[0];
        const words = t.split(/\s+/).filter(Boolean);
        if (words.length === 1) return (words[0][0] || '?').toUpperCase();
        return ((words[0][0] || '') + (words[words.length - 1][0] || '')).toUpperCase();
    }
    function nameColor(name) {
        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        return 'hsl(' + (h % 360) + ', 55%, 52%)';
    }

    // ---------- GlipDB ----------
    const GlipDB = (function () {
        let dbPromise = null;
        function open() {
            if (dbPromise) return dbPromise;
            dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open('Glip');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            return dbPromise;
        }
        function getAll(storeName) {
            return open().then(db => new Promise((resolve, reject) => {
                if (!db.objectStoreNames.contains(storeName)) return resolve([]);
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            }));
        }
        function get(storeName, key) {
            return open().then(db => new Promise((resolve, reject) => {
                if (!db.objectStoreNames.contains(storeName)) return resolve(null);
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            }));
        }
        async function getGroup(groupId) {
            const gid = String(groupId);
            const byNum = await get('group', Number(gid)).catch(() => null);
            if (byNum) return byNum;
            const byStr = await get('group', gid).catch(() => null);
            if (byStr) return byStr;
            const all = await getAll('group').catch(() => []);
            return all.find(g => String(g.id) === gid) || null;
        }
        async function getPersonsByIds(ids) {
            if (!ids || !ids.length) return [];
            const db = await open();
            if (!db.objectStoreNames.contains('person')) return [];
            return new Promise((resolve) => {
                const tx = db.transaction('person', 'readonly');
                const store = tx.objectStore('person');
                const out = [];
                let pending = ids.length;
                if (pending === 0) return resolve([]);
                ids.forEach(id => {
                    const tryKeys = [Number(id), String(id)];
                    let tried = 0;
                    const next = () => {
                        if (tried >= tryKeys.length) { if (--pending === 0) resolve(out); return; }
                        const k = tryKeys[tried++];
                        const req = store.get(k);
                        req.onsuccess = () => {
                            if (req.result) { out.push(req.result); if (--pending === 0) resolve(out); }
                            else { next(); }
                        };
                        req.onerror = () => next();
                    };
                    next();
                });
            });
        }
        return { open, getAll, get, getGroup, getPersonsByIds };
    })();

    const PRESENCE_RANK = { 'available': 1, 'do-not-disturb': 2, 'away': 3, 'invisible': 4, 'offline': 5, 'unknown': 6 };
    function classifyPresence(iconEl) {
        if (!iconEl) return 'unknown';
        const cls = (iconEl.getAttribute('class') || '').toLowerCase();
        if (cls.indexOf('check') >= 0 || cls.indexOf('available') >= 0) return 'available';
        if (cls.indexOf('do-not-disturb') >= 0 || cls.indexOf('dnd') >= 0 || cls.indexOf('in-meeting') >= 0 || cls.indexOf('busy') >= 0) return 'do-not-disturb';
        if (cls.indexOf('away') >= 0 || cls.indexOf('brb') >= 0) return 'away';
        if (cls.indexOf('invisible') >= 0) return 'invisible';
        if (cls.indexOf('offline') >= 0) return 'offline';
        return 'unknown';
    }
    function snapshotPresenceFromDom(root) {
        const out = new Map();
        const rows = $$('[role="dialog"] [role="listitem"], [role="dialog"] li', root);
        rows.forEach(row => {
            const nameEl = row.querySelector('[data-test-automation-id*="name"], .member-name, span, p');
            if (!nameEl) return;
            const name = (nameEl.textContent || '').trim();
            if (!name) return;
            const icon = row.querySelector('.RcAvatar-presenceWrapper .icon, [class*="presence"] [class*="icon"]');
            const state = classifyPresence(icon);
            const key = name.toLowerCase();
            const prev = out.get(key);
            if (!prev || PRESENCE_RANK[state] < PRESENCE_RANK[prev]) out.set(key, state);
        });
        return out;
    }

    const AutoCollector = {
        async findMembersButton() {
            return $$('button, [role="button"], a').find(el => /Members\s*\(\d+\)/i.test((el.textContent || '').trim()));
        },
        async openDialog() {
            const btn = await this.findMembersButton();
            if (!btn) return false;
            btn.click();
            for (let i = 0; i < 30; i++) { await sleep(100); if ($('[role="dialog"] [role="listitem"], [role="dialog"] li')) return true; }
            return false;
        },
        findScroller() {
            const dlg = $('[role="dialog"]');
            if (!dlg) return null;
            return $$('*', dlg).find(el => el.scrollHeight > el.clientHeight + 10 && el.querySelector('[role="listitem"], li')) || null;
        },
        async scanAll(onProgress) {
            const merged = new Map();
            const opened = await this.openDialog();
            if (!opened) { WARN('open dialog failed'); return merged; }
            await sleep(300);
            const scroller = this.findScroller();
            const eat = () => snapshotPresenceFromDom().forEach((v, k) => { const p = merged.get(k); if (!p || PRESENCE_RANK[v] < PRESENCE_RANK[p]) merged.set(k, v); });
            eat();
            if (onProgress) onProgress(merged.size);
            if (!scroller) return merged;
            let lastTop = -1, stable = 0;
            for (let step = 0; step < 400; step++) {
                scroller.scrollTop = scroller.scrollTop + Math.max(200, scroller.clientHeight - 40);
                await sleep(140);
                eat();
                if (onProgress) onProgress(merged.size);
                if (scroller.scrollTop === lastTop) { if (++stable >= 3) break; } else { stable = 0; lastTop = scroller.scrollTop; }
            }
            const closeBtn = $('[role="dialog"] [aria-label*="close" i], [role="dialog"] button[title*="close" i]');
            if (closeBtn) closeBtn.click();
            return merged;
        }
    };

    function currentGroupId() {
        const m = location.pathname.match(/\/messages\/(\d+)/);
        return m ? m[1] : null;
    }

    async function aggregate(groupId, presenceMap) {
        const group = await GlipDB.getGroup(groupId);
        if (!group) return { group: null, members: [] };
        const memberIds = group.members || group.member_ids || [];
        const persons = await GlipDB.getPersonsByIds(memberIds);
        const members = persons.map(p => {
            const name = (p.display_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || p.email || 'Unknown').trim();
            const key = name.toLowerCase();
            return {
                id: p.id,
                name,
                presence: presenceMap.get(key) || 'unknown',
                signature: (p.headline || p.away_status || '').trim(),
                awayStatusUpdatedAt: p.away_status_updated_at || 0,
                initials: deriveInitials(name),
                color: nameColor(name)
            };
        });
        return { group, members };
    }

    function sortMembers(list) {
        const online = list.filter(m => m.presence === 'available' || m.presence === 'do-not-disturb' || m.presence === 'away');
        const offline = list.filter(m => !(m.presence === 'available' || m.presence === 'do-not-disturb' || m.presence === 'away'));
        online.sort((a, b) => collator.compare(a.name, b.name));
        offline.sort((a, b) => collator.compare(a.name, b.name));
        return { online, offline };
    }

    function injectStyles(CSS) {
        if (document.getElementById('__RCPW_STYLE__')) return;
        const s = document.createElement('style');
        s.id = '__RCPW_STYLE__';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function renderPanel(state) {
        const panel = document.getElementById('__RCPW_PANEL__');
        if (!panel) return;
        const { members, presenceCoverage, loading } = state;
        const total = members.length;
        const { online, offline } = sortMembers(members);
        const sub = loading
            ? ('正在扫描… ' + (presenceCoverage || 0) + ' 已采集')
            : ('共 ' + total + ' 人,在线 ' + online.length + (presenceCoverage != null ? (' · presence 覆盖 ' + presenceCoverage + '/' + total) : ''));
        panel.querySelector('.sub').textContent = sub;
        const listEl = panel.querySelector('.list');
        listEl.innerHTML = '';
        const renderSec = (label, color, arr) => {
            if (!arr.length) return;
            const sec = document.createElement('div');
            sec.className = 'sec';
            const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = color;
            sec.appendChild(dot);
            sec.appendChild(document.createTextNode(' ' + label + ' (' + arr.length + ')'));
            listEl.appendChild(sec);
            arr.forEach(m => {
                const row = document.createElement('div'); row.className = 'row';
                const avatar = document.createElement('div'); avatar.className = 'avatar';
                avatar.style.background = m.color || nameColor(m.name);
                avatar.textContent = m.initials || deriveInitials(m.name);
                const p = document.createElement('span'); p.className = 'p ' + m.presence; avatar.appendChild(p);
                const meta = document.createElement('div'); meta.className = 'meta';
                const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = m.name;
                const sg = document.createElement('div'); sg.className = 'sig' + (m.signature ? '' : ' empty'); sg.textContent = m.signature || '未设置签名';
                meta.appendChild(nm); meta.appendChild(sg);
                row.appendChild(avatar); row.appendChild(meta);
                listEl.appendChild(row);
            });
        };
        renderSec('在线', '#2ecc71', online);
        renderSec('离线 / 隐身', '#bfc3c8', offline);
    }

    function buildPanel() {
        let panel = document.getElementById('__RCPW_PANEL__');
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = '__RCPW_PANEL__';
        panel.innerHTML =
            '<div class="hdr">' +
            '<div><h3>群成员在线一览<span class="ver">v1.2.1</span></h3><div class="sub">—</div></div>' +
            '<button class="x" title="关闭">×</button>' +
            '</div>' +
            '<div class="bar">' +
            '<button data-act="scan">🔄 扫描</button>' +
            '<button data-act="quick">⚡ 快读</button>' +
            '<span class="tip"></span>' +
            '</div>' +
            '<div class="list"></div>';
        document.body.appendChild(panel);
        panel.style.display = 'none';
        panel.querySelector('.x').onclick = () => { panel.style.display = 'none'; };
        panel.querySelector('[data-act="scan"]').onclick = () => Controller.fullScan();
        panel.querySelector('[data-act="quick"]').onclick = () => Controller.quickRead();
        return panel;
    }

    function buildFab() {
        let fab = document.getElementById('__RCPW_FAB__');
        if (fab) return fab;
        fab = document.createElement('div');
        fab.id = '__RCPW_FAB__';
        fab.title = '群成员在线一览';
        fab.textContent = '👁️';
        document.body.appendChild(fab);
        fab.onclick = () => {
            const panel = buildPanel();
            const shown = panel.style.display !== 'none';
            panel.style.display = shown ? 'none' : 'flex';
            if (!shown) Controller.quickRead();
        };
        return fab;
    }

    const Controller = {
        _cache: { groupId: null, members: [], presence: new Map() },
        _state: { members: [], presenceCoverage: 0, loading: false },
        _ensureGroupScope() {
            const gid = currentGroupId();
            if (gid !== this._cache.groupId) {
                this._cache = { groupId: gid, members: [], presence: new Map() };
                this._state = { members: [], presenceCoverage: 0, loading: false };
            }
            return gid;
        },
        async quickRead() {
            const gid = this._ensureGroupScope();
            if (!gid) return;
            snapshotPresenceFromDom().forEach((v, k) => {
                const p = this._cache.presence.get(k);
                if (!p || PRESENCE_RANK[v] < PRESENCE_RANK[p]) this._cache.presence.set(k, v);
            });
            const { members } = await aggregate(gid, this._cache.presence);
            this._cache.members = members;
            this._state = { members, presenceCoverage: Array.from(this._cache.presence.values()).filter(v => v !== 'unknown').length, loading: false };
            renderPanel(this._state);
        },
        async fullScan() {
            const gid = this._ensureGroupScope();
            if (!gid) return;
            this._state.loading = true;
            const preMembers = (await aggregate(gid, this._cache.presence)).members;
            this._state.members = preMembers;
            renderPanel(this._state);
            const pres = await AutoCollector.scanAll((n) => {
                this._state.presenceCoverage = n;
                renderPanel(this._state);
            });
            pres.forEach((v, k) => {
                const p = this._cache.presence.get(k);
                if (!p || PRESENCE_RANK[v] < PRESENCE_RANK[p]) this._cache.presence.set(k, v);
            });
            const { members } = await aggregate(gid, this._cache.presence);
            this._cache.members = members;
            this._state = { members, presenceCoverage: Array.from(this._cache.presence.values()).filter(v => v !== 'unknown').length, loading: false };
            renderPanel(this._state);
        }
    };

    (function hookSpa() {
        const fire = () => window.dispatchEvent(new Event('__rcpw_urlchange__'));
        const wrap = (fn) => function () { const r = fn.apply(this, arguments); fire(); return r; };
        history.pushState = wrap(history.pushState);
        history.replaceState = wrap(history.replaceState);
        window.addEventListener('popstate', fire);
        window.addEventListener('__rcpw_urlchange__', () => { Controller._ensureGroupScope(); });
    })();

    function boot() {
        if (!document.body) { setTimeout(boot, 100); return; }
        injectStyles(CSS);
        buildFab();
        buildPanel();
        LOG('v1.2.1 ready. Group =', currentGroupId());
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    window.__RCPW__ = { Controller, GlipDB, AutoCollector, sortMembers, snapshotPresenceFromDom };

})();