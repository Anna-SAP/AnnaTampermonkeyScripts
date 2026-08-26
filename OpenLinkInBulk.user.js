// ==UserScript==
// @name         OpenLinkInBulk
// @name:zh-CN   批量打开链接
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Detect grouped link containers (Jira Issue Links friendly) and open every link in one click.
// @description:zh-CN  检测页面中成组的链接区域（Jira Issue Links 友好），一键在多个新标签页中批量打开。
// @author       Anna
// @match        *://*/*
// @grant        GM_openInTab
// @grant        GM_notification
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    var CFG = Object.freeze({
        maxLinks: 80,
        batchSize: 8,
        batchDelayMs: 350,
        minLinksToShow: 3,
        btnClass: 'olib-btn',
        scanIntervalMs: 1500,
        containerSelectors: [
            '.issue-links-list',
            '.mod-content .issue-links-list',
            '.mod-content',
            'ul.aui-list',
            'ul', 'ol', 'dl',
            'p'
        ],
        skipSelectors: [
            'nav', 'header', 'footer', 'aside',
            '.breadcrumb', '.breadcrumbs', '.aui-nav', '.aui-header',
            '.aui-sidebar', '#header', '#footer', '#navigation'
        ]
    });

    var BTN_CLASS = CFG.btnClass;
    var tagged = new WeakSet();

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function normalize(url) {
        try {
            var u = new URL(url, location.href);
            u.hash = '';
            return u.toString();
        } catch (e) {
            return null;
        }
    }

    function collectLinks(rootEl) {
        var seen = new Set();
        var out = [];
        var anchors = rootEl.querySelectorAll('a[href]');
        for (var i = 0; i < anchors.length; i++) {
            var a = anchors[i];
            var raw = a.getAttribute('href');
            if (!raw || raw.startsWith('javascript:')) continue;
            var href = normalize(raw);
            if (!href || href === normalize(location.href)) continue;
            if (seen.has(href)) continue;
            seen.add(href);
            var text = (a.textContent || '').trim().slice(0, 80);
            out.push({ href: href, text: text });
        }
        return out;
    }

    function shouldSkipContainer(el) {
        if (!el || !el.matches) return false;
        for (var i = 0; i < CFG.skipSelectors.length; i++) {
            if (el.matches(CFG.skipSelectors[i])) return true;
        }
        var skipEl = null;
        try { skipEl = el.closest(CFG.skipSelectors.join(',')); } catch (e) {}
        if (skipEl && skipEl !== el) return true;
        return false;
    }

    function isJiraLike() {
        return /jira|atlassian/i.test(location.hostname) ||
            !!document.querySelector('#jira, .jira-issue-view, [data-component-name="IssueView"]');
    }

    function findLinkGroups() {
        var groups = [];
        var seen = new WeakSet();
        for (var s = 0; s < CFG.containerSelectors.length; s++) {
            var sel = CFG.containerSelectors[s];
            var nodes;
            try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
            for (var n = 0; n < nodes.length; n++) {
                var node = nodes[n];
                if (!isVisible(node)) continue;
                if (seen.has(node)) continue;
                if (shouldSkipContainer(node)) continue;
                if (tagged.has(node)) continue;
                var links = collectLinks(node);
                if (links.length < CFG.minLinksToShow) continue;
                seen.add(node);
                groups.push({ container: node, links: links });
            }
        }
        return groups;
    }

    function ensureButtonStyles() {
        if (document.getElementById('olib-styles')) return;
        var style = document.createElement('style');
        style.id = 'olib-styles';
        var css = '';
        css += '.olib-btn{display:inline-flex;align-items:center;gap:6px;margin:4px 0 8px;padding:4px 10px;';
        css += 'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
        css += 'color:#0052cc;background:#e9f2ff;border:1px solid #b3d4ff;border-radius:3px;';
        css += 'cursor:pointer;user-select:none;transition:background 120ms ease,border-color 120ms ease}';
        css += '.olib-btn:hover{background:#cce0ff;border-color:#4c9aff}';
        css += '.olib-btn[data-busy="1"]{opacity:.6;pointer-events:none}';
        css += '.olib-btn .olib-count{background:#0052cc;color:#fff;border-radius:9px;padding:0 6px;';
        css += 'font-size:11px;line-height:16px;min-width:16px;text-align:center}';
        css += '@media (prefers-color-scheme:dark){';
        css += '.olib-btn{color:#79b8ff;background:#1d2c44;border-color:#2f4a7a}';
        css += '.olib-btn:hover{background:#2a3f63;border-color:#4c9aff}';
        css += '.olib-btn .olib-count{background:#4c9aff}';
        css += '}';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function buildButton(count) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        btn.title = 'Open every link in this group in new tabs';
        var label = document.createElement('span');
        label.textContent = 'Open all';
        var badge = document.createElement('span');
        badge.className = 'olib-count';
        badge.textContent = String(count);
        btn.appendChild(label);
        btn.appendChild(badge);
        return btn;
    }

    function injectForGroup(group) {
        var btn = buildButton(group.links.length);
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            openAll(group.links, btn);
        }, true);
        group.container.parentNode.insertBefore(btn, group.container);
        tagged.add(group.container);
    }

    function openOne(url) {
        try {
            if (typeof GM_openInTab === 'function') {
                GM_openInTab(url, { active: false, insert: true });
                return true;
            }
        } catch (e) {}
        var w = window.open(url, '_blank', 'noopener,noreferrer');
        return !!w;
    }

    function openAll(links, btn) {
        if (!links.length) return;
        btn.dataset.busy = '1';
        var truncated = links.slice(0, CFG.maxLinks);
        var dropped = links.length - truncated.length;

        console.group('[OpenLinkInBulk] Opening ' + truncated.length + ' link(s)' +
            (dropped ? ' (truncated ' + dropped + ' more, max=' + CFG.maxLinks + ')' : ''));
        for (var i = 0; i < truncated.length; i++) {
            console.log((i + 1) + '. ' + truncated[i].href + ' (' + truncated[i].text + ')');
        }
        if (dropped) console.warn(dropped + ' link(s) skipped due to maxLinks cap.');
        console.groupEnd();

        try {
            if (typeof GM_notification === 'function') {
                GM_notification({
                    text: 'Opening ' + truncated.length + ' tab(s)' +
                        (dropped ? ' (+' + dropped + ' skipped)' : '') +
                        '. If nothing opened, allow popups for this site.',
                    title: 'OpenLinkInBulk',
                    timeout: 3000
                });
            }
        } catch (e) {}

        var opened = 0;
        var blocked = 0;

        function openAndCount(item) {
            var ok = openOne(item.href);
            if (ok) opened++; else blocked++;
        }

        var firstBatch = truncated.slice(0, CFG.batchSize);
        firstBatch.forEach(openAndCount);

        var rest = truncated.slice(CFG.batchSize);

        function launchNext(idx) {
            if (idx >= rest.length) {
                finalize();
                return;
            }
            openAndCount(rest[idx]);
            setTimeout(function () { launchNext(idx + 1); }, CFG.batchDelayMs);
        }

        if (rest.length) {
            try {
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        text: 'Opening ' + rest.length +
                            ' more tab(s). Allow popups for this site if your browser blocks them.',
                        title: 'OpenLinkInBulk - continue',
                        timeout: 2500
                    });
                }
            } catch (e) {
                console.warn('[OpenLinkInBulk] ' + rest.length +
                    ' more link(s) will open async. If nothing appears, allow popups for ' +
                    location.host + '.');
            }
            setTimeout(function () { launchNext(0); }, CFG.batchDelayMs);
        } else {
            finalize();
        }

        function finalize() {
            btn.dataset.busy = '0';
            btn.querySelector('.olib-count').textContent = String(truncated.length);
            if (blocked > 0) {
                console.warn(
                    '[OpenLinkInBulk] ' + blocked +
                    ' tab(s) may have been blocked by the popup blocker. ' +
                    'Click the page icon in the address bar and choose "Always allow popups", ' +
                    'then click the button again. URLs were logged above.'
                );
                btn.title = blocked + ' tab(s) may be blocked. See console for the URL list.';
            }
            console.info('[OpenLinkInBulk] Done. opened=' + opened + ' blocked=' + blocked +
                ' total=' + truncated.length);
        }
    }

    function scan() {
        try {
            var groups = findLinkGroups();
            for (var i = 0; i < groups.length; i++) injectForGroup(groups[i]);
        } catch (err) {
            console.error('[OpenLinkInBulk] scan failed', err);
        }
    }

    function start() {
        ensureButtonStyles();
        scan();
        var observer = new MutationObserver(scan);
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(scan, CFG.scanIntervalMs);
        if (!window.__OLIB_HINTED__) {
            window.__OLIB_HINTED__ = true;
            console.info('[OpenLinkInBulk] Ready. If bulk-open is blocked, allow popups for ' +
                location.host + ' and click the button again.');
        }
        if (isJiraLike()) {
            var lastUrl = location.href;
            setInterval(function () {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    setTimeout(scan, 500);
                }
            }, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
