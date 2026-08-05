// ==UserScript==
// @name         GitLab Code Word Wrap Toggle
// @name:zh-CN   GitLab 代码一键折行
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Add a persistent one-click word-wrap toggle to GitLab repository file views.
// @description:zh-CN 为 GitLab 代码查看页面添加记忆状态的一键折行开关，免除长代码行的横向滚动。
// @author       Anna-SAP
// @match        https://git.ringcentral.com/*
// @match        https://gitlab.com/*
// @include      /^https?:\/\/[^/]+\/.*\/-\/blob\/.*/
// @icon         https://gitlab.com/favicon.ico
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/gitlab-code-word-wrap.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/gitlab-code-word-wrap.user.js
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = '__TM_GITLAB_WORD_WRAP_TOGGLE__';
    const STYLE_ID = '__TM_GITLAB_WORD_WRAP_STYLE__';
    const VIEWER_CLASS = 'tm-glww-viewer';
    const HOST_CLASS = 'tm-glww-host';
    const SHELL_CLASS = 'tm-glww-shell';
    const HEIGHT_MARK = 'data-tm-glww-line-height';
    const HEIGHT_VAR = '--tm-glww-line-height';
    const STORAGE_KEY = 'tm.gitlab.wordWrap.enabled.v1';
    const DEFAULT_ENABLED = true;
    const BLOB_PATH_RE = /\/-\/blob\/.+/;
    const VIEWER_SELECTOR = [
        '[data-testid="blob-viewer-file-content"]',
        '[data-qa-selector="blob_viewer_file_content"]',
        '.blob-viewer[data-type="simple"]',
        '.file-content.code[data-type="simple"]',
        '#blob-content-holder .blob-content',
    ].join(', ');

    let enabled = readStoredState();
    let reconcileScheduled = false;
    let heightSyncScheduled = false;
    const observedViewers = new Map();

    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            let widthChanged = false;
            entries.forEach((entry) => {
                const width = entry.contentRect.width;
                const previousWidth = observedViewers.get(entry.target);
                observedViewers.set(entry.target, width);
                if (previousWidth == null || Math.abs(width - previousWidth) > 0.5) {
                    widthChanged = true;
                }
            });
            if (widthChanged) scheduleHeightSync();
        })
        : null;

    function nextFrame(callback) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(callback);
        } else {
            setTimeout(callback, 16);
        }
    }

    function readStoredState() {
        try {
            const value = localStorage.getItem(STORAGE_KEY);
            if (value === 'true') return true;
            if (value === 'false') return false;
        } catch (error) {
            // localStorage may be unavailable under strict browser policies.
        }
        return DEFAULT_ENABLED;
    }

    function storeState(value) {
        try {
            localStorage.setItem(STORAGE_KEY, String(value));
        } catch (error) {
            // The toggle still works for the current page when storage is blocked.
        }
    }

    function isBlobPage() {
        return BLOB_PATH_RE.test(location.pathname);
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${SHELL_CLASS},
            .${HOST_CLASS},
            .${VIEWER_CLASS} {
                min-width: 0 !important;
                max-width: 100% !important;
            }

            .${HOST_CLASS},
            .${VIEWER_CLASS} {
                overflow-x: hidden !important;
            }

            .${VIEWER_CLASS} pre {
                box-sizing: border-box !important;
                width: 100% !important;
                min-width: 0 !important;
                max-width: 100% !important;
                overflow-x: hidden !important;
            }

            .${VIEWER_CLASS} pre > code {
                box-sizing: border-box !important;
                display: block !important;
                right: 0 !important;
                width: auto !important;
                min-width: 0 !important;
                max-width: 100% !important;
            }

            .${VIEWER_CLASS} :is(
                pre > code.line,
                pre > code > .line,
                .js-file-line,
                .blob-code-inner,
                td.blob-code,
                td.line-content,
                td.line_content,
                .line-content,
                .line_content
            ) {
                box-sizing: border-box !important;
                min-width: 0 !important;
                max-width: 100% !important;
                white-space: pre-wrap !important;
                overflow-wrap: anywhere !important;
                word-break: break-word !important;
            }

            .${VIEWER_CLASS} :is(
                td.blob-code,
                td.line-content,
                td.line_content,
                .line-content,
                .line_content
            ) * {
                white-space: inherit !important;
            }

            .${VIEWER_CLASS} table.highlight {
                width: 100% !important;
                table-layout: fixed !important;
            }

            .${VIEWER_CLASS} table.highlight :is(
                td.line-numbers,
                td.line_numbers,
                td.blob-num
            ) {
                width: 1% !important;
                min-width: 48px !important;
                white-space: nowrap !important;
                overflow-wrap: normal !important;
                word-break: normal !important;
                vertical-align: top !important;
            }

            .${VIEWER_CLASS} [${HEIGHT_MARK}] {
                box-sizing: border-box !important;
                height: var(${HEIGHT_VAR}) !important;
                min-height: var(${HEIGHT_VAR}) !important;
            }

            #${BUTTON_ID} {
                all: unset;
                box-sizing: border-box;
                position: fixed;
                right: max(20px, env(safe-area-inset-right));
                bottom: max(20px, env(safe-area-inset-bottom));
                z-index: 2147483646;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                min-width: 108px;
                height: 36px;
                padding: 0 14px;
                border: 1px solid var(--gl-border-color-default, #bfbfc3);
                border-radius: 18px;
                background: var(--gl-background-color-default, #ffffff);
                color: var(--gl-text-color-default, #333238);
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
                font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                cursor: pointer;
                user-select: none;
                transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
            }

            #${BUTTON_ID}[data-enabled="true"] {
                border-color: #1f75cb;
                background: #1f75cb;
                color: #ffffff;
            }

            #${BUTTON_ID}:hover {
                transform: translateY(-1px);
                box-shadow: 0 5px 14px rgba(0, 0, 0, 0.22);
            }

            #${BUTTON_ID}:focus-visible {
                outline: 2px solid #428fdc;
                outline-offset: 2px;
            }

            #${BUTTON_ID} .tm-glww-icon {
                font-size: 16px;
                line-height: 1;
            }

            @media (max-width: 575px) {
                #${BUTTON_ID} {
                    right: 12px;
                    bottom: 12px;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                #${BUTTON_ID} {
                    transition: none;
                }
            }

            @media print {
                #${BUTTON_ID} {
                    display: none !important;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function findViewers() {
        const candidates = Array.from(document.querySelectorAll(VIEWER_SELECTOR));
        const codeViewers = candidates.filter((viewer) =>
            viewer.matches('.file-content.code, .blob-content, .blob-viewer')
            && viewer.querySelector('pre, table.highlight, .line-content, .line_content, td.blob-code'));

        return codeViewers.filter((viewer) =>
            !codeViewers.some((other) => other !== viewer && other.contains(viewer)));
    }

    function createButton() {
        let button = document.getElementById(BUTTON_ID);
        if (button || !document.body) return button;

        button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';

        const icon = document.createElement('span');
        icon.className = 'tm-glww-icon';
        icon.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'tm-glww-label';

        button.append(icon, label);
        button.addEventListener('click', () => {
            enabled = !enabled;
            storeState(enabled);
            reconcilePage();
        });

        document.body.appendChild(button);
        return button;
    }

    function updateButton(button) {
        if (!button) return;

        const icon = button.querySelector('.tm-glww-icon');
        const label = button.querySelector('.tm-glww-label');
        const iconText = enabled ? '↵' : '↔';
        const labelText = enabled ? '折行：开' : '折行：关';

        button.dataset.enabled = String(enabled);
        button.setAttribute('aria-pressed', String(enabled));
        button.setAttribute('aria-label', enabled ? '关闭代码自动折行' : '开启代码自动折行');
        button.title = enabled ? '代码自动折行已开启；点击关闭' : '代码自动折行已关闭；点击开启';
        if (icon && icon.textContent !== iconText) icon.textContent = iconText;
        if (label && label.textContent !== labelText) label.textContent = labelText;
    }

    function clearLineHeight(element) {
        element.style.removeProperty(HEIGHT_VAR);
        element.removeAttribute(HEIGHT_MARK);
    }

    function clearWrappedLineHeights(root) {
        root.querySelectorAll(`[${HEIGHT_MARK}]`).forEach(clearLineHeight);
    }

    function findLineNumberTarget(root, number) {
        const link = root.querySelector(`#L${number}[data-line-number="${number}"]`)
            || root.querySelector(`#L${number}`)
            || root.querySelector(`[data-line-number="${number}"]`)
            || root.querySelector(`[data-linenumber="${number}"]`);
        if (!link) return null;

        const row = link.closest(
            '[data-testid="line-numbers"].line-numbers, '
            + '.diff-line-num.line-links.line-numbers',
        );
        const numberLinks = row
            ? row.querySelectorAll('[data-line-number], [data-linenumber]')
            : [];

        return row && root.contains(row) && numberLinks.length === 1 ? row : link;
    }

    function syncWrappedLineHeights(root) {
        const measuredHeights = new Map();

        root.querySelectorAll('.line[id^="LC"]').forEach((line) => {
            const match = /^LC(\d+)$/.exec(line.id);
            if (!match) return;

            const target = findLineNumberTarget(root, match[1]);
            if (!target) return;

            const height = line.getBoundingClientRect().height;
            if (!(height > 0)) return;

            const previous = measuredHeights.get(target) || 0;
            measuredHeights.set(target, Math.max(previous, height));
        });

        root.querySelectorAll(`[${HEIGHT_MARK}]`).forEach((element) => {
            if (!measuredHeights.has(element)) clearLineHeight(element);
        });

        measuredHeights.forEach((height, target) => {
            const value = `${Math.round(height * 1000) / 1000}px`;
            if (target.style.getPropertyValue(HEIGHT_VAR) !== value) {
                target.style.setProperty(HEIGHT_VAR, value);
            }
            target.setAttribute(HEIGHT_MARK, '');
        });
    }

    function clearDecorations() {
        document.querySelectorAll(`.${VIEWER_CLASS}`).forEach((viewer) => {
            clearWrappedLineHeights(viewer);
            viewer.classList.remove(VIEWER_CLASS);
        });
        document.querySelectorAll(`.${HOST_CLASS}`).forEach((host) => host.classList.remove(HOST_CLASS));
        document.querySelectorAll(`.${SHELL_CLASS}`).forEach((shell) => shell.classList.remove(SHELL_CLASS));
        refreshResizeObservers([]);
    }

    function applyDecorations(viewers) {
        const viewerSet = new Set(viewers);
        const hostSet = new Set();
        const shellSet = new Set();

        viewers.forEach((viewer) => {
            viewer.classList.add(VIEWER_CLASS);
            if (viewer.parentElement && viewer.parentElement !== document.body) {
                hostSet.add(viewer.parentElement);
            }
            const shell = viewer.closest('.file-holder, #blob-content-holder');
            if (shell && shell !== viewer) shellSet.add(shell);
        });

        document.querySelectorAll(`.${VIEWER_CLASS}`).forEach((viewer) => {
            if (!viewerSet.has(viewer)) {
                clearWrappedLineHeights(viewer);
                viewer.classList.remove(VIEWER_CLASS);
            }
        });
        document.querySelectorAll(`.${HOST_CLASS}`).forEach((host) => {
            if (!hostSet.has(host)) host.classList.remove(HOST_CLASS);
        });
        document.querySelectorAll(`.${SHELL_CLASS}`).forEach((shell) => {
            if (!shellSet.has(shell)) shell.classList.remove(SHELL_CLASS);
        });

        hostSet.forEach((host) => host.classList.add(HOST_CLASS));
        shellSet.forEach((shell) => shell.classList.add(SHELL_CLASS));
        refreshResizeObservers(viewers);
    }

    function refreshResizeObservers(viewers) {
        if (!resizeObserver) return;

        const viewerSet = new Set(viewers);
        observedViewers.forEach((value, viewer) => {
            if (!viewerSet.has(viewer)) {
                resizeObserver.unobserve(viewer);
                observedViewers.delete(viewer);
            }
        });

        viewers.forEach((viewer) => {
            if (observedViewers.has(viewer)) return;
            observedViewers.set(viewer, viewer.getBoundingClientRect().width);
            resizeObserver.observe(viewer);
        });
    }

    function syncAllLineHeights() {
        if (!enabled || !isBlobPage()) return;
        document.querySelectorAll(`.${VIEWER_CLASS}`).forEach(syncWrappedLineHeights);
    }

    function scheduleHeightSync() {
        if (heightSyncScheduled) return;
        heightSyncScheduled = true;
        nextFrame(() => {
            heightSyncScheduled = false;
            syncAllLineHeights();
        });
    }

    function reconcilePage() {
        injectStyles();

        const onBlobPage = isBlobPage();
        const viewers = onBlobPage ? findViewers() : [];

        if (enabled && viewers.length > 0) {
            applyDecorations(viewers);
            scheduleHeightSync();
        } else {
            clearDecorations();
        }

        if (onBlobPage && viewers.length > 0) {
            updateButton(createButton());
        } else {
            document.getElementById(BUTTON_ID)?.remove();
        }
    }

    function scheduleReconcile() {
        if (reconcileScheduled) return;
        reconcileScheduled = true;
        nextFrame(() => {
            reconcileScheduled = false;
            reconcilePage();
        });
    }

    function start() {
        injectStyles();
        reconcilePage();

        const observer = new MutationObserver(scheduleReconcile);
        observer.observe(document.documentElement, { childList: true, subtree: true });

        window.addEventListener('popstate', scheduleReconcile);
        window.addEventListener('hashchange', scheduleReconcile);
        window.addEventListener('pageshow', scheduleReconcile);
        window.addEventListener('resize', scheduleHeightSync, { passive: true });
        document.addEventListener('turbo:load', scheduleReconcile);
        document.addEventListener('turbo:render', scheduleReconcile);
        document.addEventListener('turbolinks:load', scheduleReconcile);
        document.addEventListener('pjax:end', scheduleReconcile);
        window.addEventListener('storage', (event) => {
            if (event.key !== STORAGE_KEY) return;
            enabled = readStoredState();
            scheduleReconcile();
        });

        if (document.fonts?.ready) {
            document.fonts.ready.then(scheduleHeightSync).catch(() => {});
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
