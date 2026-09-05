// ==UserScript==
// @name         RingCentral Avatar Role Badges
// @name:zh-CN   RingCentral 头像角色标签
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.1.1
// @description  Overlay short role tags (QA, L10N, PM, TL, GVP, EVP, …) on people avatars in RingCentral Messages. Titles come from Glip IndexedDB, directory API responses, and profile popovers.
// @description:zh-CN  在 RingCentral 网页聊天（/messages）里，根据职位/部门给用户头像叠上短角色标签（QA、L10N、PM、TL、GVP、EVP 等）。数据来自 Glip IndexedDB、目录接口和资料浮层。
// @author       Anna-SAP
// @match        https://app.ringcentral.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ringcentral.com
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-avatar-role-badges.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-avatar-role-badges.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.1.1';
    const STYLE_ID = '__TM_RC_ROLE_STYLE__';
    const HOST_CLASS = 'tm-rc-role-host';
    const HOST_SM_CLASS = 'tm-rc-role-sm';
    const NAMED_CLASS = 'tm-rc-role-named';
    const MESSAGES_PATH_RE = /\/messages(\/|$)/;
    const AVATAR_SEL = '[data-test-automation-class="avatar"][data-uid^="GLIP_PERSON"]';
    const CARD_SEL = [
        '.conversation-card-wrapper[data-id]',
        '[data-test-automation-id="conversation-reply-post-tree"][data-id]',
        '[data-name="reply-window-conversation-card"][data-id]',
        '[data-test-automation-id="styled-conversation-card"]',
    ].join(',');
    const CACHE_KEY = 'tm-rc-role-cache-v1';
    const OVERRIDE_KEY = 'tm-rc-role-overrides-v1';
    const TEXT_BADGE_MIN = 32;
    const SKIP_BADGE_MIN = 18;

    const LOG = function () {
        const a = ['%c[RCRB]', 'color:#7e22ce;font-weight:600'];
        for (let i = 0; i < arguments.length; i++) a.push(arguments[i]);
        console.log.apply(console, a);
    };
    const WARN = function () {
        const a = ['[RCRB]'];
        for (let i = 0; i < arguments.length; i++) a.push(arguments[i]);
        console.warn.apply(console, a);
    };

    // Distinct solid chips so QA / PM / TL / exec ranks read at a glance.
    const ROLE_THEME = {
        CEO: ['#111827', '#fff'], CTO: ['#111827', '#fff'], CFO: ['#111827', '#fff'],
        COO: ['#111827', '#fff'], CPO: ['#111827', '#fff'], CXO: ['#111827', '#fff'],
        PRES: ['#111827', '#fff'], GM: ['#1f2937', '#fff'],
        EVP: ['#6b21a8', '#fff'], GVP: ['#86198f', '#fff'],
        SVP: ['#7e22ce', '#fff'], AVP: ['#7e22ce', '#fff'],
        VP: ['#6d28d9', '#fff'],
        DIR: ['#3730a3', '#fff'], MGR: ['#1d4ed8', '#fff'], TL: ['#0369a1', '#fff'],
        QA: ['#0f766e', '#fff'], PM: ['#c2410c', '#fff'], PO: ['#c2410c', '#fff'],
        PjM: ['#b45309', '#fff'], PgM: ['#b45309', '#fff'],
        L10N: ['#be185d', '#fff'], UX: ['#9d174d', '#fff'],
        DATA: ['#0e7490', '#fff'], AI: ['#155e75', '#fff'], SEC: ['#b91c1c', '#fff'],
        OPS: ['#334155', '#fff'], DEVOPS: ['#334155', '#fff'],
        ENG: ['#475569', '#fff'], ARCH: ['#1e3a5f', '#fff'],
        HR: ['#7c2d12', '#fff'], FIN: ['#166534', '#fff'],
        CS: ['#0f766e', '#fff'], SALES: ['#c2410c', '#fff'],
        MKT: ['#b91c1c', '#fff'], LEGAL: ['#334155', '#fff'],
        IT: ['#475569', '#fff'], BA: ['#1d4ed8', '#fff'],
        TW: ['#6d28d9', '#fff'], INT: ['#64748b', '#fff'],
        SM: ['#0369a1', '#fff'],
    };
    const DEFAULT_THEME = ['#475569', '#fff'];

    // Rank (title only) that always wins — exec identity matters more than function.
    // Order matters: GVP/SVP/AVP/EVP before VP ("group vice president" contains
    // "vice president"), VP before PRES ("vice president" contains "president").
    const RANK_EXEC = [
        { tag: 'CEO', re: /\bchief\s+executive\b|\bceo\b|首席执行官/ },
        { tag: 'CTO', re: /\bchief\s+technology\b|\bcto\b|首席技术官/ },
        { tag: 'CFO', re: /\bchief\s+financial\b|\bcfo\b|首席财务官/ },
        { tag: 'COO', re: /\bchief\s+operating\b|\bcoo\b|首席运营官/ },
        { tag: 'CPO', re: /\bchief\s+product\b|\bcpo\b|首席产品官/ },
        { tag: 'CXO', re: /\bchief\b.+\bofficer\b|\bc(?:i|m|r|d|a|c|s|hr|is)o\b|首席\S{0,4}官/ },
        { tag: 'EVP', re: /\bexec(?:utive)?\s+vice\s+president\b|\bevp\b|执行副总裁/ },
        { tag: 'GVP', re: /\bgroup\s+vice\s+president\b|\bgvp\b/ },
        { tag: 'SVP', re: /\bs(?:enio)?r\.?\s+vice\s+president\b|\bsvp\b|高级副总裁/ },
        { tag: 'AVP', re: /\b(?:assistant|associate)\s+vice\s+president\b|\bavp\b|助理副总裁/ },
        { tag: 'VP', re: /\bvice\s+president\b|\bvp\b|副总裁|副总经理/ },
        { tag: 'PRES', re: /\bpresident\b|总裁/ },
        { tag: 'GM', re: /\bgeneral\s+manager\b|\bgm\b|总经理/ },
    ];

    // Distinctive function — wins over manager/lead/director.
    // "QA Team Lead" → QA; "Team Lead" in Quality Assurance → QA; "Team Lead" otherwise → TL.
    const FUNC_RULES = [
        { tag: 'QA', re: /\bqa\b|\bq\.a\.?\b|\bquality\s+(?:assurance|engineer(?:ing)?|management|analyst)\b|\bsdet\b|\btest(?:er|ing)?\b|测试|质量保证|品质保证/ },
        { tag: 'L10N', re: /\bl10n\b|\bi18n\b|\bg11n\b|\blocali[sz]ation\b|\bglobali[sz]ation\b|\binternationali[sz]ation\b|\btranslat(?:e|or|ion)\b|\blinguist\b|\blanguage\s+(?:lead|specialist|manager|expert|quality|team|services?)\b|本地化|国际化|翻译/ },
        { tag: 'PM', re: /\bproduct\s+(?:manager|management|mgmt|owner|lead|director)\b|\bpm\b|产品经理|产品负责人|产品总监/ },
        { tag: 'PO', re: /\bproduct\s+owner\b|\bpo\b/ },
        { tag: 'PjM', re: /\bproject\s+(?:manager|management|mgmt)\b|\bpmo\b|项目经理/ },
        { tag: 'PgM', re: /\bprogram\s+(?:manager|management|mgmt)\b|\btpm\b|项目群经理|项目组合/ },
        { tag: 'UX', re: /\bux\b|\bui\/ux\b|\bproduct\s+design(?:er)?\b|\b(?:ui|ux|visual|interaction)\s+design(?:er)?\b|\bdesigner\b|设计师/ },
        { tag: 'DATA', re: /\bdata\b|\banalytics\b|\bbusiness\s+intelligence\b|\bbi\b|数据/ },
        { tag: 'AI', re: /\bai\b|\bartificial\s+intelligence\b|\bmachine\s+learning\b|\bml\b|\bdeep\s+learning\b|\bnlp\b|人工智能|算法/ },
        { tag: 'SEC', re: /\b(?:info(?:rmation)?\s+)?security\b|\bappsec\b|\binfosec\b|\bsecops\b|安全/ },
        { tag: 'DEVOPS', re: /\bdev\s*ops\b|\bsre\b|\bsite\s+reliability\b|\bplatform\s+engineer/ },
        { tag: 'OPS', re: /\boperations?\b|\bsysadmin\b|运维/ },
        { tag: 'HR', re: /\bhuman\s+resources\b|\bhr\b|\bpeople\s+(?:ops|partner|business)\b|\brecruit(?:er|ing|ment)\b|\btalent\s+acquisition\b|\blearning\s*(?:&|and)\s*development\b|人力资源|招聘/ },
        { tag: 'FIN', re: /\bfinanc(?:e|ial)\b|\baccount(?:ant|ing)\b|\bcontroller\b|\bpayroll\b|\btreasury\b|财务/ },
        { tag: 'CS', re: /\bcustomer\s+(?:success|care|support|service|experience)\b|\bsupport\s+(?:engineer|agent|specialist)\b|\btechnical\s+support\b|\bhelpdesk\b|客服|客户成功/ },
        { tag: 'SALES', re: /\bsales\b|\baccount\s+executive\b|\bbusiness\s+development\b|\bbdr\b|\bsdr\b|\bsolutions?\s+(?:consultant|engineer)\b|销售/ },
        { tag: 'MKT', re: /\bmarket(?:ing|er)\b|\bdemand\s+gen|\bbrand\b|\bgrowth\b|营销|市场/ },
        { tag: 'LEGAL', re: /\blegal\b|\bcounsel\b|\battorney\b|\bcompliance\b|法务/ },
        { tag: 'IT', re: /\binformation\s+technology\b|\bit\s+(?:support|engineer|specialist|manager|admin)\b|^it$/ },
        { tag: 'BA', re: /\bbusiness\s+analyst\b|\bba\b/ },
        { tag: 'TW', re: /\btechnical\s+writer\b|\bcontent\s+designer\b|\bdocumentarian\b|\bdocumentation\b/ },
        { tag: 'SM', re: /\bscrum\s+master\b|\bagile\s+coach\b/ },
        { tag: 'ARCH', re: /\barchitect\b|架构/ },
    ];

    // TL before MGR so "技术主管" reads as team lead, bare "主管" as manager.
    const RANK_OTHER = [
        { tag: 'DIR', re: /\bdirector\b|\bdir\.?\b|\bhead\s+of\b|总监/ },
        { tag: 'TL', re: /\b(?:team|tech(?:nical)?|eng(?:ineering)?|dev(?:elopment)?|squad|feature|delivery)\s*leads?\b|^leads?\b|\bleads?\s*$|\btl\b|组长|团队负责人|技术主管|负责人/ },
        { tag: 'MGR', re: /\bmanager\b|\bmgr\.?\b|\bsupervisor\b|经理|主管/ },
        { tag: 'INT', re: /\bintern\b|\btrainee\b|实习/ },
    ];

    const FUNC_GENERIC = [
        { tag: 'ENG', re: /\bengineer(?:ing)?\b|\bdevelop(?:er|ment)\b|\bprogrammer\b|\bswe\b|\bsde\b|\bsoftware\b|\br&d\b|工程师|开发|研发/ },
    ];

    function themeOf(tag) {
        return ROLE_THEME[tag] || DEFAULT_THEME;
    }

    function normalizeHay(s) {
        return String(s || '')
            .replace(/[|/]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function primaryTitle(title) {
        const raw = String(title || '').trim();
        if (!raw) return '';
        return raw.split(/\s*[,|/]\s*/)[0].trim() || raw;
    }

    function firstMatch(rules, hay) {
        if (!hay) return '';
        for (let i = 0; i < rules.length; i++) {
            if (rules[i].re.test(hay)) return rules[i].tag;
        }
        return '';
    }

    // Only name/email decide bot-ness. Titles such as "QA Automation Engineer"
    // belong to humans and must not be filtered out.
    function isBot(name, email, title) {
        const ident = (name + ' ' + email).toLowerCase();
        if (/\bbot\b/.test(ident)) return true;
        if (/bot@/.test(ident)) return true;
        if (/\b(?:webhook|notifier)\b/.test(ident)) return true;
        if (/^\s*bot\s*$/i.test(String(title || ''))) return true;
        return false;
    }

    // Custom status lines in the profile popover ("🦜", "🏖️ OOO till Monday")
    // sit between the name and the job title. Anything that starts with an
    // emoji/pictograph, or has no letters at all, is not a title.
    const EMOJI_START_RE = /^[\s‍️]*(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}])/u;
    const HAS_LETTER_RE = /\p{L}/u;
    const PRESENCE_RE = /^(?:available|busy|do not disturb|dnd|away|offline|invisible|in a meeting|on a call|在线|忙碌|请勿打扰|离开|离线|隐身|会议中|通话中)$/i;

    function isStatusLine(line) {
        const s = String(line || '').trim();
        if (!s) return true;
        if (!HAS_LETTER_RE.test(s)) return true;
        if (EMOJI_START_RE.test(s)) return true;
        if (PRESENCE_RE.test(s)) return true;
        return false;
    }

    function cleanTitle(title) {
        const s = String(title || '').trim();
        if (!s) return '';
        return isStatusLine(s) ? '' : s;
    }

    // Examples:
    //   "QA Team Lead" + "Quality Assurance" → QA
    //   "Team Lead, Jupiter Unified App Applications" → TL
    //   "Assistant Vice President" → AVP
    function classify(title, department, name, email) {
        if (isBot(name, email, title)) return '';
        const head = normalizeHay(primaryTitle(title));
        const fullTitle = normalizeHay(title);
        const dept = normalizeHay(department);
        const t = head || fullTitle;
        const td = (t + ' ' + dept).trim();

        let tag = firstMatch(RANK_EXEC, t) || firstMatch(RANK_EXEC, fullTitle);
        if (tag) return tag;

        tag = firstMatch(FUNC_RULES, t) || firstMatch(FUNC_RULES, fullTitle);
        if (tag) return tag === 'PO' ? 'PM' : tag;

        tag = firstMatch(FUNC_RULES, dept) || firstMatch(FUNC_RULES, td);
        if (tag) return tag === 'PO' ? 'PM' : tag;

        tag = firstMatch(RANK_OTHER, t) || firstMatch(RANK_OTHER, fullTitle);
        if (tag) return tag;

        tag = firstMatch(FUNC_GENERIC, t) || firstMatch(FUNC_GENERIC, td);
        if (tag) return tag;

        return '';
    }

    function pickField(obj, paths) {
        if (!obj || typeof obj !== 'object') return '';
        for (let i = 0; i < paths.length; i++) {
            const parts = paths[i].split('.');
            let cur = obj;
            let ok = true;
            for (let j = 0; j < parts.length; j++) {
                if (cur == null || typeof cur !== 'object') { ok = false; break; }
                cur = cur[parts[j]];
            }
            if (!ok || cur == null) continue;
            const s = String(cur).trim();
            if (s) return s;
        }
        return '';
    }

    function personIdOf(obj) {
        if (!obj || typeof obj !== 'object') return '';
        const raw = obj.id != null ? obj.id
            : (obj.personId != null ? obj.personId
                : (obj.person_id != null ? obj.person_id
                    : (obj.glipId != null ? obj.glipId : '')));
        if (raw === '' || raw == null) return '';
        const s = String(raw);
        return /^\d+$/.test(s) ? s : '';
    }

    const TITLE_PATHS = [
        'job_title', 'jobTitle', 'job', 'title',
        'contact.jobTitle', 'contact.job_title', 'contact.title',
        'extension.contact.jobTitle',
    ];
    const DEPT_PATHS = [
        'department', 'departmentName', 'dept', 'division',
        'contact.department', 'contact.departmentName',
        'extension.contact.department',
    ];
    const NAME_PATHS = [
        'display_name', 'displayName', 'name', 'fullName', 'full_name',
    ];
    const EMAIL_PATHS = ['email', 'emailAddress', 'email_address', 'contact.email'];

    function looksLikePerson(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        if (!personIdOf(obj)) return false;
        const hasName = !!(obj.first_name || obj.firstName || obj.display_name || obj.displayName || obj.email || obj.name);
        const hasTitle = !!(obj.job_title || obj.jobTitle || obj.department || obj.departmentName || obj.contact);
        return hasName && hasTitle;
    }

    // ---------- cache ----------
    const memory = new Map(); // id -> rec
    const byName = new Map();
    const byEmail = new Map();
    let overrides = {};
    let cacheDirty = false;
    let keysLogged = false;

    function loadJson(key, fallback) {
        try {
            const s = localStorage.getItem(key);
            if (!s) return fallback;
            const v = JSON.parse(s);
            return v && typeof v === 'object' ? v : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function saveJson(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota */ }
    }

    function loadOverrides() {
        overrides = loadJson(OVERRIDE_KEY, {}) || {};
    }

    function persistOverrides() {
        saveJson(OVERRIDE_KEY, overrides);
    }

    function loadCache() {
        const raw = loadJson(CACHE_KEY, {});
        const ids = Object.keys(raw);
        for (let i = 0; i < ids.length; i++) {
            const rec = raw[ids[i]];
            if (!rec || typeof rec !== 'object') continue;
            putRecord(ids[i], rec, false);
        }
    }

    function persistCache() {
        if (!cacheDirty) return;
        const out = {};
        let n = 0;
        memory.forEach(function (rec, id) {
            if (n > 4000) return;
            out[id] = {
                name: rec.name || '',
                email: rec.email || '',
                title: rec.title || '',
                department: rec.department || '',
                tag: rec.tag || '',
                ts: rec.ts || 0,
            };
            n++;
        });
        saveJson(CACHE_KEY, out);
        cacheDirty = false;
    }

    function overrideTagFor(id, name, email) {
        if (id && overrides[id]) return String(overrides[id]);
        if (email && overrides['email:' + String(email).toLowerCase()]) {
            return String(overrides['email:' + String(email).toLowerCase()]);
        }
        if (name && overrides['name:' + String(name).toLowerCase()]) {
            return String(overrides['name:' + String(name).toLowerCase()]);
        }
        return '';
    }

    const unmatchedSeen = new Set();
    function noteUnmatched(name, title, department) {
        const key = (title + '|' + department).toLowerCase();
        if (unmatchedSeen.has(key)) return;
        unmatchedSeen.add(key);
        LOG('no role rule matched:', name || '?', '·', title || '(no title)', '·', department || '(no dept)');
    }

    function putRecord(id, partial, dirty) {
        if (!id) return null;
        const prev = memory.get(id) || {};
        const name = partial.name || prev.name || '';
        const email = partial.email || prev.email || '';
        const title = cleanTitle(partial.title) || cleanTitle(prev.title) || '';
        const department = cleanTitle(partial.department) || cleanTitle(prev.department) || '';
        const ov = overrideTagFor(id, name, email);
        const tag = ov || classify(title, department, name, email) || prev.tag || '';
        if (!tag && (title || department)) noteUnmatched(name, title, department);
        const rec = {
            id: id,
            name: name,
            email: email,
            title: title,
            department: department,
            tag: tag,
            ts: Date.now(),
        };
        const changed = !prev.ts
            || prev.tag !== rec.tag
            || prev.title !== rec.title
            || prev.department !== rec.department
            || prev.name !== rec.name;
        memory.set(id, rec);
        if (name) byName.set(name.toLowerCase(), rec);
        if (email) byEmail.set(email.toLowerCase(), rec);
        if (dirty !== false && changed) cacheDirty = true;
        return rec;
    }

    function ingestPerson(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (!keysLogged) {
            keysLogged = true;
            try { LOG('person keys', Object.keys(obj)); } catch (e) { /* ignore */ }
        }
        const id = personIdOf(obj);
        if (!id) return null;
        const first = pickField(obj, ['first_name', 'firstName']);
        const last = pickField(obj, ['last_name', 'lastName']);
        const combined = (first + ' ' + last).trim();
        const name = pickField(obj, NAME_PATHS) || combined;
        let title = cleanTitle(pickField(obj, TITLE_PATHS));
        if (title && /^(mr|mrs|ms|dr|miss)\.?$/i.test(title)) title = '';
        const department = cleanTitle(pickField(obj, DEPT_PATHS));
        const email = pickField(obj, EMAIL_PATHS);
        if (!title && !department && !overrideTagFor(id, name, email)) {
            if (!memory.has(id)) putRecord(id, { name: name, email: email }, true);
            return memory.get(id);
        }
        return putRecord(id, { name: name, email: email, title: title, department: department }, true);
    }

    function ingestJson(node, depth, budget) {
        if (!node || depth > 8 || budget.n <= 0) return;
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length && budget.n > 0; i++) ingestJson(node[i], depth + 1, budget);
            return;
        }
        if (typeof node !== 'object') return;
        if (looksLikePerson(node)) {
            ingestPerson(node);
            budget.n -= 1;
        }
        const keys = Object.keys(node);
        for (let i = 0; i < keys.length && budget.n > 0; i++) {
            const k = keys[i];
            if (k === 'posts' || k === 'messages' || k === 'files' || k === 'attachments') continue;
            const v = node[k];
            if (v && typeof v === 'object') ingestJson(v, depth + 1, budget);
        }
    }

    // ---------- IndexedDB ----------
    const GlipDB = (function () {
        let dbPromise = null;

        function open() {
            if (dbPromise) return dbPromise;
            dbPromise = new Promise(function (resolve, reject) {
                try {
                    const list = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
                    Promise.resolve(list).then(function (arr) {
                        const glip = (arr || []).find(function (d) { return /glip/i.test(d.name || ''); });
                        if (!glip) return reject(new Error('no glip db'));
                        const req = indexedDB.open(glip.name);
                        req.onsuccess = function () { resolve(req.result); };
                        req.onerror = function () { reject(req.error); };
                    }).catch(reject);
                } catch (e) { reject(e); }
            }).catch(function (err) {
                dbPromise = null;
                throw err;
            });
            return dbPromise;
        }

        function txStore(db, name) {
            return db.transaction(name, 'readonly').objectStore(name);
        }

        function get(store, key) {
            return open().then(function (db) {
                return new Promise(function (resolve) {
                    try {
                        if (!db.objectStoreNames.contains(store)) return resolve(null);
                        const r = txStore(db, store).get(key);
                        r.onsuccess = function () { resolve(r.result || null); };
                        r.onerror = function () { resolve(null); };
                    } catch (e) { resolve(null); }
                });
            }).catch(function () { return null; });
        }

        function getPersonsByIds(ids) {
            return open().then(function (db) {
                if (!db.objectStoreNames.contains('person')) return ids.map(function () { return null; });
                const store = txStore(db, 'person');
                return Promise.all(ids.map(function (id) {
                    return new Promise(function (res) {
                        const n = Number(id);
                        if (!Number.isFinite(n)) return res(null);
                        const r = store.get(n);
                        r.onsuccess = function () { res(r.result || null); };
                        r.onerror = function () { res(null); };
                    });
                }));
            }).catch(function () { return ids.map(function () { return null; }); });
        }

        function getGroup(gid) {
            const n = Number(gid);
            if (!Number.isFinite(n)) return Promise.resolve(null);
            return get('group', n).then(function (v) { return v || get('group', String(gid)); });
        }

        function storeNames() {
            return open().then(function (db) {
                const out = [];
                for (let i = 0; i < db.objectStoreNames.length; i++) out.push(db.objectStoreNames[i]);
                return out;
            }).catch(function () { return []; });
        }

        return { open: open, get: get, getPersonsByIds: getPersonsByIds, getGroup: getGroup, storeNames: storeNames };
    })();

    const pendingIds = new Set();
    const fetchedIds = new Set();
    let fetchTimer = 0;

    function queuePersonId(id) {
        if (!id || fetchedIds.has(id)) return;
        const rec = memory.get(id);
        if (rec && rec.title) return;
        pendingIds.add(id);
        if (fetchTimer) return;
        fetchTimer = setTimeout(flushPersonQueue, 60);
    }

    function flushPersonQueue() {
        fetchTimer = 0;
        const ids = Array.from(pendingIds);
        pendingIds.clear();
        if (!ids.length) return;
        const missing = ids.filter(function (id) {
            if (fetchedIds.has(id)) return false;
            const rec = memory.get(id);
            return !rec || !rec.title;
        });
        if (!missing.length) return;
        missing.forEach(function (id) { fetchedIds.add(id); });
        GlipDB.getPersonsByIds(missing).then(function (people) {
            for (let i = 0; i < people.length; i++) {
                if (people[i]) ingestPerson(people[i]);
            }
            scheduleScan();
        }).catch(function (e) { WARN('idb person fetch failed', e); });
    }

    function currentGroupId() {
        const m = location.pathname.match(/\/messages?\/(\d+)/);
        return m ? m[1] : null;
    }

    function prefetchGroup() {
        const gid = currentGroupId();
        if (!gid) return;
        GlipDB.getGroup(gid).then(function (group) {
            if (!group) return;
            const ids = group.members || group.member_ids || [];
            if (!ids.length) return;
            return GlipDB.getPersonsByIds(ids.map(String)).then(function (people) {
                let n = 0;
                for (let i = 0; i < people.length; i++) {
                    if (people[i]) {
                        ingestPerson(people[i]);
                        n++;
                    }
                }
                LOG('prefetched group members', n);
                scheduleScan();
            });
        }).catch(function (e) { WARN('group prefetch failed', e); });
    }

    // ---------- network intercept ----------
    function maybeIngestResponse(url, res) {
        try {
            const u = String(url || '');
            if (!/ringcentral\.com/i.test(u)) return;
            if (!/person|directory|contact|glip|team-messaging|extension|graph|profile/i.test(u)) return;
            const ctype = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
            if (ctype && ctype.indexOf('json') === -1) return;
            res.clone().json().then(function (data) {
                ingestJson(data, 0, { n: 400 });
                scheduleScan();
            }).catch(function () { /* not json */ });
        } catch (e) { /* ignore */ }
    }

    function hookNetwork() {
        if (window.__RCRB_FETCH_HOOKED__) return;
        window.__RCRB_FETCH_HOOKED__ = true;
        const origFetch = window.fetch;
        if (typeof origFetch === 'function') {
            window.fetch = function () {
                const req = arguments[0];
                const url = (req && req.url) ? req.url : req;
                return origFetch.apply(this, arguments).then(function (res) {
                    maybeIngestResponse(url, res);
                    return res;
                });
            };
        }
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this.__rcrbUrl = url;
            return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            this.addEventListener('load', function () {
                try {
                    const url = this.__rcrbUrl || '';
                    if (!/ringcentral\.com/i.test(String(url))) return;
                    if (!/person|directory|contact|glip|team-messaging|extension|graph|profile/i.test(String(url))) return;
                    const text = this.responseText;
                    if (!text || text.length < 2 || text.length > 2e6) return;
                    const data = JSON.parse(text);
                    ingestJson(data, 0, { n: 400 });
                    scheduleScan();
                } catch (e) { /* ignore */ }
            });
            return origSend.apply(this, arguments);
        };
    }

    // ---------- mini-profile scrape ----------
    function profileRoot(anchor) {
        const named = anchor.closest('[role="dialog"], [role="tooltip"], [data-test-automation-id*="profile"], [data-test-automation-id*="mini-profile"]');
        if (named) return named;
        let el = anchor.parentElement;
        for (let i = 0; i < 8 && el; i++) {
            const cls = el.className ? String(el.className) : '';
            if (/popover|popup|dialog|mini-profile|miniProfile|MiniProfile/i.test(cls)) return el;
            el = el.parentElement;
        }
        el = anchor.parentElement;
        for (let i = 0; i < 6 && el; i++) {
            const t = el.innerText || '';
            if (t.length > 40 && t.length < 700) return el;
            el = el.parentElement;
        }
        return anchor.parentElement;
    }

    function scrapeMiniProfiles() {
        const mails = document.querySelectorAll('a[href^="mailto:"]');
        if (!mails.length) return;
        for (let i = 0; i < mails.length; i++) {
            const a = mails[i];
            const href = a.getAttribute('href') || '';
            const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
            if (!email || email.indexOf('@') === -1) continue;
            const root = profileRoot(a);
            if (!root) continue;
            const text = (root.innerText || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (text.length < 2) continue;
            let name = '';
            let title = '';
            let department = '';
            for (let k = 0; k < text.length; k++) {
                const line = text[k];
                if (/^mailto:|^profile$|^个人资料$|^ringcentral$/i.test(line)) continue;
                if (line.indexOf('@') !== -1) continue;
                if (/^\+?[\d(][\d\s().|-]{6,}$/.test(line)) continue;
                if (/(?:ext|分机|内线|內線)\.?\s*\d+/i.test(line)) continue;
                if (/\d{3}[\s().-]*\d{3}[\s.-]*\d{4}/.test(line)) continue;
                if (!name) {
                    // Name may carry a trailing status emoji ("Sergey Bacho 🦜").
                    const n = line.replace(/[\s‍️]*(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})+[\s‍️]*$/u, '').trim();
                    if (!n) continue;
                    name = n;
                    continue;
                }
                // Custom status / presence lines sit between name and title.
                if (isStatusLine(line)) continue;
                if (!title) { title = line; continue; }
                if (!department && line.length < 80) { department = line; break; }
            }
            if (!name || !title) continue;
            const known = byEmail.get(email.toLowerCase()) || byName.get(name.toLowerCase());
            const id = known && /^\d+$/.test(String(known.id)) ? known.id : ('email:' + email.toLowerCase());
            putRecord(id, { name: name, email: email, title: title, department: department }, true);
        }
    }

    // ---------- DOM apply ----------
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.' + HOST_CLASS + '{',
            '  position:relative !important;',
            '  overflow:visible !important;',
            '}',
            '.' + HOST_CLASS + ':not(.' + HOST_SM_CLASS + ')::after{',
            '  content:attr(data-tm-role);',
            '  position:absolute;',
            '  left:50%;',
            '  bottom:-6px;',
            '  transform:translateX(-50%);',
            '  z-index:3;',
            '  background:var(--tm-rc-role-bg,#475569);',
            '  color:var(--tm-rc-role-fg,#fff);',
            '  font:600 9px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
            '  letter-spacing:.02em;',
            '  padding:1px 4px;',
            '  border-radius:4px;',
            '  white-space:nowrap;',
            '  pointer-events:none;',
            '  box-shadow:0 0 0 1px #fff;',
            '  max-width:72px;',
            '  overflow:hidden;',
            '  text-overflow:ellipsis;',
            '}',
            '.' + HOST_CLASS + '.' + HOST_SM_CLASS + '::after{content:none;}',
            '.' + HOST_CLASS + '.' + HOST_SM_CLASS + '{',
            '  box-shadow:0 0 0 2px #fff,0 0 0 4px var(--tm-rc-role-bg,#475569) !important;',
            '  border-radius:50%;',
            '}',
            '.' + NAMED_CLASS + '::after{',
            '  content:attr(data-tm-role);',
            '  display:inline-block;',
            '  margin-left:6px;',
            '  padding:0 5px;',
            '  height:16px;',
            '  line-height:16px;',
            '  border-radius:4px;',
            '  font:600 10px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
            '  letter-spacing:.02em;',
            '  background:var(--tm-rc-role-bg,#475569);',
            '  color:var(--tm-rc-role-fg,#fff);',
            '  vertical-align:middle;',
            '  position:relative;',
            '  top:-1px;',
            '  max-width:64px;',
            '  overflow:hidden;',
            '  text-overflow:ellipsis;',
            '  white-space:nowrap;',
            '}',
            '[data-test-automation-id="presence"]{z-index:4 !important;}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function clearHost(el) {
        if (!el || !el.classList) return;
        el.classList.remove(HOST_CLASS, HOST_SM_CLASS, NAMED_CLASS);
        el.removeAttribute('data-tm-role');
        el.removeAttribute('data-tm-role-pid');
        el.style.removeProperty('--tm-rc-role-bg');
        el.style.removeProperty('--tm-rc-role-fg');
    }

    function applyTheme(el, tag, pid, tooltip) {
        const th = themeOf(tag);
        el.setAttribute('data-tm-role', tag);
        el.setAttribute('data-tm-role-pid', pid || '');
        el.style.setProperty('--tm-rc-role-bg', th[0]);
        el.style.setProperty('--tm-rc-role-fg', th[1]);
        if (tooltip) el.setAttribute('title', tooltip);
    }

    function tooltipOf(rec) {
        const bits = [];
        if (rec.name) bits.push(rec.name);
        if (rec.title) bits.push(rec.title);
        if (rec.department && rec.department !== rec.title) bits.push(rec.department);
        if (rec.tag) bits.unshift(rec.tag);
        return bits.join(' · ');
    }

    function parseNameFromAria(label) {
        if (!label) return '';
        const cut = label.split(',')[0];
        return cut.replace(/\b(mini profile|profile|avatar)\b.*$/i, '').trim();
    }

    function resolveRecord(personId, fallbackName) {
        const rec = personId ? memory.get(personId) : null;
        if (rec && rec.tag) return rec;
        const named = fallbackName ? byName.get(String(fallbackName).toLowerCase()) : null;
        if (named && named.tag) {
            if (personId && (!rec || !rec.title)) {
                return putRecord(personId, {
                    name: named.name || fallbackName,
                    email: named.email,
                    title: named.title,
                    department: named.department,
                }, true);
            }
            return named;
        }
        return rec || null;
    }

    function findNameElement(card, name) {
        if (!card || !name) return null;
        const needle = name.trim();
        if (!needle) return null;
        const els = card.querySelectorAll('span, a, div, p, strong, h2, h3, h4, button');
        let best = null;
        let bestLen = Infinity;
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (el.closest(AVATAR_SEL)) continue;
            if (el.classList.contains(NAMED_CLASS) && el.getAttribute('data-tm-role-pid')) {
                // candidate to reuse; still prefer exact leaf
            }
            if (el.childElementCount > 2) continue;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t !== needle) continue;
            const len = (el.innerHTML || '').length;
            if (len < bestLen) {
                best = el;
                bestLen = len;
            }
        }
        return best;
    }

    function applyAvatar(btn) {
        if (!btn || btn.nodeType !== 1) return;
        const uid = btn.getAttribute('data-uid') || btn.getAttribute('data-cid') || '';
        const m = uid.match(/GLIP_PERSON\.(\d+)/);
        if (!m) {
            clearHost(btn);
            return;
        }
        const id = m[1];
        const name = parseNameFromAria(btn.getAttribute('aria-label') || '');
        let rec = resolveRecord(id, name);
        if (!rec || !rec.title) queuePersonId(id);
        rec = resolveRecord(id, name);
        if (!rec || !rec.tag) {
            if (btn.classList.contains(HOST_CLASS)) clearHost(btn);
            clearNameChip(btn, id);
            return;
        }

        const rect = btn.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        if (size && size < SKIP_BADGE_MIN) {
            clearHost(btn);
            return;
        }

        const tip = tooltipOf(rec);
        applyTheme(btn, rec.tag, id, tip);
        btn.classList.add(HOST_CLASS);
        const stacked = btn.parentElement
            && btn.parentElement.querySelectorAll(AVATAR_SEL).length >= 3;
        if ((size && size < TEXT_BADGE_MIN) || stacked) btn.classList.add(HOST_SM_CLASS);
        else btn.classList.remove(HOST_SM_CLASS);

        const card = btn.closest(CARD_SEL);
        if (card) applyNameChip(card, rec);
    }

    function applyNameChip(card, rec) {
        if (!rec || !rec.tag || !rec.name) return;
        const existing = card.querySelector('.' + NAMED_CLASS);
        if (existing && existing.getAttribute('data-tm-role-pid') === rec.id
            && existing.getAttribute('data-tm-role') === rec.tag) {
            return;
        }
        const nameEl = findNameElement(card, rec.name);
        if (!nameEl) return;
        if (existing && existing !== nameEl) clearHost(existing);
        applyTheme(nameEl, rec.tag, rec.id, tooltipOf(rec));
        nameEl.classList.add(NAMED_CLASS);
    }

    function clearNameChip(btn, id) {
        const card = btn.closest(CARD_SEL);
        if (!card) return;
        const named = card.querySelectorAll('.' + NAMED_CLASS);
        for (let i = 0; i < named.length; i++) {
            const el = named[i];
            const pid = el.getAttribute('data-tm-role-pid');
            if (!pid || pid === id) clearHost(el);
        }
    }

    function isMessagesRoute() {
        return MESSAGES_PATH_RE.test(location.pathname || '');
    }

    let scanScheduled = false;
    let observerStarted = false;

    function scanRoot(root) {
        if (!root || !root.querySelectorAll) return;
        if (root.nodeType === 1 && root.matches && root.matches(AVATAR_SEL)) applyAvatar(root);
        const avatars = root.querySelectorAll(AVATAR_SEL);
        for (let i = 0; i < avatars.length; i++) applyAvatar(avatars[i]);
        try { scrapeMiniProfiles(); } catch (e) { /* ignore */ }
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
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else setTimeout(run, 16);
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
            attributes: true,
            attributeFilter: ['data-uid', 'data-cid', 'aria-label'],
        });
    }

    function hookSpa() {
        const push = history.pushState;
        const replace = history.replaceState;
        const fire = function () { window.dispatchEvent(new Event('__rcrb_locchange__')); };
        history.pushState = function () { const r = push.apply(this, arguments); fire(); return r; };
        history.replaceState = function () { const r = replace.apply(this, arguments); fire(); return r; };
        window.addEventListener('popstate', fire);
        window.addEventListener('__rcrb_locchange__', function () {
            setTimeout(function () {
                prefetchGroup();
                scheduleScan();
            }, 400);
        });
    }

    function boot() {
        loadOverrides();
        loadCache();
        hookNetwork();
        hookSpa();
        injectStyles();
        startObserver();
        prefetchGroup();
        scheduleScan();
        setInterval(persistCache, 8000);
        window.addEventListener('beforeunload', persistCache);
        GlipDB.storeNames().then(function (names) {
            if (names && names.length) LOG('idb stores', names);
        }).catch(function () { /* ignore */ });
        LOG('ready v' + VERSION);
    }

    window.__RCRB__ = {
        version: VERSION,
        classify: classify,
        cache: function () { return memory; },
        rescan: function () { prefetchGroup(); scheduleScan(); },
        setOverride: function (personId, tag) {
            if (!personId) return;
            if (tag) overrides[String(personId)] = String(tag);
            else delete overrides[String(personId)];
            persistOverrides();
            const rec = memory.get(String(personId));
            if (rec) putRecord(String(personId), rec, true);
            scheduleScan();
        },
        setOverrideByName: function (name, tag) {
            if (!name) return;
            const key = 'name:' + String(name).toLowerCase();
            if (tag) overrides[key] = String(tag);
            else delete overrides[key];
            persistOverrides();
            scheduleScan();
        },
        dump: function (id) { return id ? memory.get(String(id)) : Array.from(memory.values()).slice(0, 30); },
        unmatched: function () { return Array.from(unmatchedSeen); },
    };

    boot();
})();
