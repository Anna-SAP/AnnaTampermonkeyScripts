// ==UserScript==
// @name         RingCentral Group Member Watcher (群成员在线一览)
// @namespace    https://github.com/your-name/rc-watcher
// @version      1.0.0
// @description  在 RingCentral 网页版中注入一个悬浮"大眼睛"按钮,一键查看当前群组成员的在线状态与个性签名,在线优先置顶,并按状态更新时间排序。
// @author       You
// @match        https://app.ringcentral.com/*
// @match        https://*.ringcentral.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* =========================================================
     * 0. 全局配置 (Selectors & Constants)
     *    ⚠️ 企业级 SPA 大量使用混淆类名 (如 .css-1a2b3c)。
     *    以下选择器尽量使用 aria-*, data-*, role 等语义化属性,
     *    若未来 RingCentral 改版失效,请优先修改此处常量即可。
     * ========================================================= */
    const SELECTORS = {
        // 群组成员列表容器(侧边栏 People 区或 @mention 列表)
        // RC 的群组成员信息常通过 "People" Tab 或 header 的成员头像堆加载
        memberListRoot: [
            '[data-test-automation-id="conversationHeader"]',
            '[aria-label*="member" i]',
            '[data-sign="conversationMemberList"]',
            '[class*="MemberList"]',
            '[class*="memberList"]'
        ],
        // 单个成员节点的候选选择器
        memberItem: [
            '[data-test-automation-id="memberItem"]',
            '[data-sign="memberItem"]',
            '[role="listitem"]',
            'li[class*="Member"]',
            'div[class*="MemberItem"]'
        ],
        // 头像 <img> 或带 background-image 的占位
        avatar: [
            'img[alt]',
            '[class*="avatar" i] img',
            '[data-sign="avatar"] img',
            '[class*="Avatar"]'
        ],
        // 姓名
        name: [
            '[data-test-automation-id*="name" i]',
            '[class*="name" i]',
            '[class*="Name"]'
        ],
        // 在线状态圆点 (Available=绿, DND=红, Invisible/Offline=灰)
        // 原生 presence 指示器一般绑在头像容器的右下角
        presence: [
            '[data-test-automation-id="presenceIndicator"]',
            '[data-sign="presence"]',
            '[class*="presence" i]',
            '[aria-label*="Available" i]',
            '[aria-label*="Do not disturb" i]',
            '[aria-label*="Invisible" i]',
            '[aria-label*="Offline" i]'
        ],
        // 状态消息(签名)
        statusMessage: [
            '[data-test-automation-id="statusMessage"]',
            '[class*="statusMessage" i]',
            '[class*="StatusMessage"]',
            '[aria-label*="status message" i]'
        ]
    };

    const PRESENCE_MAP = {
        available: { color: '#06ac38', label: 'Available', rank: 0 },
        busy:      { color: '#ff5c5c', label: 'Busy',      rank: 1 },
        dnd:       { color: '#ff5c5c', label: 'Do not disturb', rank: 1 },
        away:      { color: '#ffa500', label: 'Away',      rank: 2 },
        invisible: { color: '#a8a8a8', label: 'Invisible', rank: 3 },
        offline:   { color: '#a8a8a8', label: 'Offline',   rank: 3 },
        unknown:   { color: '#cccccc', label: 'Unknown',   rank: 4 }
    };

    /* =========================================================
     * 1. 样式注入模块 (Style Module)
     * ========================================================= */
    const STYLE = `
    #rcw-fab {
        position: fixed;
        right: 28px;
        bottom: 110px;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: linear-gradient(135deg, #ff8a00, #ff5e00);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 26px;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(255,94,0,.45), 0 2px 6px rgba(0,0,0,.12);
        z-index: 2147483646;
        user-select: none;
        transition: transform .2s ease, box-shadow .2s ease;
    }
    #rcw-fab:hover { transform: scale(1.08); box-shadow: 0 10px 24px rgba(255,94,0,.55); }
    #rcw-fab:active { transform: scale(.96); }

    #rcw-panel {
        position: fixed;
        right: 28px;
        bottom: 175px;
        width: 360px;
        max-height: 70vh;
        background: #fff;
        border-radius: 14px;
        box-shadow: 0 12px 40px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.06);
        z-index: 2147483647;
        display: none;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        animation: rcw-pop .18s ease-out;
    }
    #rcw-panel.open { display: flex; }
    @keyframes rcw-pop {
        from { opacity: 0; transform: translateY(8px) scale(.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .rcw-head {
        padding: 12px 16px;
        background: linear-gradient(135deg, #ff8a00, #ff5e00);
        color: #fff;
        font-weight: 600;
        font-size: 15px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .rcw-head .rcw-sub { font-weight: 400; font-size: 12px; opacity: .85; }
    .rcw-head .rcw-close {
        cursor: pointer; font-size: 18px; line-height: 1;
        padding: 2px 6px; border-radius: 4px;
    }
    .rcw-head .rcw-close:hover { background: rgba(255,255,255,.2); }

    .rcw-toolbar {
        padding: 8px 12px;
        border-bottom: 1px solid #eee;
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 12px;
        color: #555;
    }
    .rcw-toolbar button {
        border: 1px solid #ddd;
        background: #fff;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
    }
    .rcw-toolbar button:hover { background: #fafafa; }

    .rcw-list {
        overflow-y: auto;
        flex: 1;
        padding: 4px 0;
    }
    .rcw-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-bottom: 1px solid #f2f2f2;
        transition: background .15s;
    }
    .rcw-item:hover { background: #fff6ef; }
    .rcw-avatar-wrap {
        position: relative;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
    }
    .rcw-avatar {
        width: 40px; height: 40px;
        border-radius: 50%;
        background: #e6e6e6 center/cover no-repeat;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-weight: 600; font-size: 14px;
    }
    .rcw-dot {
        position: absolute;
        right: -1px; bottom: -1px;
        width: 12px; height: 12px;
        border-radius: 50%;
        border: 2px solid #fff;
        box-sizing: content-box;
    }
    .rcw-info { flex: 1; min-width: 0; }
    .rcw-name {
        font-size: 14px; font-weight: 600; color: #222;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rcw-status {
        font-size: 12px; color: #777;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        margin-top: 2px;
    }
    .rcw-status.empty { color: #bbb; font-style: italic; }
    .rcw-empty {
        padding: 30px 20px;
        text-align: center;
        color: #999;
        font-size: 13px;
    }
    .rcw-section-label {
        font-size: 11px; font-weight: 600;
        color: #ff5e00; text-transform: uppercase;
        padding: 8px 14px 4px; letter-spacing: .5px;
    }
    `;
    (typeof GM_addStyle === 'function')
        ? GM_addStyle(STYLE)
        : (function () {
            const s = document.createElement('style');
            s.textContent = STYLE; document.head.appendChild(s);
        })();

    /* =========================================================
     * 2. 数据抓取模块 (Scraper Module)
     *    策略: 优先从 RC 内置 Redux store (若可访问) 拉取;
     *    兜底: 扫描 DOM 节点,按 aria-label/alt 判定在线状态。
     * ========================================================= */
    const Scraper = {
        /** 尝试从多个候选选择器找到第一个匹配元素 */
        queryFirst(root, candidates) {
            for (const sel of candidates) {
                const el = root.querySelector(sel);
                if (el) return el;
            }
            return null;
        },
        queryAll(root, candidates) {
            const out = [];
            for (const sel of candidates) {
                root.querySelectorAll(sel).forEach(n => out.push(n));
            }
            return out;
        },

        /** 根据 aria-label / class 关键字推断在线状态 key */
        detectPresence(el) {
            if (!el) return 'unknown';
            const text = [
                el.getAttribute && el.getAttribute('aria-label'),
                el.getAttribute && el.getAttribute('title'),
                el.getAttribute && el.getAttribute('data-presence'),
                el.className && String(el.className)
            ].filter(Boolean).join(' ').toLowerCase();

            if (/do not disturb|\bdnd\b|busy/.test(text)) return 'dnd';
            if (/available|online/.test(text))           return 'available';
            if (/away|idle/.test(text))                  return 'away';
            if (/invisible/.test(text))                  return 'invisible';
            if (/offline|unavailable/.test(text))        return 'offline';

            // 兜底: 查子节点 style 背景色
            const bg = el.style && (el.style.backgroundColor || '');
            if (/rgb\(\s*6?\s*,?\s*1?7?2?/.test(bg))     return 'available';
            return 'unknown';
        },

        /** 入口:抓取所有可见成员 */
        async fetchMembers() {
            // 方案 A: 尝试通过 RC Redux store (若暴露)
            const storeMembers = this.tryFromStore();
            if (storeMembers && storeMembers.length) return storeMembers;

            // 方案 B: DOM 扫描
            return this.tryFromDOM();
        },

        /** 从全局 store / window 变量中拉取 */
        tryFromStore() {
            try {
                const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                // RC 内部常把 store 挂在 __store__ / __REDUX_STORE__ 等位置
                const store = w.__store__ || w.store || w.__REDUX_STORE__;
                if (!store || !store.getState) return null;
                const state = store.getState();
                // 路径可能为 state.presence / state.extensionInfo,需按实际调试
                const presenceMap = state.presence || state.presences || null;
                const profileMap  = state.profile  || state.extensionInfo || null;
                if (!presenceMap || !profileMap) return null;

                const list = [];
                Object.keys(profileMap).forEach(id => {
                    const p = profileMap[id] || {};
                    const pr = presenceMap[id] || {};
                    list.push({
                        id,
                        name:   p.displayName || p.name || 'Unknown',
                        avatar: p.avatarUrl || '',
                        presence: (pr.presenceStatus || pr.status || 'unknown').toLowerCase(),
                        statusMessage: pr.userStatus || pr.message || '',
                        updatedAt: pr.updatedAt || 0
                    });
                });
                return list;
            } catch (e) {
                console.warn('[RCW] store 抓取失败,回退 DOM', e);
                return null;
            }
        },

        /** 从 DOM 树中扫描成员卡片 */
        tryFromDOM() {
            const members = [];
            const seen = new Set();

            // 1. 优先查找群成员容器
            let roots = [];
            for (const sel of SELECTORS.memberListRoot) {
                document.querySelectorAll(sel).forEach(r => roots.push(r));
            }
            if (!roots.length) roots = [document.body];

            // 2. 扫描每个 root 下的 member item
            roots.forEach(root => {
                const items = this.queryAll(root, SELECTORS.memberItem);
                // 若没找到标准 item,退化为扫描所有头像节点
                const candidates = items.length ? items : Array.from(root.querySelectorAll('img[alt]'));

                candidates.forEach(node => {
                    const card = items.length ? node : node.closest('div,li') || node.parentElement;
                    if (!card || seen.has(card)) return;
                    seen.add(card);

                    const imgEl = this.queryFirst(card, SELECTORS.avatar);
                    const nameEl = this.queryFirst(card, SELECTORS.name);
                    const presenceEl = this.queryFirst(card, SELECTORS.presence);
                    const statusEl = this.queryFirst(card, SELECTORS.statusMessage);

                    const name = (nameEl && nameEl.textContent.trim())
                              || (imgEl && imgEl.getAttribute('alt'))
                              || '';
                    if (!name || name.length > 60) return; // 过滤无效条目

                    members.push({
                        id: name + '|' + (imgEl ? imgEl.src : ''),
                        name,
                        avatar: imgEl ? (imgEl.src || '') : '',
                        presence: this.detectPresence(presenceEl || card),
                        statusMessage: statusEl ? statusEl.textContent.trim() : '',
                        updatedAt: 0
                    });
                });
            });

            // 去重
            const unique = [];
            const idSet = new Set();
            members.forEach(m => {
                if (!idSet.has(m.id)) { idSet.add(m.id); unique.push(m); }
            });
            return unique;
        }
    };

    /* =========================================================
     * 3. 排序模块 (Sorter Module)
     * ========================================================= */
    function sortMembers(list) {
        return list.slice().sort((a, b) => {
            const ra = (PRESENCE_MAP[a.presence] || PRESENCE_MAP.unknown).rank;
            const rb = (PRESENCE_MAP[b.presence] || PRESENCE_MAP.unknown).rank;
            if (ra !== rb) return ra - rb;                 // 优先级1: 在线状态
            if (a.updatedAt !== b.updatedAt)               // 优先级2: 更新时间
                return (b.updatedAt || 0) - (a.updatedAt || 0);
            return a.name.localeCompare(b.name);           // 兜底: 按名称
        });
    }

    /* =========================================================
     * 4. UI 渲染模块 (View Module)
     * ========================================================= */
    const View = {
        fab: null,
        panel: null,
        list: null,

        mountFab() {
            if (this.fab) return;
            const btn = document.createElement('div');
            btn.id = 'rcw-fab';
            btn.title = '查看群成员在线状态';
            btn.innerHTML = '👁️';
            btn.addEventListener('click', () => Controller.toggle());
            document.body.appendChild(btn);
            this.fab = btn;
        },

        mountPanel() {
            if (this.panel) return;
            const p = document.createElement('div');
            p.id = 'rcw-panel';
            p.innerHTML = `
                <div class="rcw-head">
                    <div>
                        <div>群成员在线一览</div>
                        <div class="rcw-sub" id="rcw-sub">加载中…</div>
                    </div>
                    <div class="rcw-close" title="关闭">✕</div>
                </div>
                <div class="rcw-toolbar">
                    <button id="rcw-refresh">🔄 刷新</button>
                    <span id="rcw-count" style="margin-left:auto;"></span>
                </div>
                <div class="rcw-list" id="rcw-list"></div>
            `;
            document.body.appendChild(p);
            p.querySelector('.rcw-close').addEventListener('click', () => Controller.close());
            p.querySelector('#rcw-refresh').addEventListener('click', () => Controller.refresh());
            this.panel = p;
            this.list = p.querySelector('#rcw-list');
        },

        renderList(members) {
            if (!this.list) return;
            if (!members.length) {
                this.list.innerHTML = `<div class="rcw-empty">未检测到成员。<br>请先打开一个群组对话再试。</div>`;
                this.setCount(0);
                return;
            }
            const onlineCount = members.filter(m =>
                (PRESENCE_MAP[m.presence] || {}).rank === 0
            ).length;
            this.setCount(members.length, onlineCount);

            let html = '';
            let lastSection = null;
            members.forEach(m => {
                const info = PRESENCE_MAP[m.presence] || PRESENCE_MAP.unknown;
                const section = info.rank === 0 ? 'ONLINE' : 'OTHERS';
                if (section !== lastSection) {
                    html += `<div class="rcw-section-label">${section === 'ONLINE' ? '🟢 在线' : '⚪ 其他'}</div>`;
                    lastSection = section;
                }
                const initial = (m.name || '?').trim().charAt(0).toUpperCase();
                const avatarStyle = m.avatar
                    ? `background-image:url("${m.avatar}")`
                    : `background:#ff8a00;`;
                const statusText = m.statusMessage
                    ? escapeHtml(m.statusMessage)
                    : '<span class="empty">未设置签名</span>';
                html += `
                    <div class="rcw-item" data-name="${escapeHtml(m.name)}">
                        <div class="rcw-avatar-wrap">
                            <div class="rcw-avatar" style="${avatarStyle}">
                                ${m.avatar ? '' : escapeHtml(initial)}
                            </div>
                            <div class="rcw-dot" style="background:${info.color}" title="${info.label}"></div>
                        </div>
                        <div class="rcw-info">
                            <div class="rcw-name">${escapeHtml(m.name)}</div>
                            <div class="rcw-status ${m.statusMessage ? '' : 'empty'}">${statusText}</div>
                        </div>
                    </div>
                `;
            });
            this.list.innerHTML = html;
        },

        setCount(total, online) {
            const sub = this.panel && this.panel.querySelector('#rcw-sub');
            const cnt = this.panel && this.panel.querySelector('#rcw-count');
            if (sub) sub.textContent = online !== undefined
                ? `共 ${total} 人,在线 ${online}`
                : `共 ${total} 人`;
            if (cnt) cnt.textContent = '';
        },

        open()  { this.panel && this.panel.classList.add('open'); },
        close() { this.panel && this.panel.classList.remove('open'); },
        isOpen(){ return this.panel && this.panel.classList.contains('open'); }
    };

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    /* =========================================================
     * 5. 控制器 (Controller) — 协调 Scraper / View / 事件
     * ========================================================= */
    const Controller = {
        async refresh() {
            const members = await Scraper.fetchMembers();
            const sorted  = sortMembers(members);
            View.renderList(sorted);
        },
        async toggle() {
            if (View.isOpen()) return View.close();
            View.open();
            await this.refresh();
        },
        close() { View.close(); }
    };

    /* =========================================================
     * 6. 启动 & SPA 路由监听
     *    RingCentral 是单页应用,history.pushState 会切换会话但不触发 load,
     *    因此使用 MutationObserver + history hook 双保险。
     * ========================================================= */
    function boot() {
        View.mountFab();
        View.mountPanel();
    }

    // 首次等待 body 就绪
    const waitBody = setInterval(() => {
        if (document.body) {
            clearInterval(waitBody);
            boot();
        }
    }, 300);

    // DOM 级别监听:部分页面会清空 body,确保 FAB 常驻
    const obs = new MutationObserver(() => {
        if (!document.getElementById('rcw-fab') && document.body) {
            boot();
            // 若面板开着则自动刷新
            if (View.isOpen()) Controller.refresh();
        }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // SPA 路由 hook
    ['pushState', 'replaceState'].forEach(fn => {
        const orig = history[fn];
        history[fn] = function () {
            const ret = orig.apply(this, arguments);
            window.dispatchEvent(new Event('rcw:locationchange'));
            return ret;
        };
    });
    window.addEventListener('popstate', () =>
        window.dispatchEvent(new Event('rcw:locationchange')));
    window.addEventListener('rcw:locationchange', () => {
        if (View.isOpen()) setTimeout(() => Controller.refresh(), 600);
    });
})();