// ==UserScript==
// @name         Youku Danmaku Color
// @name:zh-CN   优酷弹幕统一颜色
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.0.0
// @description  Show every danmaku (bullet comment) on Youku's web player in one bright colour (yellow #ffdd00 by default) with a black outline and full opacity, like-heart and count included. Change the colour from the Tampermonkey menu or DEFAULT_COLOR below.
// @description:zh-CN 把优酷网页版播放页上的所有弹幕统一显示成同一种醒目颜色（默认黄色 #ffdd00），加黑色描边、去掉半透明，点赞心形和数字一起变色。换色：Tampermonkey 菜单「设置弹幕颜色…」，或改脚本里的 DEFAULT_COLOR。
// @author       Anna-SAP
// @match        https://v.youku.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youku.com
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/youku-danmaku-color.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/youku-danmaku-color.user.js
// ==/UserScript==

// How Youku draws danmaku (youku-barrage 0.3.0 on v.youku.com):
//
//   div.barrage-container.youku-barrage_xxxxx   style="opacity: 0.8"  <- the 不透明度 slider
//     div.barrage-word.barrage-word_xxxxx            (scrolling danmaku)
//     div.barrage-word.barrage-vertical-word ...     (vertical danmaku)
//       div.word-span_xxxxx   style="color: #...; text-shadow: ...; opacity: ..."
//         "那枚晶魄怎么了呢"                    text, or span.gradient-part for colourful danmaku
//         img.vote-icon                          the like heart (a white image)
//         "8"                                    like count, text or a gradient span
//       div.hover-container_xxxxx                the +1 / 炸 / 举报 panel (on hover only)
//
// Every colour and opacity is an inline style, so the CSS below wins with
// !important. CSS applies to every danmaku as soon as it is created, so
// danmaku that appear later are covered without watching the DOM.
// The hashed suffixes (_xxxxx) change between Youku releases, so only the
// stable class names are used: barrage-word, barrage-container, and
// [class*="word-span"].
// The hover panel sits next to the word span, not inside it, so it keeps
// Youku's own colours.

(function () {
    'use strict';

    // ---- Default danmaku colour: any CSS colour works ----
    // e.g. '#ffdd00' yellow, '#00e5ff' cyan, '#7CFC00' green, 'white'.
    // A colour set from the Tampermonkey menu overrides this one and is
    // kept across script updates.
    var DEFAULT_COLOR = '#ffdd00';

    // Outline drawn around every character so the colour stays readable
    // on bright scenes.
    var OUTLINE_COLOR = '#000000';

    // true: draw danmaku fully opaque, ignoring Youku's 不透明度 slider
    // and the dimmer, random opacity Youku gives vertical danmaku.
    // false: leave opacity to Youku and only change the colour.
    var FORCE_OPAQUE = true;

    // true: recolour the white like-heart icon to the danmaku colour too.
    var TINT_LIKE_ICON = true;

    var STORAGE_KEY = 'danmakuColor';
    var STYLE_ID = '__TM_YOUKU_DANMAKU_COLOR_STYLE__';
    var SVG_ID = '__TM_YOUKU_DANMAKU_COLOR_SVG__';
    var FILTER_ID = 'tm-youku-danmaku-color-tint';
    var TAG = '[YoukuDanmakuColor]';

    function isValidColor(value) {
        if (typeof value !== 'string' || !value.trim()) return false;
        try {
            return CSS.supports('color', value.trim());
        } catch (e) {
            return false;
        }
    }

    function currentColor() {
        var saved = '';
        try { saved = GM_getValue(STORAGE_KEY, ''); } catch (e) {}
        if (isValidColor(saved)) return saved.trim();
        if (isValidColor(DEFAULT_COLOR)) return DEFAULT_COLOR.trim();
        console.warn(TAG, 'DEFAULT_COLOR is not a valid CSS colour, using #ffdd00:', DEFAULT_COLOR);
        return '#ffdd00';
    }

    // Any CSS colour -> [r, g, b] in 0..255 (alpha ignored).
    function toRgb(color) {
        var ctx = document.createElement('canvas').getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillStyle = color;
        var v = String(ctx.fillStyle);
        var m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
        m = v.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
        if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
        return [255, 221, 0];
    }

    function buildCss(color) {
        var o = OUTLINE_COLOR;
        var outline = [
            o + ' 1px 0 1px',
            o + ' -1px 0 1px',
            o + ' 0 1px 1px',
            o + ' 0 -1px 1px'
        ].join(', ');
        var word = '.barrage-word [class*="word-span"]';
        var css = [
            // Text: plain danmaku, coloured danmaku, like count.
            word + ', ' + word + ' :not(img) {',
            '  color: ' + color + ' !important;',
            '  -webkit-text-fill-color: ' + color + ' !important;',
            '}',
            word + ' {',
            '  text-shadow: ' + outline + ' !important;',
            // Only shows on your own danmaku, which Youku outlines.
            '  border-color: ' + color + ' !important;',
            '}',
            // Colourful (gradient) danmaku paint text with a clipped
            // background; drop it so the solid colour shows.
            word + ' span {',
            '  background: none !important;',
            '  -webkit-background-clip: border-box !important;',
            '  background-clip: border-box !important;',
            '}'
        ];
        if (FORCE_OPAQUE) {
            css.push(
                '.barrage-container[class*="youku-barrage"], .barrage-word, ' + word + ' {',
                '  opacity: 1 !important;',
                '}'
            );
        }
        if (TINT_LIKE_ICON) {
            css.push(
                word + ' img.vote-icon {',
                '  filter: url(#' + FILTER_ID + ') !important;',
                '}'
            );
        }
        return css.join('\n');
    }

    function ensureStyle(color) {
        var style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
        }
        var css = buildCss(color);
        if (style.textContent !== css) style.textContent = css;
        // At document-start <html> may not exist yet; apply() runs again
        // once it does.
        var root = document.head || document.documentElement;
        if (!style.isConnected && root) root.appendChild(style);
    }

    // The like heart is a white image with a black outline. Multiplying
    // each channel by the target colour turns white into exactly that
    // colour and keeps black black. Done with an SVG filter because a
    // CSS-only filter chain cannot hit an arbitrary colour exactly.
    function ensureTintFilter(color) {
        if (!TINT_LIKE_ICON || !document.body) return;
        var rgb = toRgb(color).map(function (n) { return (n / 255).toFixed(4); });
        var values = [
            rgb[0], 0, 0, 0, 0,
            0, rgb[1], 0, 0, 0,
            0, 0, rgb[2], 0, 0,
            0, 0, 0, 1, 0
        ].join(' ');
        var svg = document.getElementById(SVG_ID);
        if (!svg) {
            var ns = 'http://www.w3.org/2000/svg';
            svg = document.createElementNS(ns, 'svg');
            svg.id = SVG_ID;
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('width', '0');
            svg.setAttribute('height', '0');
            // Not display:none, which disables the filter in some browsers.
            svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
            var filter = document.createElementNS(ns, 'filter');
            filter.id = FILTER_ID;
            filter.setAttribute('color-interpolation-filters', 'sRGB');
            var matrix = document.createElementNS(ns, 'feColorMatrix');
            matrix.setAttribute('type', 'matrix');
            filter.appendChild(matrix);
            svg.appendChild(filter);
        }
        var fe = svg.querySelector('feColorMatrix');
        if (fe.getAttribute('values') !== values) fe.setAttribute('values', values);
        if (!svg.isConnected) document.body.appendChild(svg);
    }

    function apply() {
        var color = currentColor();
        ensureStyle(color);
        ensureTintFilter(color);
        return color;
    }

    function setColorFromMenu() {
        var now = currentColor();
        var input = window.prompt(
            '弹幕颜色（任意 CSS 颜色，如 #ffdd00、#00e5ff、#ff4d4f、white）：\n' +
            'Danmaku colour (any CSS colour):',
            now
        );
        if (input === null) return;
        input = input.trim();
        if (!isValidColor(input)) {
            window.alert('不是有效的颜色值 / Not a valid colour: ' + input);
            return;
        }
        GM_setValue(STORAGE_KEY, input);
        console.log(TAG, 'colour set to', apply());
    }

    function resetColorFromMenu() {
        GM_deleteValue(STORAGE_KEY);
        console.log(TAG, 'colour reset to', apply());
    }

    apply();
    if (!document.documentElement) {
        var rootWatcher = new MutationObserver(function () {
            if (!document.documentElement) return;
            rootWatcher.disconnect();
            apply();
        });
        rootWatcher.observe(document, { childList: true });
    }
    document.addEventListener('DOMContentLoaded', apply);
    window.addEventListener('load', apply);

    try {
        GM_registerMenuCommand('设置弹幕颜色… / Set danmaku colour…', setColorFromMenu);
        GM_registerMenuCommand('恢复默认弹幕颜色 / Reset to ' + DEFAULT_COLOR, resetColorFromMenu);
    } catch (e) {}

    console.log(TAG, 'danmaku colour:', currentColor());
})();
