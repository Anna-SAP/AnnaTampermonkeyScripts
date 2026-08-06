// ==UserScript==
// @name         XTM Cloud Full Project Names
// @name:zh-CN   XTM Cloud 项目名称完整展开
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Expand truncated cells in the XTM Cloud project list so full project names are always visible, with a persistent one-click toggle.
// @description:zh-CN 让 XTM Cloud 项目列表默认展开显示完整项目名称（不再被省略号截断），并提供记忆状态的一键开关。
// @author       Anna-SAP
// @match        https://*.xtm-cloud.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=xtm-cloud.com
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/xtm-cloud-full-project-names.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/xtm-cloud-full-project-names.user.js
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = '__TM_XTM_FULL_NAMES_TOGGLE__';
    const STYLE_ID = '__TM_XTM_FULL_NAMES_STYLE__';
    const ROOT_CLASS = 'tm-xtm-full-names';
    const STORAGE_KEY = 'tm.xtm.fullProjectNames.enabled.v1';
    const DEFAULT_ENABLED = true;
    // XTM truncates listing cells with: max-width: 1px; white-space: nowrap;
    // overflow: hidden; text-overflow: ellipsis. Reverting those four rules
    // on the projects table is exactly what makes full names visible.
    const TABLE_SELECTOR = '#projects_table';

    let enabled = readStoredState();
    let reconcileScheduled = false;

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

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            html.${ROOT_CLASS} ${TABLE_SELECTOR} td {
                max-width: none !important;
                white-space: normal !important;
                overflow: visible !important;
                text-overflow: clip !important;
                overflow-wrap: anywhere !important;
            }

            #${BUTTON_ID} {
                all: unset;
                box-sizing: border-box;
                position: fixed;
                left: max(20px, env(safe-area-inset-left));
                bottom: max(20px, env(safe-area-inset-bottom));
                z-index: 2147483646;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                min-width: 108px;
                height: 36px;
                padding: 0 14px;
                border: 1px solid #bfbfc3;
                border-radius: 18px;
                background: #ffffff;
                color: #333238;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
                font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                cursor: pointer;
                user-select: none;
                transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
            }

            #${BUTTON_ID}[data-enabled="true"] {
                border-color: #2a6fc9;
                background: #2a6fc9;
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

            #${BUTTON_ID} .tm-xtm-icon {
                font-size: 16px;
                line-height: 1;
            }

            @media (max-width: 575px) {
                #${BUTTON_ID} {
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
                #${BUTTON_ID} {
                    display: none !important;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function hasProjectsTable() {
        return Boolean(document.querySelector(TABLE_SELECTOR));
    }

    function createButton() {
        let button = document.getElementById(BUTTON_ID);
        if (button || !document.body) return button;

        button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';

        const icon = document.createElement('span');
        icon.className = 'tm-xtm-icon';
        icon.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'tm-xtm-label';

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

        const icon = button.querySelector('.tm-xtm-icon');
        const label = button.querySelector('.tm-xtm-label');
        const iconText = enabled ? '↵' : '…';
        const labelText = enabled ? '项目全名：开' : '项目全名：关';

        button.dataset.enabled = String(enabled);
        button.setAttribute('aria-pressed', String(enabled));
        button.setAttribute('aria-label', enabled ? '恢复项目名称省略号截断' : '展开显示完整项目名称');
        button.title = enabled ? '完整项目名称已展开；点击恢复省略号截断' : '项目名称当前被截断；点击展开完整名称';
        if (icon && icon.textContent !== iconText) icon.textContent = iconText;
        if (label && label.textContent !== labelText) label.textContent = labelText;
    }

    function reconcilePage() {
        injectStyles();
        document.documentElement.classList.toggle(ROOT_CLASS, enabled);

        if (hasProjectsTable()) {
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
        reconcilePage();

        const observer = new MutationObserver(scheduleReconcile);
        observer.observe(document.documentElement, { childList: true, subtree: true });

        window.addEventListener('popstate', scheduleReconcile);
        window.addEventListener('hashchange', scheduleReconcile);
        window.addEventListener('pageshow', scheduleReconcile);
        window.addEventListener('storage', (event) => {
            if (event.key !== STORAGE_KEY) return;
            enabled = readStoredState();
            scheduleReconcile();
        });
    }

    // @run-at document-start: apply the CSS override before first paint to
    // avoid a flash of truncated names, then wait for the DOM to build the
    // toggle button.
    injectStyles();
    document.documentElement.classList.toggle(ROOT_CLASS, enabled);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
