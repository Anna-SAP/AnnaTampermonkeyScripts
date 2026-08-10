// ==UserScript==
// @name         Directory Index ZIP Batch Download
// @name:zh-CN   目录索引页 ZIP 批量下载
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.2.0
// @description  Add a floating button to standard web directory index pages that batch-downloads every linked .zip file with staggered, throttled triggers.
// @description:zh-CN 在标准 Web 目录索引页（如 nginx autoindex）注入浮动按钮，一键批量下载页面内全部 .zip 文件，错峰触发以规避浏览器并发下载限制与弹窗拦截。
// @author       Anna-SAP
// @match        *://l10n-tool.int.rclabenv.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=rclabenv.com
// @run-at       document-idle
// @grant        GM_download
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/directory-index-zip-batch-download.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/directory-index-zip-batch-download.user.js
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = '__TM_DIR_INDEX_ZIP_BATCH_DOWNLOAD__';
    const STYLE_ID = '__TM_DIR_INDEX_ZIP_BATCH_DOWNLOAD_STYLE__';
    const ICON_CLASS = 'tm-zipdl-icon';
    const LABEL_CLASS = 'tm-zipdl-label';
    // Browsers silently drop rapid-fire download triggers and cap parallel
    // connections per host, so starts are staggered and in-flight GM_download
    // transfers are limited instead of firing everything at once.
    const MAX_CONCURRENT_DOWNLOADS = 3;
    const START_STAGGER_MS = 600;
    const SLOT_POLL_MS = 150;
    const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
    const SUCCESS_DURATION_MS = 4000;
    const ERROR_DURATION_MS = 6000;

    let batchInProgress = false;
    let feedbackTimer = null;

    function delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    function isDirectoryIndexPage() {
        const heading = document.querySelector('h1');
        return /^index of\b/i.test(document.title.trim())
            || /^index of\b/i.test(heading?.textContent?.trim() || '');
    }

    function collectZipLinks() {
        const links = [];
        const seen = new Set();

        document.querySelectorAll('a[href]').forEach((anchor) => {
            if (anchor.closest(`#${BUTTON_ID}`)) return;

            let url;
            try {
                url = new URL(anchor.getAttribute('href'), location.href);
            } catch (error) {
                return;
            }

            // Autoindex pages only link same-origin files; anything else on
            // the page (breadcrumbs, tool navigation) is not a batch target.
            if (url.origin !== location.origin) return;
            if (!/\.zip$/i.test(url.pathname)) return;
            if (seen.has(url.href)) return;
            seen.add(url.href);

            const rawName = url.pathname.split('/').pop();
            let name = rawName;
            try {
                name = decodeURIComponent(rawName);
            } catch (error) {
                // Keep the encoded segment when the URL is malformed.
            }

            links.push({ url: url.href, name });
        });

        return links;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${BUTTON_ID} {
                all: unset;
                box-sizing: border-box;
                position: fixed;
                top: max(20px, env(safe-area-inset-top));
                right: max(20px, env(safe-area-inset-right));
                z-index: 2147483646;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                min-width: 148px;
                height: 36px;
                padding: 0 14px;
                border: 1px solid #2a6fc9;
                border-radius: 18px;
                background: #2a6fc9;
                color: #ffffff;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
                font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                cursor: pointer;
                user-select: none;
                transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
            }

            #${BUTTON_ID}:hover:not(:disabled) {
                transform: translateY(-1px);
                box-shadow: 0 5px 14px rgba(0, 0, 0, 0.22);
            }

            #${BUTTON_ID}:focus-visible {
                outline: 2px solid #428fdc;
                outline-offset: 2px;
            }

            #${BUTTON_ID}:disabled {
                cursor: wait;
                opacity: 0.75;
            }

            #${BUTTON_ID}[data-state="success"] {
                border-color: #108548;
                background: #108548;
            }

            #${BUTTON_ID}[data-state="error"] {
                border-color: #dd2b0e;
                background: #dd2b0e;
            }

            #${BUTTON_ID} .${ICON_CLASS} {
                flex: none;
                font-size: 16px;
                line-height: 1;
            }

            #${BUTTON_ID} .${LABEL_CLASS} {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            @media (max-width: 575px) {
                #${BUTTON_ID} {
                    top: 12px;
                    right: 12px;
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

    function setButtonState(state, label, title) {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;

        const labelElement = button.querySelector(`.${LABEL_CLASS}`);
        button.dataset.state = state;
        button.disabled = state === 'busy';
        button.setAttribute('aria-label', label);
        button.title = title || label;
        if (labelElement) labelElement.textContent = label;
    }

    function idleLabel() {
        return `批量下载 ZIP (${collectZipLinks().length})`;
    }

    function restoreButtonLater(milliseconds) {
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => {
            feedbackTimer = null;
            setButtonState('idle', idleLabel(), '下载当前目录索引页内的全部 ZIP 文件');
        }, milliseconds);
    }

    function gmDownload(item) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (finish, value) => {
                if (settled) return;
                settled = true;
                finish(value);
            };

            try {
                GM_download({
                    url: item.url,
                    name: item.name,
                    // saveAs must be an explicit false: leaving it unset makes
                    // the browser fall back to its "ask where to save each
                    // file" preference, which pops one dialog per file.
                    // uniquify silently renames on name collisions instead of
                    // raising an overwrite prompt.
                    saveAs: false,
                    conflictAction: 'uniquify',
                    timeout: DOWNLOAD_TIMEOUT_MS,
                    onload: () => settle(resolve),
                    onerror: (result) => settle(
                        reject,
                        new Error(result?.error || 'download_failed'),
                    ),
                    ontimeout: () => settle(reject, new Error('timeout')),
                });
            } catch (error) {
                settle(reject, error);
            }
        });
    }

    // Same-origin <a download> click: no popup blocker involved, and the
    // browser download manager takes over. Used when GM_download is not
    // granted, or rejects (e.g. the extension in the extension settings has
    // a download whitelist that excludes .zip).
    function triggerAnchorDownload(item) {
        const anchor = document.createElement('a');
        anchor.href = item.url;
        anchor.download = item.name;
        anchor.rel = 'noopener';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    }

    async function runBatch(items) {
        const total = items.length;
        // GM_download is only trusted in Browser API download mode. In
        // Tampermonkey's Native mode the transfer is streamed through a
        // blob: URL and the browser names the saved file after the blob UUID
        // (hash-like *.zip) instead of the requested name, so the same-origin
        // <a download> path — which always keeps the real file name — is
        // used for every other mode.
        const downloadMode = typeof GM_info === 'object' && GM_info !== null
            ? GM_info.downloadMode
            : undefined;
        const canUseGmDownload = typeof GM_download === 'function'
            && (downloadMode === undefined || downloadMode === 'browser');
        let inFlight = 0;
        let settledCount = 0;
        let failedCount = 0;

        const updateProgress = () => {
            setButtonState('busy', `下载中 ${settledCount}/${total}`, '批量下载进行中…');
        };
        updateProgress();

        for (const item of items) {
            while (inFlight >= MAX_CONCURRENT_DOWNLOADS) {
                await delay(SLOT_POLL_MS);
            }

            if (canUseGmDownload) {
                inFlight += 1;
                gmDownload(item)
                    .catch(() => {
                        try {
                            triggerAnchorDownload(item);
                        } catch (error) {
                            failedCount += 1;
                        }
                    })
                    .finally(() => {
                        inFlight -= 1;
                        settledCount += 1;
                        updateProgress();
                    });
            } else {
                try {
                    triggerAnchorDownload(item);
                } catch (error) {
                    failedCount += 1;
                }
                settledCount += 1;
                updateProgress();
            }

            await delay(START_STAGGER_MS);
        }

        while (inFlight > 0) {
            await delay(SLOT_POLL_MS);
        }

        return { total, failedCount };
    }

    async function handleBatchClick() {
        if (batchInProgress) return;

        const items = collectZipLinks();
        if (!items.length) {
            setButtonState('error', '未找到 ZIP 链接', '当前页面没有指向 .zip 文件的链接');
            restoreButtonLater(ERROR_DURATION_MS);
            return;
        }

        batchInProgress = true;
        clearTimeout(feedbackTimer);
        feedbackTimer = null;

        try {
            const { total, failedCount } = await runBatch(items);
            if (failedCount > 0) {
                setButtonState(
                    'error',
                    `完成，${failedCount} 个失败`,
                    `已处理 ${total} 个 ZIP，其中 ${failedCount} 个下载失败`,
                );
                restoreButtonLater(ERROR_DURATION_MS);
            } else {
                setButtonState(
                    'success',
                    `已触发 ${total} 个下载`,
                    `已触发 ${total} 个 ZIP 下载，请在浏览器下载列表确认`,
                );
                restoreButtonLater(SUCCESS_DURATION_MS);
            }
        } finally {
            batchInProgress = false;
        }
    }

    function createButton() {
        if (document.getElementById(BUTTON_ID) || !document.body) return;

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.dataset.state = 'idle';
        button.setAttribute('aria-live', 'polite');

        const icon = document.createElement('span');
        icon.className = ICON_CLASS;
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '⇩';

        const label = document.createElement('span');
        label.className = LABEL_CLASS;

        button.append(icon, label);
        button.addEventListener('click', handleBatchClick);
        document.body.appendChild(button);
        setButtonState('idle', idleLabel(), '下载当前目录索引页内的全部 ZIP 文件');
    }

    function start() {
        // Directory index pages are static server-rendered HTML, so a single
        // pass at load time is enough; the link list is re-collected on every
        // click in case the page was modified in place.
        if (!isDirectoryIndexPage()) return;
        if (!collectZipLinks().length) return;

        injectStyles();
        createButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
