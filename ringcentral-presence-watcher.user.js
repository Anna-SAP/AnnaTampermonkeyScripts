// ==UserScript==
// @name         RingCentral Group Member Watcher (群成员在线一览)
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.3.2
// @description  悬浮按钮 + 弹出面板，显示当前 RingCentral 群组成员的真实头像与在线状态。v1.3.2 修复成员名称全部显示“未知”的问题：改以头像按钮（data-test-automation-class=avatar, data-uid=GLIP_PERSON.*）为行锚点，名称从 aria-label 解析，背景色从 .RcAvatar-avatarContainer 读取。
// @author       Anna Su
// @match        https://app.ringcentral.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ringcentral.com
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-presence-watcher.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-presence-watcher.user.js
// ==/UserScript==
(function () {
    'use strict';

    // ---------- 0. CSS ----------
    const CSS = [
        "#__RCPW_FAB__{position:fixed;right:22px;bottom:22px;width:54px;height:54px;border-radius:50%;background:#ff7a00;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 6px 16px rgba(0,0,0,.25);cursor:pointer;z-index:2147483646;user-select:none;transition:transform .15s}",
        "#__RCPW_FAB__:hover{transform:scale(1.08)}",
        "#__RCPW_PANEL__{position:fixed;right:22px;bottom:90px;width:360px;max-height:70vh;background:#fff;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222}",
        "#__RCPW_PANEL__ .hdr{background:#ff7a00;color:#fff;padding:14px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:8px}",
        "#__RCPW_PANEL__ .hdr h3{margin:0;font-size:16px;font-weight:600}",
        "#__RCPW_PANEL__ .hdr .ver{opacity:.85;font-weight:400;font-size:12px;margin-left:6px}",
        "#__RCPW_PANEL__ .hdr .sub{font-size:12px;opacity:.9;margin-top:4px}",
        "#__RCPW_PANEL__ .hdr .x{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}",
        "#__RCPW_PANEL__ .bar{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid #eee;align-items:center}",
        "#__RCPW_PANEL__ .bar button{border:1px solid #e3e3e3;background:#fafafa;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px}",
        "#__RCPW_PANEL__ .bar button:hover{background:#f0f0f0}",
        "#__RCPW_PANEL__ .bar .tip{flex:1;text-align:right;font-size:11px;color:#888}",
        "#__RCPW_PANEL__ .body{overflow:auto;flex:1}",
        "#__RCPW_PANEL__ .sec{padding:8px 14px 0}",
        "#__RCPW_PANEL__ .sec h4{font-size:12px;color:#666;margin:6px 0 4px;font-weight:600;display:flex;align-items:center;gap:6px}",
        "#__RCPW_PANEL__ .sec h4 .dot{width:8px;height:8px;border-radius:50%;display:inline-block}",
        "#__RCPW_PANEL__ ul{list-style:none;margin:0;padding:0 8px 8px}",
        "#__RCPW_PANEL__ li{display:flex;align-items:center;gap:10px;padding:6px 6px;border-radius:8px}",
        "#__RCPW_PANEL__ li:hover{background:#f7f7f7}",
        "#__RCPW_PANEL__ li .av{width:32px;height:32px;border-radius:50%;background:#ccc;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;background-size:cover;background-position:center;position:relative;overflow:visible}",
        "#__RCPW_PANEL__ li .av .pdot{position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;border:2px solid #fff;background:#bbb}",
        "#__RCPW_PANEL__ li .nm{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        "#__RCPW_PANEL__ .empty{padding:18px;color:#888;font-size:12px;text-align:center}",
        "#__RCPW_PANEL__ .ft{padding:8px 12px;border-top:1px solid #eee;font-size:11px;color:#999;display:flex;justify-content:space-between}"
    ].join('');

    // ---------- 1. utils ----------
    const LOG = (...a) => console.log('%c[RCPW]', 'color:#ff7a00;font-weight:600', ...a);
    const WARN = (...a) => console.warn('[RCPW]', ...a);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const collator = new Intl.Collator(['zh', 'en'], { sensitivity: 'base' });

    function deriveInitials(name) {
        if (!name) return '?';
        const parts = String(name).trim().split(/\s+/);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    function nameColor(name) {
        let h = 0;
        for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        const hue = h % 360;
        return 'hsl(' + hue + ',55%,55%)';
    }

    // ---------- 2. Glip IndexedDB ----------
    const GlipDB = (() => {
        let dbPromise = null;
        function open() {
            if (dbPromise) return dbPromise;
            dbPromise = new Promise((resolve, reject) => {
                try {
                    const req = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
                    Promise.resolve(req).then(list => {
                        const glip = (list || []).find(d => /glip/i.test(d.name || ''));
                        if (!glip) return reject(new Error('no glip db'));
                        const openReq = indexedDB.open(glip.name);
                        openReq.onsuccess = () => resolve(openReq.result);
                        openReq.onerror = () => reject(openReq.error);
                    }).catch(reject);
                } catch (e) { reject(e); }
            }).catch(err => { dbPromise = null; throw err; });
            return dbPromise;
        }
        function tx(db, store) { return db.transaction(store, 'readonly').objectStore(store); }
        function get(store, key) {
            return open().then(db => new Promise((resolve, reject) => {
                try {
                    const r = tx(db, store).get(key);
                    r.onsuccess = () => resolve(r.result);
                    r.onerror = () => reject(r.error);
                } catch (e) { reject(e); }
            })).catch(() => null);
        }
        function getGroup(gid) { return get('group', String(gid)); }
        function getPersonsByIds(ids) {
            return open().then(db => {
                const store = tx(db, 'person');
                return Promise.all(ids.map(id => new Promise(res => {
                    const r = store.get(String(id));
                    r.onsuccess = () => res(r.result || null);
                    r.onerror = () => res(null);
                })));
            }).catch(() => ids.map(() => null));
        }
        return { open, get, getGroup, getPersonsByIds };
    })();

    // ---------- 3. presence ----------
    const PRESENCE_RANK = { available: 0, busy: 1, doNotDisturb: 2, inMeeting: 3, onCall: 4, away: 5, offline: 6, unknown: 7 };
    function normalizePresence(tok) {
        if (!tok) return 'unknown';
        const s = String(tok).toLowerCase();
        if (/donotdisturb|do-not-disturb|do_not_disturb|\bdnd\b/.test(s)) return 'doNotDisturb';
        if (/inmeeting|in-meeting|in_meeting|meeting/.test(s)) return 'inMeeting';
        if (/oncall|on-call|on_call|\bon a call\b/.test(s)) return 'onCall';
        if (/\bbusy\b/.test(s)) return 'busy';
        if (/\baway\b|idle/.test(s)) return 'away';
        if (/offline|invisible|unavailable/.test(s)) return 'offline';
        if (/\bavailable\b|online/.test(s)) return 'available';
        return 'unknown';
    }
    const PRESENCE_COLOR = {
        available: '#2ecc71', busy: '#e67e22', doNotDisturb: '#e74c3c',
        inMeeting: '#9b59b6', onCall: '#e74c3c', away: '#f1c40f',
        offline: '#bdbdbd', unknown: '#bdbdbd'
    };
    function betterPresence(a, b) {
        const ra = PRESENCE_RANK[a] ?? 99, rb = PRESENCE_RANK[b] ?? 99;
        return ra <= rb ? a : b;
    }

    // ---------- 4. DOM snapshot ----------
    // The row anchor is the avatar BUTTON itself:
    //   [data-test-automation-class="avatar"][data-uid^="GLIP_PERSON."]
    //   - aria-label starts with the display name, e.g. "Abhijit Padhy, mini profile. ..."
    //   - contains a nested [data-test-automation-id="presence"] with type/title
    //   - contains either a <canvas> (real avatar) or .avatar-short-name inside .RcAvatar-avatarContainer (colored bg)
    // We exclude topBar avatars and conversation-list chat avatars because those are not group members.
    function parseNameFromAriaLabel(label) {
        if (!label) return '';
        // Common patterns:
        //  "Jane Doe, mini profile. Press Enter to view ..."
        //  "Jane Doe mini profile"  (some variants)
        //  "Jane Doe"
        const cut = label.split(',')[0];
        return cut.replace(/\b(mini profile|profile|avatar)\b.*$/i, '').trim();
    }
    function captureCanvas(scope) {
        try {
            const cvs = scope.querySelector('canvas');
            if (!cvs || !cvs.width || !cvs.height) return '';
            return cvs.toDataURL('image/png');
        } catch (e) { return ''; }
    }
    function readAvatarButton(btn) {
        const uid = btn.getAttribute('data-uid') || btn.getAttribute('data-cid') || '';
        const m = uid.match(/GLIP_PERSON\.(\d+)/);
        if (!m) return null;
        const personId = m[1];
        const name = parseNameFromAriaLabel(btn.getAttribute('aria-label') || '');
        // presence
        const presenceEl = btn.querySelector('[data-test-automation-id="presence"]');
        let presence = 'unknown';
        if (presenceEl) {
            const type = presenceEl.getAttribute('type') || '';
            const title = presenceEl.getAttribute('title') || '';
            presence = normalizePresence(type);
            if (presence === 'unknown') presence = normalizePresence(title);
        }
        // avatar: canvas preferred; else short-name + container bg
        const avatarDataUrl = captureCanvas(btn);
        let initials = '', bg = '';
        if (!avatarDataUrl) {
            const sn = btn.querySelector('.avatar-short-name, [class*="short-name"]');
            if (sn) {
                initials = (sn.textContent || '').trim();
                const container = sn.closest('[class*="RcAvatar-avatarContainer"]') || sn.parentElement;
                if (container) {
                    const cs = getComputedStyle(container);
                    const c = cs.backgroundColor;
                    if (c && !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(c) && c !== 'transparent') bg = c;
                }
            }
        }
        if (!initials) initials = deriveInitials(name);
        if (!bg) bg = nameColor(name);
        return { personId, name, presence, avatarDataUrl, initials, bg };
    }
    function isGroupMemberAvatar(btn) {
        // Accept right-shelf team member list avatars and any Members dialog rows
        const tid = btn.getAttribute('data-test-automation-id') || '';
        if (tid === 'rightShelfMemberListAvatar') return true;
        // Exclude obvious non-member surfaces
        if (tid === 'topBarAvatar') return false;
        // Conversation list item avatars: inside .conversation-list-item
        if (btn.closest('.conversation-list-item, [data-test-automation-id*="conversation"]')) return false;
        // Message sender avatars in chat stream
        if (btn.closest('[data-test-automation-id*="message"]')) return false;
        // Mini profile / hover cards – exclude
        if (btn.closest('[role="dialog"] [class*="profile"], [class*="miniProfile"], [class*="MiniProfile"]')) return false;
        // Members dialog (team settings) – keep
        if (btn.closest('[data-test-automation-id*="MemberItem"], [data-test-automation-id*="member-item"], [data-test-automation-id*="teamMember"]')) return true;
        // Default: accept if it sits inside a members list region
        if (btn.closest('[data-test-automation-id*="MemberList"], [data-test-automation-id*="memberList"], [data-test-automation-id*="Members"]')) return true;
        return false;
    }
    function snapshotFromDom() {
        const byId = new Map();
        const byName = new Map();
        const btns = document.querySelectorAll('[data-test-automation-class="avatar"][data-uid^="GLIP_PERSON"]');
        btns.forEach(b => {
            if (!isGroupMemberAvatar(b)) return;
            const prof = readAvatarButton(b);
            if (!prof) return;
            if (prof.personId) {
                const prev = byId.get(prof.personId);
                byId.set(prof.personId, prev ? mergeProfile(prev, prof) : prof);
            }
            if (prof.name) {
                const k = prof.name.toLowerCase();
                const prev = byName.get(k);
                byName.set(k, prev ? mergeProfile(prev, prof) : prof);
            }
        });
        return { byId, byName };
    }
    function mergeProfile(a, b) {
        return {
            personId: a.personId || b.personId,
            name: a.name || b.name,
            presence: betterPresence(a.presence, b.presence),
            avatarDataUrl: a.avatarDataUrl || b.avatarDataUrl,
            initials: a.initials || b.initials,
            bg: a.bg || b.bg
        };
    }
    function mergeSnap(dst, snap) {
        snap.byId.forEach((v, k) => {
            const prev = dst.byId.get(k);
            dst.byId.set(k, prev ? mergeProfile(prev, v) : v);
        });
        snap.byName.forEach((v, k) => {
            const prev = dst.byName.get(k);
            dst.byName.set(k, prev ? mergeProfile(prev, v) : v);
        });
    }

    // ---------- 5. Auto collector ----------
    const AutoCollector = {
        _observer: null,
        _cache: { byId: new Map(), byName: new Map() },
        start() {
            if (this._observer) return;
            this._snapshotNow();
            this._observer = new MutationObserver(() => {
                clearTimeout(this._t);
                this._t = setTimeout(() => this._snapshotNow(), 250);
            });
            this._observer.observe(document.body, { childList: true, subtree: true });
        },
        stop() {
            if (this._observer) { this._observer.disconnect(); this._observer = null; }
        },
        _snapshotNow() {
            try {
                const snap = snapshotFromDom();
                mergeSnap(this._cache, snap);
            } catch (e) { /* ignore */ }
        },
        reset() { this._cache = { byId: new Map(), byName: new Map() }; },
        get cache() { return this._cache; }
    };

    // ---------- 6. aggregation ----------
    function currentGroupId() {
        const m = location.pathname.match(/\/messages?\/(\d+)/);
        return m ? m[1] : null;
    }
    async function aggregate() {
        AutoCollector._snapshotNow();
        const cache = AutoCollector.cache;
        const gid = currentGroupId();
        let members = [];
        if (gid) {
            try {
                const group = await GlipDB.getGroup(gid);
                const ids = (group && (group.members || group.member_ids)) || [];
                if (ids.length) {
                    const people = await GlipDB.getPersonsByIds(ids);
                    people.forEach((p, i) => {
                        const pid = String((p && p.id) || ids[i]);
                        const nm = p ? (p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || '').trim() : '';
                        const fromDom = cache.byId.get(pid) || (nm && cache.byName.get(nm.toLowerCase())) || null;
                        members.push({
                            personId: pid,
                            name: nm || (fromDom && fromDom.name) || '',
                            presence: fromDom ? fromDom.presence : 'unknown',
                            avatarDataUrl: fromDom ? fromDom.avatarDataUrl : '',
                            initials: (fromDom && fromDom.initials) || deriveInitials(nm),
                            bg: (fromDom && fromDom.bg) || nameColor(nm)
                        });
                    });
                }
            } catch (e) { /* fall through */ }
        }
        if (!members.length) {
            const seen = new Set();
            cache.byId.forEach(v => { seen.add(v.personId); members.push(v); });
            cache.byName.forEach(v => {
                if (v.personId && seen.has(v.personId)) return;
                members.push(v);
            });
        }
        const uniq = new Map();
        members.forEach(m => {
            const k = m.personId || (m.name || '').toLowerCase();
            if (!k) return;
            const prev = uniq.get(k);
            uniq.set(k, prev ? mergeProfile(prev, m) : m);
        });
        return Array.from(uniq.values());
    }
    function sortMembers(list) {
        return list.slice().sort((a, b) => {
            const ra = PRESENCE_RANK[a.presence] ?? 99;
            const rb = PRESENCE_RANK[b.presence] ?? 99;
            if (ra !== rb) return ra - rb;
            return collator.compare(a.name || '', b.name || '');
        });
    }

    // ---------- 7. UI ----------
    function injectStyles() {
        if (document.getElementById('__RCPW_STYLE__')) return;
        const s = document.createElement('style');
        s.id = '__RCPW_STYLE__';
        s.textContent = CSS;
        document.documentElement.appendChild(s);
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function renderAvatar(m) {
        if (m.avatarDataUrl) {
            return '<span class="av" style="background-image:url(' + m.avatarDataUrl + ')"><span class="pdot" style="background:' + PRESENCE_COLOR[m.presence] + '"></span></span>';
        }
        const bg = m.bg || nameColor(m.name);
        return '<span class="av" style="background:' + bg + '">' + escapeHtml(m.initials || deriveInitials(m.name)) + '<span class="pdot" style="background:' + PRESENCE_COLOR[m.presence] + '"></span></span>';
    }
    function renderPanel(panel, members) {
        const online = members.filter(m => m.presence === 'available');
        const busy = members.filter(m => ['busy', 'doNotDisturb', 'inMeeting', 'onCall'].includes(m.presence));
        const away = members.filter(m => m.presence === 'away');
        const offline = members.filter(m => m.presence === 'offline' || m.presence === 'unknown');
        const total = members.length;
        const covered = members.filter(m => m.presence !== 'unknown').length;
        const head = panel.querySelector('.sub');
        if (head) head.textContent = '共 ' + total + ' 人，在线 ' + online.length + ' · presence 覆盖 ' + covered + '/' + total;
        const body = panel.querySelector('.body');
        const renderSec = (label, color, list) => {
            if (!list.length) return '';
            const items = sortMembers(list).map(m => '<li>' + renderAvatar(m) + '<span class="nm" title="' + escapeHtml(m.name) + '">' + escapeHtml(m.name || '(未知)') + '</span></li>').join('');
            return '<div class="sec"><h4><span class="dot" style="background:' + color + '"></span>' + label + ' (' + list.length + ')</h4><ul>' + items + '</ul></div>';
        };
        let html = '';
        html += renderSec('在线', '#2ecc71', online);
        html += renderSec('忙碌 / 会议 / 通话', '#e67e22', busy);
        html += renderSec('离开', '#f1c40f', away);
        html += renderSec('离线 / 隐身', '#bdbdbd', offline);
        if (!html) html = '<div class="empty">没有获取到成员，请确认已打开某个群组的成员列表。</div>';
        body.innerHTML = html;
    }

    function buildPanel() {
        let panel = document.getElementById('__RCPW_PANEL__');
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = '__RCPW_PANEL__';
        panel.innerHTML = [
            '<div class="hdr">',
            '  <div>',
            '    <h3>群成员在线一览<span class="ver">v1.3.2</span></h3>',
            '    <div class="sub">初始化中…</div>',
            '  </div>',
            '  <button class="x" title="关闭">×</button>',
            '</div>',
            '<div class="bar">',
            '  <button data-act="scan" title="重新扫描当前可见成员">🔄 扫描</button>',
            '  <button data-act="fast" title="快速读取（不滚动）">⚡ 快读</button>',
            '  <span class="tip"></span>',
            '</div>',
            '<div class="body"><div class="empty">点击「扫描」开始。</div></div>',
            '<div class="ft"><span>Anna\'s RCPW</span><span class="stat"></span></div>'
        ].join('');
        document.body.appendChild(panel);
        panel.querySelector('.x').addEventListener('click', () => Controller.hide());
        panel.querySelector('[data-act="scan"]').addEventListener('click', () => Controller.scan());
        panel.querySelector('[data-act="fast"]').addEventListener('click', () => Controller.scan({ fast: true }));
        return panel;
    }
    function buildFab() {
        let fab = document.getElementById('__RCPW_FAB__');
        if (fab) return fab;
        fab = document.createElement('div');
        fab.id = '__RCPW_FAB__';
        fab.title = '群成员在线一览';
        fab.textContent = '👁';
        document.body.appendChild(fab);
        fab.addEventListener('click', () => Controller.toggle());
        return fab;
    }

    // ---------- 8. Controller ----------
    const Controller = {
        _visible: false,
        show() {
            const panel = buildPanel();
            panel.style.display = 'flex';
            this._visible = true;
            this.scan({ fast: true });
        },
        hide() {
            const panel = document.getElementById('__RCPW_PANEL__');
            if (panel) panel.style.display = 'none';
            this._visible = false;
        },
        toggle() { this._visible ? this.hide() : this.show(); },
        async scan(opts) {
            opts = opts || {};
            const panel = buildPanel();
            const tip = panel.querySelector('.tip');
            const stat = panel.querySelector('.stat');
            tip.textContent = opts.fast ? '快读中…' : '扫描中…';
            try {
                AutoCollector._snapshotNow();
                const members = await aggregate();
                renderPanel(panel, members);
                const covered = members.filter(m => m.presence !== 'unknown').length;
                stat.textContent = '已覆盖 ' + covered + '/' + members.length;
                tip.textContent = new Date().toLocaleTimeString();
            } catch (e) {
                WARN('scan failed', e);
                tip.textContent = '失败：' + (e && e.message || e);
            }
        }
    };

    // ---------- 9. SPA hooks ----------
    (function hookSpa() {
        const push = history.pushState;
        const replace = history.replaceState;
        const fire = () => window.dispatchEvent(new Event('__rcpw_locchange__'));
        history.pushState = function () { const r = push.apply(this, arguments); fire(); return r; };
        history.replaceState = function () { const r = replace.apply(this, arguments); fire(); return r; };
        window.addEventListener('popstate', fire);
        window.addEventListener('__rcpw_locchange__', () => {
            AutoCollector.reset();
            if (Controller._visible) setTimeout(() => Controller.scan({ fast: true }), 600);
        });
    })();

    // ---------- 10. boot ----------
    async function boot() {
        injectStyles();
        for (let i = 0; i < 40; i++) {
            if (document.body && document.querySelector('[data-test-automation-id]')) break;
            await sleep(500);
        }
        injectStyles();
        buildFab();
        AutoCollector.start();
        LOG('ready v1.3.2');
    }
    boot();

    window.__RCPW__ = {
        show: () => Controller.show(),
        hide: () => Controller.hide(),
        scan: (o) => Controller.scan(o),
        snapshot: () => snapshotFromDom(),
        cache: () => AutoCollector.cache,
        version: '1.3.2'
    };
})();
