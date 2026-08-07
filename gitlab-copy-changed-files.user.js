// ==UserScript==
// @name         GitLab Copy Changed File List
// @name:zh-CN   GitLab 复制变更文件列表
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Add a one-click button to GitLab merge request diffs that copies every changed file path as newline-separated text.
// @description:zh-CN 在 GitLab 合并请求的 Changes 页面添加一键复制按钮，将全部变更文件路径按行复制为纯文本。
// @author       Anna-SAP
// @match        https://git.ringcentral.com/*
// @match        https://gitlab.com/*
// @icon         https://gitlab.com/favicon.ico
// @run-at       document-idle
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/gitlab-copy-changed-files.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/gitlab-copy-changed-files.user.js
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = '__TM_GITLAB_COPY_CHANGED_FILES__';
    const WRAPPER_ID = '__TM_GITLAB_COPY_CHANGED_FILES_WRAPPER__';
    const STYLE_ID = '__TM_GITLAB_COPY_CHANGED_FILES_STYLE__';
    const LABEL_CLASS = 'tm-glcf-label';
    const DIFF_PATH_RE = /\/-\/merge_requests\/\d+\/diffs(?:\/.*)?$/;
    const TREE_ROOT_SELECTOR = [
        '[data-testid="file-tree-container"]',
        '[data-qa-selector="file_tree_container"]',
        '.tree-list-holder',
        '.diff-tree-list .js-diff-tree-list',
        '.diff-tree-list .diff-file-tree',
        '.diff-tree-list',
        '#diff-file-tree',
    ].join(', ');
    const TREE_ROW_SELECTOR = [
        '.file-row-header',
        '[data-testid="file-row"]',
        '.diff-file-row[data-file-row]',
        '.diff-tree-list .file-row[data-file-row]',
        '.mr-tree-list .diff-file-row.file-row',
    ].join(', ');
    const DIFF_HEADER_SELECTOR = [
        '[data-testid="file-title-container"]',
        '.js-file-title.file-title',
        '.diff-file .file-title',
        '[data-testid="diff-file-container"]',
        'diff-file',
    ].join(', ');
    const DEFAULT_LABEL = '复制变更文件列表';
    const RETRY_INTERVAL_MS = 120;
    const LOAD_TIMEOUT_MS = 2400;
    const SUCCESS_DURATION_MS = 1800;
    const ERROR_DURATION_MS = 3200;

    let reconcileScheduled = false;
    let feedbackTimer = null;
    let copyInProgress = false;
    let copyRequestId = 0;
    let activeDiffPageKey = '';

    function nextFrame(callback) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(callback);
        } else {
            setTimeout(callback, 16);
        }
    }

    function delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    function isMergeRequestDiffPage() {
        return DIFF_PATH_RE.test(location.pathname);
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${WRAPPER_ID} {
                box-sizing: border-box;
                display: flex;
                width: 100%;
                margin: 0 0 12px;
            }

            #${WRAPPER_ID}[data-location="floating"] {
                position: fixed;
                left: max(20px, env(safe-area-inset-left));
                bottom: max(20px, env(safe-area-inset-bottom));
                z-index: 2147483646;
                width: auto;
                margin: 0;
                filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.2));
            }

            #${BUTTON_ID} {
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                width: 100%;
                min-height: 32px;
                padding: 6px 12px;
                border: 1px solid var(--gl-border-color-default, #bfbfc3);
                border-radius: 4px;
                background: var(--gl-background-color-default, #ffffff);
                color: var(--gl-text-color-default, #333238);
                font: 600 13px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                text-align: center;
                cursor: pointer;
                user-select: none;
                transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
            }

            #${BUTTON_ID}:hover:not(:disabled) {
                border-color: var(--gl-border-color-strong, #89888d);
                background: var(--gl-background-color-subtle, #f0f0f0);
            }

            #${BUTTON_ID}:focus-visible {
                outline: 2px solid var(--gl-focus-ring-outer-color, #428fdc);
                outline-offset: 2px;
            }

            #${BUTTON_ID}:disabled {
                cursor: wait;
                opacity: 0.7;
            }

            #${BUTTON_ID}[data-state="success"] {
                border-color: var(--gl-status-success-border-color, #108548);
                background: var(--gl-status-success-background-color, #ecf4ee);
                color: var(--gl-status-success-text-color, #0a7a3d);
            }

            #${BUTTON_ID}[data-state="error"] {
                border-color: var(--gl-status-danger-border-color, #dd2b0e);
                background: var(--gl-status-danger-background-color, #fcf1ef);
                color: var(--gl-status-danger-text-color, #ae1800);
            }

            #${BUTTON_ID} .tm-glcf-icon {
                flex: none;
                font-size: 16px;
                font-weight: 400;
                line-height: 1;
            }

            #${BUTTON_ID} .${LABEL_CLASS} {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            @media (max-width: 575px) {
                #${WRAPPER_ID}[data-location="floating"] {
                    left: 12px;
                    bottom: 12px;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                #${BUTTON_ID} {
                    transition: none;
                }
            }

            @media print {
                #${WRAPPER_ID} {
                    display: none !important;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function findFileTree() {
        const appRoot = document.querySelector('#js-diffs-app, [data-rapid-diffs]') || document;
        const primary = appRoot.querySelector(
            '[data-testid="file-tree-container"], '
            + '[data-qa-selector="file_tree_container"], .tree-list-holder',
        );
        if (primary) return primary;

        const candidates = Array.from(appRoot.querySelectorAll(TREE_ROOT_SELECTOR));
        return candidates.find((candidate) =>
            candidate.querySelector(
                '[data-testid="file-count"], [data-testid="file-row"], '
                + '#diff-tree-search, .diff-file-row, .file-row',
            )) || null;
    }

    function directChildContaining(root, element) {
        let child = element;
        while (child && child.parentElement !== root) child = child.parentElement;
        return child && child.parentElement === root ? child : null;
    }

    function placeWrapper(wrapper, treeRoot) {
        if (!treeRoot) {
            wrapper.dataset.location = 'floating';
            if (wrapper.parentElement !== document.body) document.body.appendChild(wrapper);
            return;
        }

        wrapper.dataset.location = 'tree';
        const search = treeRoot.querySelector(
            '[data-testid="diff-tree-search"], #diff-tree-search, '
            + 'input[name="diff-tree-search"]',
        );
        const searchBlock = search ? directChildContaining(treeRoot, search) : null;

        if (searchBlock) {
            if (wrapper.parentElement !== treeRoot || wrapper.nextElementSibling !== searchBlock) {
                treeRoot.insertBefore(wrapper, searchBlock);
            }
            return;
        }

        const heading = treeRoot.querySelector(
            '#tree-list-title, [aria-label="File browser"], .tree-list-header',
        );
        const headingBlock = heading ? directChildContaining(treeRoot, heading) : null;
        if (headingBlock?.nextElementSibling) {
            treeRoot.insertBefore(wrapper, headingBlock.nextElementSibling);
        } else if (wrapper.parentElement !== treeRoot) {
            treeRoot.prepend(wrapper);
        }
    }

    function createButtonWrapper() {
        let wrapper = document.getElementById(WRAPPER_ID);
        if (wrapper || !document.body) return wrapper;

        wrapper = document.createElement('div');
        wrapper.id = WRAPPER_ID;

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.dataset.state = 'idle';
        button.setAttribute('aria-live', 'polite');
        button.setAttribute('aria-label', DEFAULT_LABEL);
        button.title = '将全部变更文件的完整路径按行复制到剪贴板';

        const icon = document.createElement('span');
        icon.className = 'tm-glcf-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '⧉';

        const label = document.createElement('span');
        label.className = LABEL_CLASS;
        label.textContent = DEFAULT_LABEL;

        button.append(icon, label);
        button.addEventListener('click', handleCopyClick);
        wrapper.appendChild(button);
        document.body.appendChild(wrapper);
        return wrapper;
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

    function restoreButtonLater(milliseconds) {
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => {
            feedbackTimer = null;
            setButtonState(
                'idle',
                DEFAULT_LABEL,
                '将全部变更文件的完整路径按行复制到剪贴板',
            );
        }, milliseconds);
    }

    function normalizePath(value) {
        if (value == null) return '';

        const path = String(value);
        if (!path || /[\r\n]/.test(path)) return '';

        return path
            .replace(/^\.\/+/, '')
            .replace(/^\/+|\/+$/g, '')
            .replace(/\/{2,}/g, '/');
    }

    function joinPath(parent, child) {
        const parentPath = normalizePath(parent);
        const childPath = normalizePath(child);
        if (!childPath) return '';
        if (!parentPath || childPath === parentPath || childPath.startsWith(`${parentPath}/`)) {
            return childPath;
        }
        return `${parentPath}/${childPath}`;
    }

    function addUniquePath(paths, seen, value) {
        const path = normalizePath(value);
        if (!path || seen.has(path)) return;
        seen.add(path);
        paths.push(path);
    }

    function readRowName(row) {
        const nameElement = row.querySelector?.(
            '[data-testid="file-row-name-container"], .file-row-name',
        );
        const exactName = row.getAttribute('data-file-name')
            || row.getAttribute('aria-label')
            || nameElement?.getAttribute('data-qa-file-name')
            || nameElement?.getAttribute('title');
        return exactName || nameElement?.textContent?.trim() || '';
    }

    function readExplicitRowPath(row) {
        const holders = [row, row.closest?.('[data-file-path], [data-new-path], [data-path]')];
        const attributes = ['data-file-path', 'data-new-path', 'data-path'];

        for (const holder of holders) {
            if (!holder) continue;
            for (const attribute of attributes) {
                const value = holder.getAttribute(attribute);
                if (value) return normalizePath(value);
            }
        }

        const title = row.getAttribute('title');
        return title?.includes('/') ? normalizePath(title) : '';
    }

    function isDirectoryRow(row) {
        return row.classList.contains('folder')
            || row.hasAttribute('aria-expanded')
            || Boolean(row.querySelector?.('.folder, [aria-expanded]'));
    }

    function extractPathsFromFileTree(treeRoot) {
        if (!treeRoot) return [];

        const paths = [];
        const seen = new Set();
        const directoryStack = [];
        let listHeaderPath = '';

        Array.from(treeRoot.querySelectorAll(TREE_ROW_SELECTOR)).forEach((candidate) => {
            if (candidate.closest(`#${WRAPPER_ID}`)) return;

            if (candidate.matches('.file-row-header')) {
                const exactHeaderPath = candidate.getAttribute('title')
                    || candidate.getAttribute('data-path');
                listHeaderPath = normalizePath(
                    exactHeaderPath || candidate.textContent.trim(),
                );
                directoryStack.length = 0;
                return;
            }

            if (
                !candidate.matches('[data-testid="file-row"]')
                && candidate.querySelector('[data-testid="file-row"]')
            ) {
                return;
            }

            const row = candidate;
            const name = normalizePath(readRowName(row));
            if (!name) return;

            const levelValue = Number.parseInt(row.getAttribute('data-level'), 10);
            const level = Number.isFinite(levelValue) && levelValue >= 0 ? levelValue : 0;
            const explicitPath = readExplicitRowPath(row);

            if (isDirectoryRow(row)) {
                listHeaderPath = '';
                const parentPath = level > 0 ? directoryStack[level - 1] : '';
                const directoryPath = explicitPath || joinPath(parentPath, name);
                directoryStack.length = level + 1;
                directoryStack[level] = directoryPath;
                return;
            }

            const parentPath = listHeaderPath || (level > 0 ? directoryStack[level - 1] : '');
            addUniquePath(paths, seen, explicitPath || joinPath(parentPath, name));
        });

        return paths;
    }

    function pathFromClipboardPayload(value) {
        if (!value) return '';

        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed.text === 'string') return normalizePath(parsed.text);
        } catch (error) {
            // Older GitLab versions store the plain path rather than JSON here.
        }

        return normalizePath(value);
    }

    function extractPathsFromDiffHeaders() {
        const paths = [];
        const seen = new Set();

        document.querySelectorAll(DIFF_HEADER_SELECTOR).forEach((header) => {
            const pathHolder = header.closest(
                '[data-file-path], [data-new-path], [data-path]',
            );
            const directPath = header.getAttribute('data-file-path')
                || header.getAttribute('data-new-path')
                || header.getAttribute('data-path')
                || pathHolder?.getAttribute('data-file-path')
                || pathHolder?.getAttribute('data-new-path')
                || pathHolder?.getAttribute('data-path');
            const clipboard = header.querySelector(
                '[data-testid="diff-file-copy-clipboard"][data-clipboard-text], '
                + '[data-clipboard-text][aria-label*="file path" i], '
                + '[data-clipboard-text][title*="file path" i]',
            );
            let path = directPath;

            if (!path && header.matches('diff-file[data-file-data]')) {
                try {
                    const fileData = JSON.parse(header.getAttribute('data-file-data'));
                    path = fileData.new_path
                        || fileData.newPath
                        || fileData.old_path
                        || fileData.oldPath
                        || '';
                } catch (error) {
                    // Streaming Rapid Diffs can briefly expose an incomplete attribute.
                }
            }

            path ||= pathFromClipboardPayload(clipboard?.getAttribute('data-clipboard-text'));

            if (!path) {
                const renamedPaths = header.querySelectorAll('.file-title-name[title]');
                const newPath = renamedPaths.length
                    ? renamedPaths[renamedPaths.length - 1].getAttribute('title')
                    : '';
                const name = header.querySelector(
                    '[data-testid="file-name-content"][title], [data-qa-file-name]',
                );
                path = newPath
                    || name?.getAttribute('title')
                    || name?.getAttribute('data-qa-file-name')
                    || '';
            }

            addUniquePath(paths, seen, path);
        });

        document.querySelectorAll(
            '.diff-file[data-file-path], diff-file[data-file-path], '
            + '[data-testid="diff-file"][data-file-path], '
            + '#js-diffs-app .diff-file[data-path]',
        ).forEach((element) => addUniquePath(
            paths,
            seen,
            element.getAttribute('data-file-path') || element.getAttribute('data-path'),
        ));

        document.querySelectorAll(
            'diff-file[data-file-data], [data-testid="rd-diff-file"][data-file-data]',
        ).forEach((element) => {
            try {
                const fileData = JSON.parse(element.getAttribute('data-file-data'));
                addUniquePath(
                    paths,
                    seen,
                    fileData.new_path
                        || fileData.newPath
                        || fileData.old_path
                        || fileData.oldPath,
                );
            } catch (error) {
                // The remaining fallbacks still work while a streaming node is incomplete.
            }
        });

        return paths;
    }

    function readExpectedFileCount(treeRoot) {
        if (!treeRoot) return null;

        const countElement = treeRoot.querySelector(
            '[data-testid="file-count"], .tree-list-header .badge, '
            + '.diff-tree-list-header .badge',
        );
        if (!countElement) return null;

        const digits = countElement.textContent.replace(/[^0-9]/g, '');
        if (!digits) return null;
        const count = Number.parseInt(digits, 10);
        return Number.isFinite(count) ? count : null;
    }

    function mergeUniquePaths(primary, secondary) {
        const paths = [];
        const seen = new Set();
        primary.forEach((path) => addUniquePath(paths, seen, path));
        secondary.forEach((path) => addUniquePath(paths, seen, path));
        return paths;
    }

    function collectPathSnapshot() {
        const treeRoot = findFileTree();
        const expectedCount = readExpectedFileCount(treeRoot);
        const treePaths = extractPathsFromFileTree(treeRoot);
        const headerPaths = extractPathsFromDiffHeaders();
        const mergedPaths = mergeUniquePaths(treePaths, headerPaths);
        let paths;

        if (expectedCount != null) {
            if (headerPaths.length === expectedCount) {
                paths = headerPaths;
            } else if (treePaths.length === expectedCount) {
                paths = treePaths;
            } else if (mergedPaths.length === expectedCount) {
                paths = mergedPaths;
            } else {
                paths = [treePaths, headerPaths, mergedPaths].reduce(
                    (longest, candidate) => candidate.length > longest.length ? candidate : longest,
                    [],
                );
            }
        } else {
            paths = treePaths.length >= headerPaths.length ? treePaths : headerPaths;
        }

        return {
            paths,
            expectedCount,
            complete: expectedCount != null && paths.length === expectedCount,
        };
    }

    function readMetadataEndpoint() {
        const classicApp = document.querySelector('#js-diffs-app[data-endpoint-metadata]');
        if (classicApp?.dataset.endpointMetadata) return classicApp.dataset.endpointMetadata;

        const rapidApp = document.querySelector(
            '.rd-app[data-rapid-diffs][data-app-data], [data-rapid-diffs][data-app-data]',
        );
        if (!rapidApp) return '';

        try {
            const appData = JSON.parse(rapidApp.getAttribute('data-app-data'));
            return appData.diffFilesEndpoint || appData.diff_files_endpoint || '';
        } catch (error) {
            return '';
        }
    }

    async function extractPathsFromFileTreeMetadata(expectedCount) {
        const endpoint = readMetadataEndpoint();
        if (!endpoint) return null;

        let url;
        try {
            url = new URL(endpoint, location.href);
        } catch (error) {
            return null;
        }
        if (url.origin !== location.origin) return null;
        if (document.querySelector('#js-diffs-app[data-endpoint-metadata]')) {
            url.searchParams.set('view', url.searchParams.get('view') || 'inline');
        }

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeout = controller ? setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS) : null;

        try {
            const response = await fetch(url, {
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                signal: controller?.signal,
            });
            if (!response.ok) return null;

            const data = await response.json();
            const files = data.diff_files || data.diffFiles || data.data?.diff_files;
            if (!Array.isArray(files)) return null;

            const paths = [];
            const seen = new Set();
            files.forEach((fileData) => addUniquePath(
                paths,
                seen,
                fileData.new_path
                    || fileData.newPath
                    || fileData.old_path
                    || fileData.oldPath,
            ));

            const responseCountValue = data.real_size
                ?? data.realSize
                ?? data.count
                ?? data.data?.real_size
                ?? expectedCount;
            const responseCount = Number.parseInt(responseCountValue, 10);
            const verifiedCount = Number.isFinite(responseCount) ? responseCount : null;
            return {
                paths,
                expectedCount: verifiedCount,
                complete: verifiedCount == null
                    ? paths.length > 0
                    : paths.length === verifiedCount,
            };
        } catch (error) {
            return null;
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    async function waitForCompletePathList() {
        const deadline = Date.now() + LOAD_TIMEOUT_MS;
        let best = collectPathSnapshot();

        if (!best.complete) {
            const metadata = await extractPathsFromFileTreeMetadata(best.expectedCount);
            if (metadata?.complete) return metadata;
            if (metadata && metadata.paths.length > best.paths.length) best = metadata;
        }

        while (!best.complete && Date.now() < deadline) {
            await delay(RETRY_INTERVAL_MS);
            const current = collectPathSnapshot();
            if (current.complete || current.paths.length > best.paths.length) best = current;
        }

        return best;
    }

    async function writeClipboard(text) {
        let lastError = null;

        if (typeof GM_setClipboard === 'function') {
            try {
                await Promise.resolve(GM_setClipboard(text, 'text'));
                return;
            } catch (error) {
                lastError = error;
            }
        }

        if (typeof navigator.clipboard?.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (error) {
                lastError = error;
            }
        }

        const textarea = document.createElement('textarea');
        const activeElement = document.activeElement;
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        let copied = false;
        try {
            copied = typeof document.execCommand === 'function'
                && document.execCommand('copy');
        } catch (error) {
            lastError = error;
        } finally {
            textarea.remove();
            try {
                activeElement?.focus?.({ preventScroll: true });
            } catch (error) {
                activeElement?.focus?.();
            }
        }

        if (!copied) throw lastError || new Error('Clipboard API is unavailable');
    }

    async function handleCopyClick() {
        if (copyInProgress) return;

        const requestId = ++copyRequestId;
        const pageKey = activeDiffPageKey;
        copyInProgress = true;
        clearTimeout(feedbackTimer);
        feedbackTimer = null;
        setButtonState('busy', '正在读取文件列表…');

        try {
            const { paths, expectedCount, complete } = await waitForCompletePathList();
            if (requestId !== copyRequestId || pageKey !== activeDiffPageKey) return;
            if (!paths.length) throw new Error('NO_FILES');
            if (!complete) {
                throw new Error(`INCOMPLETE:${paths.length}:${expectedCount ?? '?'}`);
            }

            await writeClipboard(paths.join('\n'));
            if (requestId !== copyRequestId || pageKey !== activeDiffPageKey) return;
            setButtonState(
                'success',
                `已复制 ${paths.length} 个文件`,
                `已复制 ${paths.length} 个完整文件路径`,
            );
            restoreButtonLater(SUCCESS_DURATION_MS);
        } catch (error) {
            if (requestId !== copyRequestId || pageKey !== activeDiffPageKey) return;
            const errorMessage = error instanceof Error ? error.message : String(error);
            let message = '复制失败，请检查剪贴板权限';
            if (errorMessage === 'NO_FILES') {
                message = '未找到变更文件';
            } else if (errorMessage.startsWith('INCOMPLETE:')) {
                const [, found, expected] = errorMessage.split(':');
                message = `文件列表仍在加载 (${found}/${expected})`;
            }
            setButtonState('error', message, `${message}；请稍后重试`);
            restoreButtonLater(ERROR_DURATION_MS);
        } finally {
            if (requestId === copyRequestId) copyInProgress = false;
        }
    }

    function removeButton() {
        clearTimeout(feedbackTimer);
        feedbackTimer = null;
        copyInProgress = false;
        document.getElementById(WRAPPER_ID)?.remove();
    }

    function reconcilePage() {
        const onDiffPage = isMergeRequestDiffPage();
        const pageKey = onDiffPage ? `${location.pathname}${location.search}` : '';
        const pageChanged = pageKey !== activeDiffPageKey;

        if (pageChanged) {
            activeDiffPageKey = pageKey;
            copyRequestId += 1;
            copyInProgress = false;
            clearTimeout(feedbackTimer);
            feedbackTimer = null;
            setButtonState(
                'idle',
                DEFAULT_LABEL,
                '将全部变更文件的完整路径按行复制到剪贴板',
            );
        }

        if (!onDiffPage) {
            removeButton();
            return;
        }

        injectStyles();
        const wrapper = createButtonWrapper();
        if (wrapper) placeWrapper(wrapper, findFileTree());
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
        reconcilePage();

        const observer = new MutationObserver(scheduleReconcile);
        observer.observe(document.documentElement, { childList: true, subtree: true });

        window.addEventListener('popstate', scheduleReconcile);
        window.addEventListener('hashchange', scheduleReconcile);
        window.addEventListener('pageshow', scheduleReconcile);
        document.addEventListener('turbo:load', scheduleReconcile);
        document.addEventListener('turbo:render', scheduleReconcile);
        document.addEventListener('turbolinks:load', scheduleReconcile);
        document.addEventListener('pjax:end', scheduleReconcile);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
