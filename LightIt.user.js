// ==UserScript==
// @name         LightIt
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Force all web pages to render in Light Mode by overriding dark mode implementations
// @author       Anna
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    //  LightIt — Global Light Mode Enforcer
    //  Principle: intercept at the earliest possible moment, then
    //  continuously clean up dark-mode signals.
    // ============================================================

    // ── Helper: inject a <style> into the page ──
    function injectCSS(css) {
        const style = document.createElement('style');
        style.id = 'lightit-force';
        style.textContent = css;
        document.documentElement.appendChild(style);
    }

    // ── 1. Override prefers-color-scheme media query ──
    const origMatchMedia = window.matchMedia;
    window.matchMedia = function(query) {
        if (/prefers-color-scheme/i.test(query)) {
            const mql = origMatchMedia.call(this, '(prefers-color-scheme: light)');
            mql.matches = true;
            Object.defineProperty(mql, 'media', {
                get: () => '(prefers-color-scheme: light)'
            });
            const origAdd = mql.addEventListener;
            mql.addEventListener = function(type, listener, options) {
                if (type === 'change') return;
                return origAdd.call(this, type, listener, options);
            };
            return mql;
        }
        return origMatchMedia.call(this, query);
    };

    // ── 2. Force color-scheme CSS on root ──
    injectCSS(':root { color-scheme: light !important; }');

    // ── 3. MutationObserver: clean up dark-mode classes/attrs ──
    const DARK_PATTERNS = [
        /(^|\s)dark(-mode|-theme|\s|$)/i,
        /(^|\s)theme-?dark(\s|$)/i,
        /(^|\s)night(-mode|-theme|\s|$)/i,
        /(^|\s)is-?dark(\s|$)/i,
        /(^|\s)has-?dark(\s|$)/i,
        /(^|\s)dracula(\s|$)/i,
        /(^|\s)darkreader(\s|$)/i,
        /(^|\s)dark\b/i,
    ];
    const DARK_ATTRS = ['data-theme','data-mode','data-color-scheme','data-dark-mode','theme','color-scheme'];
    const DARK_VALUES = ['dark','night','dim','black'];

    function sanitizeElement(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.className && typeof el.className === 'string') {
            let cls = el.className, changed = false;
            DARK_PATTERNS.forEach(re => { if (re.test(cls)) { cls = cls.replace(re, ' '); changed = true; } });
            if (changed) { el.className = cls.replace(/\s+/g, ' ').trim(); }
        }
        DARK_ATTRS.forEach(attr => {
            const val = el.getAttribute(attr);
            if (val && DARK_VALUES.some(v => val.toLowerCase().includes(v))) el.removeAttribute(attr);
        });
    }

    if (document.documentElement) sanitizeElement(document.documentElement);

    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'attributes' && (m.attributeName === 'class' || DARK_ATTRS.includes(m.attributeName))) {
                sanitizeElement(m.target);
            }
            if (m.addedNodes && m.addedNodes.length) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) { sanitizeElement(node); if (node.querySelectorAll) node.querySelectorAll('*').forEach(sanitizeElement); }
                }
            }
        }
    });

    function startObserver() {
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', ...DARK_ATTRS], childList: true, subtree: true });
    }
    if (document.documentElement) startObserver(); else document.addEventListener('DOMContentLoaded', startObserver);

    // ── 4. Body background/color rescue ──
    document.addEventListener('DOMContentLoaded', function() {
        const body = document.body; if (!body) return;
        const bg = window.getComputedStyle(body).backgroundColor;
        if (bg && /^rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(bg)) body.style.backgroundColor = '#ffffff';
        const color = window.getComputedStyle(body).color;
        if (color && /^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/i.test(color)) body.style.color = '#000000';
    });

    // ── 5. Same-origin iframe injection ──
    document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (doc && doc.head) {
                    const ls = doc.createElement('style');
                    ls.textContent = ':root{color-scheme:light!important}html,body{background:#fff!important;color:#000!important}';
                    doc.head.appendChild(ls);
                }
            } catch(e) { /* cross-origin iframe — skip */ }
        });
    });

})();
