// ==UserScript==
// @name         RingCentral Dopamine & Macaron Themes
// @name:zh-CN   RingCentral 多巴胺与马卡龙主题
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.1.0
// @description  Add Dopamine, Macaron, Strawberry, Lemon, Tangerine and Mint palettes to RingCentral Web, with native-looking choices on Settings > Themes.
// @description:zh-CN  为 RingCentral Web 增加多巴胺、马卡龙、草莓、柠檬、橘子、薄荷等自定义主题，并在“设置 > 主题”中加入原生风格的选择卡片。
// @author       Anna-SAP
// @match        https://app.ringcentral.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ringcentral.com
// @run-at       document-start
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-custom-themes.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/ringcentral-custom-themes.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.1.0';
    const STORAGE_KEY = 'tm-rc-custom-theme-v1';
    const ROOT_ATTRIBUTE = 'data-tm-rc-theme';
    const STYLE_ID = '__TM_RC_CUSTOM_THEME_STYLE__';
    const PANEL_ID = '__TM_RC_CUSTOM_THEME_PANEL__';
    const VALUE_ATTRIBUTE = 'data-tm-rc-custom-value';
    const THEME_ROUTE_RE = /\/settings\/theme(?:\/|$)/;
    const CUSTOM_THEMES = ['dopamine', 'macaron', 'strawberry', 'lemon', 'tangerine', 'mint'];
    const VALID_THEMES = new Set(CUSTOM_THEMES);

    const THEME_META = {
        dopamine: {
            label: 'Dopamine',
            description: '高饱和 · 明亮鲜艳',
            badge: 'Vivid',
        },
        macaron: {
            label: 'Macaron',
            description: '低饱和 · 柔和粉彩',
            badge: 'Pastel',
        },
        strawberry: {
            label: 'Strawberry',
            description: '草莓牛奶 · 甜心粉',
            badge: 'Sweet',
        },
        lemon: {
            label: 'Lemon',
            description: '柠檬苏打 · 元气黄',
            badge: 'Zesty',
        },
        tangerine: {
            label: 'Tangerine',
            description: '橘子汽水 · 活力橙',
            badge: 'Juicy',
        },
        mint: {
            label: 'Mint',
            description: '薄荷青柠 · 清新绿',
            badge: 'Fresh',
        },
        default: {
            label: 'RingCentral',
            description: '恢复当前官方主题',
            badge: 'Default',
        },
    };

    function normalizeTheme(value) {
        return VALID_THEMES.has(value) ? value : null;
    }

    function readStoredTheme() {
        try {
            return normalizeTheme(localStorage.getItem(STORAGE_KEY));
        } catch (error) {
            return null;
        }
    }

    let currentTheme = readStoredTheme();

    function applyRootAttribute() {
        const root = document.documentElement;
        if (!root) return;

        if (currentTheme) {
            root.setAttribute(ROOT_ATTRIBUTE, currentTheme);
        } else {
            root.removeAttribute(ROOT_ATTRIBUTE);
        }
    }

    // Apply the saved palette before React paints whenever possible, reducing
    // the white/blue flash that would otherwise occur during app startup.
    applyRootAttribute();

    const CSS = `
/* ================================================================
   Palette tokens
   ================================================================ */
html[${ROOT_ATTRIBUTE}="dopamine"],
html[${ROOT_ATTRIBUTE}="dopamine"] body.spring-ui-jupiter {
    --tm-rc-primary: #6d28d9;
    --tm-rc-primary-rgb: 109, 40, 217;
    --tm-rc-primary-strong: #4c1d95;
    --tm-rc-primary-strong-rgb: 76, 29, 149;
    --tm-rc-accent: #f72585;
    --tm-rc-accent-rgb: 247, 37, 133;
    --tm-rc-accent-two: #00aeea;
    --tm-rc-bg: #fff7fd;
    --tm-rc-bg-rgb: 255, 247, 253;
    --tm-rc-surface: #ffffff;
    --tm-rc-surface-rgb: 255, 255, 255;
    --tm-rc-surface-soft: #f9eeff;
    --tm-rc-sidebar: #f3e8ff;
    --tm-rc-text: #2d123f;
    --tm-rc-text-rgb: 45, 18, 63;
    --tm-rc-text-two: #54335f;
    --tm-rc-text-two-rgb: 84, 51, 95;
    --tm-rc-muted: #7b6484;
    --tm-rc-muted-rgb: 123, 100, 132;
    --tm-rc-disabled-rgb: 185, 159, 194;
    --tm-rc-border: #ead1f4;
    --tm-rc-border-rgb: 234, 209, 244;
    --tm-rc-on-primary: #ffffff;
    --tm-rc-on-primary-rgb: 255, 255, 255;
    --tm-rc-header: linear-gradient(110deg, #5b21b6 0%, #d61f69 54%, #e85d04 100%);
    --tm-rc-on-header: #ffffff;
    --tm-rc-selected: rgba(109, 40, 217, 0.13);
    --tm-rc-hover: rgba(247, 37, 133, 0.10);
    --tm-rc-shadow: 0 10px 30px rgba(109, 40, 217, 0.18);
    --tm-rc-success: #008f5d;
    --tm-rc-success-rgb: 0, 143, 93;
    --tm-rc-danger: #d91e4d;
    --tm-rc-danger-rgb: 217, 30, 77;
    --tm-rc-warning: #d95000;
    --tm-rc-warning-rgb: 217, 80, 0;
    --tm-rc-ai: #e85d04;
    --tm-rc-ai-rgb: 232, 93, 4;
}

html[${ROOT_ATTRIBUTE}="macaron"],
html[${ROOT_ATTRIBUTE}="macaron"] body.spring-ui-jupiter {
    --tm-rc-primary: #715c99;
    --tm-rc-primary-rgb: 113, 92, 153;
    --tm-rc-primary-strong: #52426f;
    --tm-rc-primary-strong-rgb: 82, 66, 111;
    --tm-rc-accent: #c9879e;
    --tm-rc-accent-rgb: 201, 135, 158;
    --tm-rc-accent-two: #70aab2;
    --tm-rc-bg: #fffafb;
    --tm-rc-bg-rgb: 255, 250, 251;
    --tm-rc-surface: #fffefe;
    --tm-rc-surface-rgb: 255, 254, 254;
    --tm-rc-surface-soft: #f6f0f8;
    --tm-rc-sidebar: #f2edf8;
    --tm-rc-text: #453e4d;
    --tm-rc-text-rgb: 69, 62, 77;
    --tm-rc-text-two: #61586a;
    --tm-rc-text-two-rgb: 97, 88, 106;
    --tm-rc-muted: #7f7587;
    --tm-rc-muted-rgb: 127, 117, 135;
    --tm-rc-disabled-rgb: 181, 170, 186;
    --tm-rc-border: #ded5e4;
    --tm-rc-border-rgb: 222, 213, 228;
    --tm-rc-on-primary: #ffffff;
    --tm-rc-on-primary-rgb: 255, 255, 255;
    --tm-rc-header: linear-gradient(110deg, #e4d7f3 0%, #f0d4de 52%, #d2e9e9 100%);
    --tm-rc-on-header: #403649;
    --tm-rc-selected: rgba(113, 92, 153, 0.13);
    --tm-rc-hover: rgba(201, 135, 158, 0.13);
    --tm-rc-shadow: 0 10px 28px rgba(82, 66, 111, 0.13);
    --tm-rc-success: #5c876e;
    --tm-rc-success-rgb: 92, 135, 110;
    --tm-rc-danger: #a85b70;
    --tm-rc-danger-rgb: 168, 91, 112;
    --tm-rc-warning: #a66f49;
    --tm-rc-warning-rgb: 166, 111, 73;
    --tm-rc-ai: #a66f49;
    --tm-rc-ai-rgb: 166, 111, 73;
}

/* Cute fruit palettes. The header layers a few soft "soda bubbles" over the
   gradient; they sit between the search box and the action buttons. */
html[${ROOT_ATTRIBUTE}="strawberry"],
html[${ROOT_ATTRIBUTE}="strawberry"] body.spring-ui-jupiter {
    --tm-rc-primary: #d6336c;
    --tm-rc-primary-rgb: 214, 51, 108;
    --tm-rc-primary-strong: #a61e4d;
    --tm-rc-primary-strong-rgb: 166, 30, 77;
    --tm-rc-accent: #ff6b9d;
    --tm-rc-accent-rgb: 255, 107, 157;
    --tm-rc-accent-two: #ffb3c9;
    --tm-rc-bg: #fff6f9;
    --tm-rc-bg-rgb: 255, 246, 249;
    --tm-rc-surface: #ffffff;
    --tm-rc-surface-rgb: 255, 255, 255;
    --tm-rc-surface-soft: #ffeef4;
    --tm-rc-sidebar: #ffe6ef;
    --tm-rc-text: #3d1a28;
    --tm-rc-text-rgb: 61, 26, 40;
    --tm-rc-text-two: #5e3244;
    --tm-rc-text-two-rgb: 94, 50, 68;
    --tm-rc-muted: #8a6475;
    --tm-rc-muted-rgb: 138, 100, 117;
    --tm-rc-disabled-rgb: 204, 166, 182;
    --tm-rc-border: #f7d3e0;
    --tm-rc-border-rgb: 247, 211, 224;
    --tm-rc-on-primary: #ffffff;
    --tm-rc-on-primary-rgb: 255, 255, 255;
    --tm-rc-header:
        radial-gradient(circle at 58% 30%, rgba(255, 255, 255, 0.30) 0 7px, transparent 8px),
        radial-gradient(circle at 66% 72%, rgba(255, 255, 255, 0.22) 0 11px, transparent 12px),
        radial-gradient(circle at 79% 38%, rgba(255, 255, 255, 0.26) 0 5px, transparent 6px),
        linear-gradient(110deg, #f0457f 0%, #ff6b9d 55%, #ff85ad 100%);
    --tm-rc-on-header: #ffffff;
    --tm-rc-selected: rgba(214, 51, 108, 0.12);
    --tm-rc-hover: rgba(255, 107, 157, 0.10);
    --tm-rc-shadow: 0 10px 30px rgba(214, 51, 108, 0.16);
    --tm-rc-success: #1f8f5f;
    --tm-rc-success-rgb: 31, 143, 95;
    --tm-rc-danger: #c9283e;
    --tm-rc-danger-rgb: 201, 40, 62;
    --tm-rc-warning: #c75a00;
    --tm-rc-warning-rgb: 199, 90, 0;
    --tm-rc-ai: #d6336c;
    --tm-rc-ai-rgb: 214, 51, 108;
}

html[${ROOT_ATTRIBUTE}="lemon"],
html[${ROOT_ATTRIBUTE}="lemon"] body.spring-ui-jupiter {
    --tm-rc-primary: #a66a00;
    --tm-rc-primary-rgb: 166, 106, 0;
    --tm-rc-primary-strong: #7a4d00;
    --tm-rc-primary-strong-rgb: 122, 77, 0;
    --tm-rc-accent: #ffcc29;
    --tm-rc-accent-rgb: 255, 204, 41;
    --tm-rc-accent-two: #7cc576;
    --tm-rc-bg: #fffcef;
    --tm-rc-bg-rgb: 255, 252, 239;
    --tm-rc-surface: #ffffff;
    --tm-rc-surface-rgb: 255, 255, 255;
    --tm-rc-surface-soft: #fff7d6;
    --tm-rc-sidebar: #fff3c4;
    --tm-rc-text: #3b3214;
    --tm-rc-text-rgb: 59, 50, 20;
    --tm-rc-text-two: #5c4f24;
    --tm-rc-text-two-rgb: 92, 79, 36;
    --tm-rc-muted: #867a52;
    --tm-rc-muted-rgb: 134, 122, 82;
    --tm-rc-disabled-rgb: 196, 186, 148;
    --tm-rc-border: #f3e3a6;
    --tm-rc-border-rgb: 243, 227, 166;
    --tm-rc-on-primary: #ffffff;
    --tm-rc-on-primary-rgb: 255, 255, 255;
    --tm-rc-header:
        radial-gradient(circle at 58% 30%, rgba(255, 255, 255, 0.45) 0 7px, transparent 8px),
        radial-gradient(circle at 66% 72%, rgba(255, 255, 255, 0.34) 0 11px, transparent 12px),
        radial-gradient(circle at 79% 38%, rgba(255, 255, 255, 0.40) 0 5px, transparent 6px),
        linear-gradient(110deg, #ffcc29 0%, #ffd84f 55%, #ffe37a 100%);
    --tm-rc-on-header: #3f3000;
    --tm-rc-selected: rgba(166, 106, 0, 0.12);
    --tm-rc-hover: rgba(255, 204, 41, 0.18);
    --tm-rc-shadow: 0 10px 28px rgba(166, 106, 0, 0.14);
    --tm-rc-success: #3f8f3a;
    --tm-rc-success-rgb: 63, 143, 58;
    --tm-rc-danger: #c9372c;
    --tm-rc-danger-rgb: 201, 55, 44;
    --tm-rc-warning: #b55d00;
    --tm-rc-warning-rgb: 181, 93, 0;
    --tm-rc-ai: #b55d00;
    --tm-rc-ai-rgb: 181, 93, 0;
}

html[${ROOT_ATTRIBUTE}="tangerine"],
html[${ROOT_ATTRIBUTE}="tangerine"] body.spring-ui-jupiter {
    --tm-rc-primary: #c94f08;
    --tm-rc-primary-rgb: 201, 79, 8;
    --tm-rc-primary-strong: #9a3a04;
    --tm-rc-primary-strong-rgb: 154, 58, 4;
    --tm-rc-accent: #ff8a2b;
    --tm-rc-accent-rgb: 255, 138, 43;
    --tm-rc-accent-two: #ffc445;
    --tm-rc-bg: #fff8f2;
    --tm-rc-bg-rgb: 255, 248, 242;
    --tm-rc-surface: #ffffff;
    --tm-rc-surface-rgb: 255, 255, 255;
    --tm-rc-surface-soft: #fff0e3;
    --tm-rc-sidebar: #ffe9d6;
    --tm-rc-text: #3d220f;
    --tm-rc-text-rgb: 61, 34, 15;
    --tm-rc-text-two: #5e3a22;
    --tm-rc-text-two-rgb: 94, 58, 34;
    --tm-rc-muted: #8a6a55;
    --tm-rc-muted-rgb: 138, 106, 85;
    --tm-rc-disabled-rgb: 204, 178, 160;
    --tm-rc-border: #f7dcc6;
    --tm-rc-border-rgb: 247, 220, 198;
    --tm-rc-on-primary: #ffffff;
    --tm-rc-on-primary-rgb: 255, 255, 255;
    --tm-rc-header:
        radial-gradient(circle at 58% 30%, rgba(255, 255, 255, 0.30) 0 7px, transparent 8px),
        radial-gradient(circle at 66% 72%, rgba(255, 255, 255, 0.22) 0 11px, transparent 12px),
        radial-gradient(circle at 79% 38%, rgba(255, 255, 255, 0.26) 0 5px, transparent 6px),
        linear-gradient(110deg, #f06a0c 0%, #ff8a2b 55%, #ff9f45 100%);
    --tm-rc-on-header: #ffffff;
    --tm-rc-selected: rgba(201, 79, 8, 0.12);
    --tm-rc-hover: rgba(255, 138, 43, 0.12);
    --tm-rc-shadow: 0 10px 30px rgba(201, 79, 8, 0.16);
    --tm-rc-success: #2f8a4f;
    --tm-rc-success-rgb: 47, 138, 79;
    --tm-rc-danger: #cc2f3b;
    --tm-rc-danger-rgb: 204, 47, 59;
    --tm-rc-warning: #b35300;
    --tm-rc-warning-rgb: 179, 83, 0;
    --tm-rc-ai: #c94f08;
    --tm-rc-ai-rgb: 201, 79, 8;
}

html[${ROOT_ATTRIBUTE}="mint"],
html[${ROOT_ATTRIBUTE}="mint"] body.spring-ui-jupiter {
    --tm-rc-primary: #16895a;
    --tm-rc-primary-rgb: 22, 137, 90;
    --tm-rc-primary-strong: #0f6443;
    --tm-rc-primary-strong-rgb: 15, 100, 67;
    --tm-rc-accent: #3cc07e;
    --tm-rc-accent-rgb: 60, 192, 126;
    --tm-rc-accent-two: #ffd84f;
    --tm-rc-bg: #f4fbf7;
    --tm-rc-bg-rgb: 244, 251, 247;
    --tm-rc-surface: #ffffff;
    --tm-rc-surface-rgb: 255, 255, 255;
    --tm-rc-surface-soft: #e8f7ef;
    --tm-rc-sidebar: #def3e7;
    --tm-rc-text: #14301f;
    --tm-rc-text-rgb: 20, 48, 31;
    --tm-rc-text-two: #2f4d3b;
    --tm-rc-text-two-rgb: 47, 77, 59;
    --tm-rc-muted: #5f7a6a;
    --tm-rc-muted-rgb: 95, 122, 106;
    --tm-rc-disabled-rgb: 160, 186, 171;
    --tm-rc-border: #cde9d9;
    --tm-rc-border-rgb: 205, 233, 217;
    --tm-rc-on-primary: #ffffff;
    --tm-rc-on-primary-rgb: 255, 255, 255;
    --tm-rc-header:
        radial-gradient(circle at 58% 30%, rgba(255, 255, 255, 0.26) 0 7px, transparent 8px),
        radial-gradient(circle at 66% 72%, rgba(255, 255, 255, 0.18) 0 11px, transparent 12px),
        radial-gradient(circle at 79% 38%, rgba(255, 255, 255, 0.22) 0 5px, transparent 6px),
        linear-gradient(110deg, #13985a 0%, #26b06d 55%, #45c283 100%);
    --tm-rc-on-header: #ffffff;
    --tm-rc-selected: rgba(22, 137, 90, 0.12);
    --tm-rc-hover: rgba(60, 192, 126, 0.12);
    --tm-rc-shadow: 0 10px 30px rgba(22, 137, 90, 0.16);
    --tm-rc-success: #1d7f4e;
    --tm-rc-success-rgb: 29, 127, 78;
    --tm-rc-danger: #cc3340;
    --tm-rc-danger-rgb: 204, 51, 64;
    --tm-rc-warning: #b86200;
    --tm-rc-warning-rgb: 184, 98, 0;
    --tm-rc-ai: #b86200;
    --tm-rc-ai-rgb: 184, 98, 0;
}

/* RingCentral Spring/Jupiter tokens. Both the RGB-triplet legacy tokens and
   rgba() SUI tokens are covered because different app modules use each set. */
html[${ROOT_ATTRIBUTE}],
html[${ROOT_ATTRIBUTE}] body.spring-ui-jupiter {
    color-scheme: light !important;

    --s-primary-b: var(--tm-rc-primary-rgb) !important;
    --s-primary-f: var(--tm-rc-primary-rgb) !important;
    --s-primary-b-high-contrast: var(--tm-rc-primary-strong-rgb) !important;
    --s-primary-f-high-contrast: var(--tm-rc-primary-strong-rgb) !important;
    --s-cobranding: var(--tm-rc-primary-rgb) !important;
    --s-cobranding-f: var(--tm-rc-primary-rgb) !important;
    --s-cobranding-accent: var(--tm-rc-primary-rgb) !important;
    --s-cobranding-high-contrast: var(--tm-rc-primary-strong-rgb) !important;
    --s-cobranding-on-base: var(--tm-rc-primary-rgb) !important;
    --s-cobranding-on-base-high-contrast: var(--tm-rc-primary-strong-rgb) !important;
    --s-cobranding-on-accent: var(--tm-rc-on-primary-rgb) !important;

    --s-neutral-base: var(--tm-rc-bg-rgb) !important;
    --s-neutral-w0: var(--tm-rc-surface-rgb) !important;
    --s-neutral-b0: var(--tm-rc-text-rgb) !important;
    --s-neutral-b1: var(--tm-rc-text-two-rgb) !important;
    --s-neutral-b2: var(--tm-rc-muted-rgb) !important;
    --s-neutral-b3: var(--tm-rc-disabled-rgb) !important;
    --s-neutral-b4: var(--tm-rc-border-rgb) !important;
    --s-neutral-b5: var(--tm-rc-bg-rgb) !important;

    --sui-colors-primary-b: rgba(var(--tm-rc-primary-rgb), 1) !important;
    --sui-colors-primary-f: rgba(var(--tm-rc-primary-rgb), 1) !important;
    --sui-colors-primary-b-high-contrast: rgba(var(--tm-rc-primary-strong-rgb), 1) !important;
    --sui-colors-primary-f-high-contrast: rgba(var(--tm-rc-primary-strong-rgb), 1) !important;
    --sui-colors-primary-b-t20: rgba(var(--tm-rc-primary-rgb), 0.20) !important;
    --sui-colors-primary-f-t20: rgba(var(--tm-rc-primary-rgb), 0.20) !important;
    --sui-colors-primary-t0: rgba(var(--tm-rc-primary-rgb), 0) !important;
    --sui-colors-primary-t10: rgba(var(--tm-rc-primary-rgb), 0.10) !important;
    --sui-colors-primary-t80: rgba(var(--tm-rc-primary-rgb), 0.20) !important;

    --sui-colors-cobranding: rgba(var(--tm-rc-primary-rgb), 1) !important;
    --sui-colors-cobranding-f: rgba(var(--tm-rc-primary-rgb), 1) !important;
    --sui-colors-cobranding-accent: rgba(var(--tm-rc-primary-rgb), 1) !important;
    --sui-colors-cobranding-high-contrast: rgba(var(--tm-rc-primary-strong-rgb), 1) !important;
    --sui-colors-cobranding-on-base: rgba(var(--tm-rc-primary-rgb), 1) !important;
    --sui-colors-cobranding-on-base-high-contrast: rgba(var(--tm-rc-primary-strong-rgb), 1) !important;
    --sui-colors-cobranding-on-accent: rgba(var(--tm-rc-on-primary-rgb), 1) !important;
    --sui-colors-cobranding-on-accent-t10: rgba(var(--tm-rc-on-primary-rgb), 0.10) !important;
    --sui-colors-cobranding-on-accent-t20: rgba(var(--tm-rc-on-primary-rgb), 0.20) !important;
    --sui-colors-cobranding-on-accent-t50: rgba(var(--tm-rc-on-primary-rgb), 0.50) !important;
    --sui-colors-cobranding-t0: rgba(var(--tm-rc-primary-rgb), 0) !important;
    --sui-colors-cobranding-t10: rgba(var(--tm-rc-primary-rgb), 0.10) !important;
    --sui-colors-cobranding-t20: rgba(var(--tm-rc-primary-rgb), 0.20) !important;
    --sui-colors-cobranding-t80: rgba(var(--tm-rc-primary-rgb), 0.20) !important;

    --sui-colors-neutral-base: rgba(var(--tm-rc-bg-rgb), 1) !important;
    --sui-colors-neutral-w0: rgba(var(--tm-rc-surface-rgb), 1) !important;
    --sui-colors-neutral-w0-t0: rgba(var(--tm-rc-surface-rgb), 0) !important;
    --sui-colors-neutral-w0-t10: rgba(var(--tm-rc-surface-rgb), 0.10) !important;
    --sui-colors-neutral-w0-t20: rgba(var(--tm-rc-surface-rgb), 0.20) !important;
    --sui-colors-neutral-w0-t80: rgba(var(--tm-rc-surface-rgb), 0.80) !important;
    --sui-colors-neutral-b0: rgba(var(--tm-rc-text-rgb), 1) !important;
    --sui-colors-neutral-b0-t0: rgba(var(--tm-rc-text-rgb), 0) !important;
    --sui-colors-neutral-b0-t10: rgba(var(--tm-rc-text-rgb), 0.10) !important;
    --sui-colors-neutral-b0-t20: rgba(var(--tm-rc-text-rgb), 0.20) !important;
    --sui-colors-neutral-b0-t30: rgba(var(--tm-rc-text-rgb), 0.30) !important;
    --sui-colors-neutral-b0-t50: rgba(var(--tm-rc-text-rgb), 0.50) !important;
    --sui-colors-neutral-b1: rgba(var(--tm-rc-text-two-rgb), 1) !important;
    --sui-colors-neutral-b2: rgba(var(--tm-rc-muted-rgb), 1) !important;
    --sui-colors-neutral-b3: rgba(var(--tm-rc-disabled-rgb), 1) !important;
    --sui-colors-neutral-b4: rgba(var(--tm-rc-border-rgb), 1) !important;
    --sui-colors-neutral-b4-t50: rgba(var(--tm-rc-border-rgb), 0.50) !important;
    --sui-colors-neutral-b5: rgba(var(--tm-rc-bg-rgb), 1) !important;
    --sui-colors-neutral-b5-t90: rgba(var(--tm-rc-bg-rgb), 0.90) !important;
    --sui-colors-juno-migration: var(--tm-rc-surface-soft) !important;

    --sui-colors-success: rgba(var(--tm-rc-success-rgb), 1) !important;
    --sui-colors-success-f: rgba(var(--tm-rc-success-rgb), 1) !important;
    --sui-colors-success-t10: rgba(var(--tm-rc-success-rgb), 0.10) !important;
    --sui-colors-success-t20: rgba(var(--tm-rc-success-rgb), 0.20) !important;
    --sui-colors-danger: rgba(var(--tm-rc-danger-rgb), 1) !important;
    --sui-colors-danger-f: rgba(var(--tm-rc-danger-rgb), 1) !important;
    --sui-colors-danger-t10: rgba(var(--tm-rc-danger-rgb), 0.10) !important;
    --sui-colors-danger-t20: rgba(var(--tm-rc-danger-rgb), 0.20) !important;
    --sui-colors-warning: rgba(var(--tm-rc-warning-rgb), 1) !important;
    --sui-colors-warning-f: rgba(var(--tm-rc-warning-rgb), 1) !important;
    --sui-colors-warning-t10: rgba(var(--tm-rc-warning-rgb), 0.10) !important;
    --sui-colors-warning-t20: rgba(var(--tm-rc-warning-rgb), 0.20) !important;
    --sui-colors-ai: rgba(var(--tm-rc-ai-rgb), 1) !important;
    --sui-colors-ai-t10: rgba(var(--tm-rc-ai-rgb), 0.10) !important;
    --sui-colors-ai-t20: rgba(var(--tm-rc-ai-rgb), 0.20) !important;

    --sui-colors-extra-amethyst: var(--tm-rc-primary) !important;
    --sui-colors-extra-wildberry: var(--tm-rc-accent) !important;
    --sui-colors-extra-denim: var(--tm-rc-accent-two) !important;
    --sui-focus-ring-normal-color: var(--tm-rc-primary-strong) !important;
    --sui-focus-ring-tight-color: var(--tm-rc-primary-strong) !important;
    --sui-focus-ring-inset-color: var(--tm-rc-primary-strong) !important;
    --sui-box-shadow-xs-primary: 0 2px 5px rgba(var(--tm-rc-primary-rgb), 0.20) !important;
    --sui-box-shadow-sm-primary: var(--tm-rc-shadow) !important;
    --tw-ring-color: rgba(var(--tm-rc-primary-rgb), 0.35) !important;
}

/* Stable shell selectors cover the few legacy areas that still use literal
   colors instead of Spring/Jupiter variables. */
html[${ROOT_ATTRIBUTE}] body.spring-ui-jupiter,
html[${ROOT_ATTRIBUTE}] #root,
html[${ROOT_ATTRIBUTE}] #home-wrapper {
    background-color: var(--tm-rc-bg) !important;
    color: var(--tm-rc-text);
}

html[${ROOT_ATTRIBUTE}] #app-top-bar {
    background: var(--tm-rc-header) !important;
    color: var(--tm-rc-on-header) !important;
    box-shadow: 0 1px 0 rgba(var(--tm-rc-primary-strong-rgb), 0.18) !important;
}

html[${ROOT_ATTRIBUTE}] #app-top-bar button,
html[${ROOT_ATTRIBUTE}] #app-top-bar [role="button"],
html[${ROOT_ATTRIBUTE}] #app-top-bar a {
    color: var(--tm-rc-on-header) !important;
}

html[${ROOT_ATTRIBUTE}] #app-top-bar :where(p, span, div):not([data-test-automation-class="avatar"] *) {
    color: var(--tm-rc-on-header) !important;
}

html[${ROOT_ATTRIBUTE}] #app-top-bar svg {
    color: inherit !important;
    fill: currentColor;
}

/* Contained icon buttons (Dialpad, New actions) keep RingCentral's light
   circular surface, so on-header ink would vanish on a dark header palette.
   Ink them against their own surface instead of the header. */
html[${ROOT_ATTRIBUTE}] #app-top-bar .RcIconButton-contained,
html[${ROOT_ATTRIBUTE}] #app-top-bar .RcIconButton-contained :where(p, span, div) {
    color: var(--tm-rc-primary-strong) !important;
}

html[${ROOT_ATTRIBUTE}] #nav-bar > .MuiDrawer-paper {
    background-color: var(--tm-rc-sidebar) !important;
    border-color: var(--tm-rc-border) !important;
}

html[${ROOT_ATTRIBUTE}] #nav-bar [aria-selected="true"],
html[${ROOT_ATTRIBUTE}] #nav-bar [data-selected="true"],
html[${ROOT_ATTRIBUTE}] #nav-bar [aria-current="page"] {
    background-color: var(--tm-rc-selected) !important;
    color: var(--tm-rc-primary-strong) !important;
}

html[${ROOT_ATTRIBUTE}] [data-test-automation-id="settingPage-theme"] {
    background-color: var(--tm-rc-bg) !important;
}

html[${ROOT_ATTRIBUTE}] [data-test-automation-id="settingPage-theme"] .MuiCard-root,
html[${ROOT_ATTRIBUTE}] .MuiDialog-paper,
html[${ROOT_ATTRIBUTE}] .MuiMenu-paper,
html[${ROOT_ATTRIBUTE}] .MuiPopover-paper {
    background-color: var(--tm-rc-surface) !important;
    border-color: var(--tm-rc-border) !important;
    box-shadow: var(--tm-rc-shadow) !important;
}

html[${ROOT_ATTRIBUTE}] input,
html[${ROOT_ATTRIBUTE}] textarea,
html[${ROOT_ATTRIBUTE}] select {
    accent-color: var(--tm-rc-primary);
}

html[${ROOT_ATTRIBUTE}] ::selection {
    color: var(--tm-rc-text);
    background: rgba(var(--tm-rc-accent-rgb), 0.22);
}

html[${ROOT_ATTRIBUTE}] * {
    scrollbar-color: var(--tm-rc-primary) var(--tm-rc-surface-soft);
}

/* ================================================================
   Settings > Themes extension
   ================================================================ */
#${PANEL_ID} {
    box-sizing: border-box;
    flex: 1 0 100%;
    width: 100%;
    min-width: 0;
    padding-top: 18px;
    color: var(--sui-colors-neutral-b0, #16181d);
    font-family: Lato, Helvetica, Arial, sans-serif;
}

#${PANEL_ID},
#${PANEL_ID} * {
    box-sizing: border-box;
}

#${PANEL_ID} .tm-rc-theme-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    min-height: 24px;
    margin-bottom: 8px;
}

#${PANEL_ID} .tm-rc-theme-title {
    font-size: 15px;
    font-weight: 700;
    line-height: 20px;
}

#${PANEL_ID} .tm-rc-theme-status {
    overflow: hidden;
    color: var(--sui-colors-neutral-b2, #72757a);
    font-size: 12px;
    line-height: 18px;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#${PANEL_ID} .tm-rc-theme-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
    width: 100%;
}

#${PANEL_ID} .tm-rc-theme-card {
    --tm-preview-primary: #2559e4;
    --tm-preview-accent: #65a8ff;
    --tm-preview-bg: #f5f6f9;
    --tm-preview-surface: #ffffff;
    --tm-preview-sidebar: #edf1fb;
    --tm-preview-text: #667085;
    --tm-preview-border: #d4d8e1;
    display: block;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 9px;
    outline: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

#${PANEL_ID} .tm-rc-theme-card[${VALUE_ATTRIBUTE}="dopamine"] {
    --tm-preview-primary: #6d28d9;
    --tm-preview-accent: #f72585;
    --tm-preview-accent-two: #ff8a00;
    --tm-preview-bg: #fff5fb;
    --tm-preview-surface: #ffffff;
    --tm-preview-sidebar: #f0e4ff;
    --tm-preview-text: #5a3766;
    --tm-preview-border: #e7c8f4;
}

#${PANEL_ID} .tm-rc-theme-card[${VALUE_ATTRIBUTE}="macaron"] {
    --tm-preview-primary: #826fa8;
    --tm-preview-accent: #d99caf;
    --tm-preview-accent-two: #8fc6ca;
    --tm-preview-bg: #fffafa;
    --tm-preview-surface: #fffefe;
    --tm-preview-sidebar: #eee8f6;
    --tm-preview-text: #74687b;
    --tm-preview-border: #ddd2e4;
}

#${PANEL_ID} .tm-rc-theme-card[${VALUE_ATTRIBUTE}="strawberry"] {
    --tm-preview-primary: #d6336c;
    --tm-preview-accent: #ff6b9d;
    --tm-preview-header: linear-gradient(100deg, #f0457f, #ff6b9d 55%, #ff85ad);
    --tm-preview-bg: #fff6f9;
    --tm-preview-surface: #ffffff;
    --tm-preview-sidebar: #ffe6ef;
    --tm-preview-text: #8a6475;
    --tm-preview-border: #f7d3e0;
}

#${PANEL_ID} .tm-rc-theme-card[${VALUE_ATTRIBUTE}="lemon"] {
    --tm-preview-primary: #a66a00;
    --tm-preview-accent: #ffcc29;
    --tm-preview-header: linear-gradient(100deg, #ffcc29, #ffd84f 55%, #ffe37a);
    --tm-preview-bg: #fffcef;
    --tm-preview-surface: #ffffff;
    --tm-preview-sidebar: #fff3c4;
    --tm-preview-text: #867a52;
    --tm-preview-border: #f3e3a6;
}

#${PANEL_ID} .tm-rc-theme-card[${VALUE_ATTRIBUTE}="tangerine"] {
    --tm-preview-primary: #c94f08;
    --tm-preview-accent: #ff8a2b;
    --tm-preview-header: linear-gradient(100deg, #f06a0c, #ff8a2b 55%, #ff9f45);
    --tm-preview-bg: #fff8f2;
    --tm-preview-surface: #ffffff;
    --tm-preview-sidebar: #ffe9d6;
    --tm-preview-text: #8a6a55;
    --tm-preview-border: #f7dcc6;
}

#${PANEL_ID} .tm-rc-theme-card[${VALUE_ATTRIBUTE}="mint"] {
    --tm-preview-primary: #16895a;
    --tm-preview-accent: #3cc07e;
    --tm-preview-header: linear-gradient(100deg, #13985a, #26b06d 55%, #45c283);
    --tm-preview-bg: #f4fbf7;
    --tm-preview-surface: #ffffff;
    --tm-preview-sidebar: #def3e7;
    --tm-preview-text: #5f7a6a;
    --tm-preview-border: #cde9d9;
}

#${PANEL_ID} .tm-rc-theme-preview {
    position: relative;
    display: block;
    aspect-ratio: 1.72 / 1;
    overflow: hidden;
    border: 2px solid transparent;
    border-radius: 7px;
    background: var(--tm-preview-bg);
    box-shadow: inset 0 0 0 1px var(--tm-preview-border);
    transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}

#${PANEL_ID} .tm-rc-theme-card:hover .tm-rc-theme-preview {
    transform: translateY(-1px);
    box-shadow: inset 0 0 0 1px var(--tm-preview-border), 0 5px 14px rgba(30, 24, 40, 0.12);
}

#${PANEL_ID} .tm-rc-theme-card:focus-visible .tm-rc-theme-preview {
    box-shadow: inset 0 0 0 1px var(--tm-preview-border), 0 0 0 3px rgba(37, 89, 228, 0.24);
}

#${PANEL_ID} .tm-rc-theme-card[aria-checked="true"] .tm-rc-theme-preview {
    border-color: var(--tm-preview-primary);
    box-shadow: 0 0 0 1px var(--tm-preview-primary), 0 5px 14px rgba(30, 24, 40, 0.12);
}

#${PANEL_ID} .tm-rc-preview-topbar {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    align-items: center;
    height: 14%;
    min-height: 13px;
    padding: 0 4%;
    background: var(--tm-preview-header, linear-gradient(100deg, var(--tm-preview-primary), var(--tm-preview-accent)));
}

#${PANEL_ID} .tm-rc-theme-card[${VALUE_ATTRIBUTE}="dopamine"] .tm-rc-preview-topbar,
#${PANEL_ID} .tm-rc-theme-card[${VALUE_ATTRIBUTE}="macaron"] .tm-rc-preview-topbar {
    background: linear-gradient(100deg, var(--tm-preview-primary), var(--tm-preview-accent) 62%, var(--tm-preview-accent-two));
}

#${PANEL_ID} .tm-rc-preview-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    margin-right: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.72);
}

#${PANEL_ID} .tm-rc-preview-search {
    width: 42%;
    height: 5px;
    margin-left: 3px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.42);
}

#${PANEL_ID} .tm-rc-preview-shell {
    position: absolute;
    inset: 14% 0 0;
    display: grid;
    grid-template-columns: 25% 1fr;
}

#${PANEL_ID} .tm-rc-preview-sidebar {
    display: flex;
    flex-direction: column;
    gap: 6%;
    padding: 11% 12%;
    background: var(--tm-preview-sidebar);
}

#${PANEL_ID} .tm-rc-preview-sidebar-line {
    display: block;
    width: 76%;
    height: 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--tm-preview-primary) 24%, transparent);
}

#${PANEL_ID} .tm-rc-preview-sidebar-line.is-active {
    width: 92%;
    background: var(--tm-preview-primary);
}

#${PANEL_ID} .tm-rc-preview-main {
    display: grid;
    grid-template-columns: 1fr 34%;
    gap: 6%;
    padding: 7% 6%;
    background: var(--tm-preview-surface);
}

#${PANEL_ID} .tm-rc-preview-copy,
#${PANEL_ID} .tm-rc-preview-aside {
    display: flex;
    flex-direction: column;
    gap: 9%;
}

#${PANEL_ID} .tm-rc-preview-line,
#${PANEL_ID} .tm-rc-preview-chip {
    display: block;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--tm-preview-text) 16%, transparent);
}

#${PANEL_ID} .tm-rc-preview-line.is-title {
    width: 62%;
    height: 8px;
    background: color-mix(in srgb, var(--tm-preview-text) 26%, transparent);
}

#${PANEL_ID} .tm-rc-preview-line.is-short {
    width: 72%;
}

#${PANEL_ID} .tm-rc-preview-chip {
    height: 21%;
    min-height: 11px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--tm-preview-accent) 24%, var(--tm-preview-surface));
}

#${PANEL_ID} .tm-rc-theme-label-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: start;
    gap: 6px;
    padding-top: 9px;
}

#${PANEL_ID} .tm-rc-theme-radio {
    position: relative;
    display: block;
    width: 20px;
    height: 20px;
    border: 2px solid var(--sui-colors-neutral-b3, #9e9fa4);
    border-radius: 50%;
    transition: border-color 120ms ease;
}

#${PANEL_ID} .tm-rc-theme-card[aria-checked="true"] .tm-rc-theme-radio {
    border-color: var(--tm-preview-primary);
}

#${PANEL_ID} .tm-rc-theme-card[aria-checked="true"] .tm-rc-theme-radio::after {
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--tm-preview-primary);
    content: '';
}

#${PANEL_ID} .tm-rc-theme-copy {
    display: block;
    min-width: 0;
}

#${PANEL_ID} .tm-rc-theme-name {
    display: block;
    overflow: hidden;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#${PANEL_ID} .tm-rc-theme-description {
    display: block;
    overflow: hidden;
    color: var(--sui-colors-neutral-b2, #72757a);
    font-size: 11px;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#${PANEL_ID} .tm-rc-theme-badge {
    display: block;
    margin-top: 1px;
    padding: 1px 6px;
    border: 1px solid var(--tm-preview-border);
    border-radius: 999px;
    color: var(--tm-preview-primary);
    background: var(--tm-preview-bg);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
}

@media (max-width: 880px) {
    #${PANEL_ID} .tm-rc-theme-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 620px) {
    #${PANEL_ID} .tm-rc-theme-grid {
        grid-template-columns: 1fr;
    }

    #${PANEL_ID} .tm-rc-theme-status {
        display: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    #${PANEL_ID} .tm-rc-theme-preview,
    #${PANEL_ID} .tm-rc-theme-radio {
        transition: none;
    }
}
`;

    function injectStyles() {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            const host = document.head || document.documentElement;
            if (!host) return;
            style = document.createElement('style');
            style.id = STYLE_ID;
            host.appendChild(style);
        }
        if (style.textContent !== CSS) style.textContent = CSS;
    }

    injectStyles();

    function persistTheme(theme) {
        try {
            if (theme) {
                localStorage.setItem(STORAGE_KEY, theme);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (error) {
            // The visual theme still works for this tab if storage is blocked.
        }
    }

    function selectedValue() {
        return currentTheme || 'default';
    }

    function updateControls(announce) {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;

        const activeValue = selectedValue();
        const cards = panel.querySelectorAll('[' + VALUE_ATTRIBUTE + ']');
        for (let i = 0; i < cards.length; i += 1) {
            const card = cards[i];
            const checked = card.getAttribute(VALUE_ATTRIBUTE) === activeValue;
            const ariaChecked = checked ? 'true' : 'false';
            const tabIndex = checked ? 0 : -1;
            if (card.getAttribute('aria-checked') !== ariaChecked) {
                card.setAttribute('aria-checked', ariaChecked);
            }
            if (card.tabIndex !== tabIndex) card.tabIndex = tabIndex;
        }

        const status = panel.querySelector('.tm-rc-theme-status');
        if (status) {
            const label = THEME_META[activeValue].label;
            const message = (announce ? 'Applied · ' : 'Current · ') + label;
            if (status.textContent !== message) status.textContent = message;
        }
    }

    function setTheme(value, options) {
        const settings = options || {};
        currentTheme = normalizeTheme(value);
        applyRootAttribute();
        if (settings.persist !== false) persistTheme(currentTheme);
        updateControls(settings.announce !== false);

        try {
            window.dispatchEvent(new CustomEvent('tm-rc-custom-theme-change', {
                detail: { theme: currentTheme },
            }));
        } catch (error) {
            // CustomEvent is only a convenience API; theming does not depend on it.
        }
    }

    function createElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function createPreview() {
        const preview = createElement('span', 'tm-rc-theme-preview');
        preview.setAttribute('aria-hidden', 'true');

        const topbar = createElement('span', 'tm-rc-preview-topbar');
        for (let i = 0; i < 3; i += 1) {
            topbar.appendChild(createElement('span', 'tm-rc-preview-dot'));
        }
        topbar.appendChild(createElement('span', 'tm-rc-preview-search'));

        const shell = createElement('span', 'tm-rc-preview-shell');
        const sidebar = createElement('span', 'tm-rc-preview-sidebar');
        for (let i = 0; i < 5; i += 1) {
            sidebar.appendChild(createElement(
                'span',
                'tm-rc-preview-sidebar-line' + (i === 1 ? ' is-active' : '')
            ));
        }

        const main = createElement('span', 'tm-rc-preview-main');
        const copy = createElement('span', 'tm-rc-preview-copy');
        copy.appendChild(createElement('span', 'tm-rc-preview-line is-title'));
        copy.appendChild(createElement('span', 'tm-rc-preview-line'));
        copy.appendChild(createElement('span', 'tm-rc-preview-line is-short'));
        copy.appendChild(createElement('span', 'tm-rc-preview-line'));

        const aside = createElement('span', 'tm-rc-preview-aside');
        aside.appendChild(createElement('span', 'tm-rc-preview-chip'));
        aside.appendChild(createElement('span', 'tm-rc-preview-chip'));
        aside.appendChild(createElement('span', 'tm-rc-preview-line is-short'));

        main.appendChild(copy);
        main.appendChild(aside);
        shell.appendChild(sidebar);
        shell.appendChild(main);
        preview.appendChild(topbar);
        preview.appendChild(shell);
        return preview;
    }

    function createThemeCard(value) {
        const meta = THEME_META[value];
        const card = createElement('button', 'tm-rc-theme-card');
        card.type = 'button';
        card.setAttribute('role', 'radio');
        card.setAttribute(VALUE_ATTRIBUTE, value);
        card.setAttribute('aria-label', meta.label + ' theme. ' + meta.description);
        card.appendChild(createPreview());

        const labelRow = createElement('span', 'tm-rc-theme-label-row');
        labelRow.appendChild(createElement('span', 'tm-rc-theme-radio'));

        const copy = createElement('span', 'tm-rc-theme-copy');
        copy.appendChild(createElement('span', 'tm-rc-theme-name', meta.label));
        copy.appendChild(createElement('span', 'tm-rc-theme-description', meta.description));
        labelRow.appendChild(copy);
        labelRow.appendChild(createElement('span', 'tm-rc-theme-badge', meta.badge));
        card.appendChild(labelRow);

        card.addEventListener('click', function () {
            setTheme(value === 'default' ? null : value, { persist: true, announce: true });
        });
        return card;
    }

    function createPanel() {
        const panel = createElement('section');
        panel.id = PANEL_ID;
        panel.setAttribute('data-test-automation-id', 'tm-rc-custom-theme-category');
        panel.setAttribute('aria-labelledby', PANEL_ID + '-title');

        const heading = createElement('div', 'tm-rc-theme-heading');
        const title = createElement('div', 'tm-rc-theme-title', 'Custom themes');
        title.id = PANEL_ID + '-title';
        heading.appendChild(title);

        const status = createElement('div', 'tm-rc-theme-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        heading.appendChild(status);
        panel.appendChild(heading);

        const group = createElement('div', 'tm-rc-theme-grid');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', 'Custom RingCentral themes');
        CUSTOM_THEMES.forEach(function (theme) {
            group.appendChild(createThemeCard(theme));
        });
        group.appendChild(createThemeCard('default'));

        group.addEventListener('keydown', function (event) {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;

            const card = event.target.closest('[' + VALUE_ATTRIBUTE + ']');
            if (!card || !group.contains(card)) return;

            const cards = Array.from(group.querySelectorAll('[' + VALUE_ATTRIBUTE + ']'));
            const index = cards.indexOf(card);
            const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
            const nextIndex = (index + (backwards ? -1 : 1) + cards.length) % cards.length;
            event.preventDefault();
            cards[nextIndex].focus();
            cards[nextIndex].click();
        });

        panel.appendChild(group);
        return panel;
    }

    function isThemeRoute() {
        return THEME_ROUTE_RE.test(location.pathname || '');
    }

    function mountControls() {
        if (!isThemeRoute()) return;

        const lightCategory = document.querySelector(
            '[data-test-automation-id="theme-select-category-light"]'
        );
        if (!lightCategory || !lightCategory.parentElement) return;

        let panel = document.getElementById(PANEL_ID);
        if (!panel) {
            panel = createPanel();
            lightCategory.insertAdjacentElement('afterend', panel);
        } else if (panel.previousElementSibling !== lightCategory) {
            lightCategory.insertAdjacentElement('afterend', panel);
        }
        updateControls(false);
    }

    let mountScheduled = false;

    function scheduleMount() {
        if (mountScheduled) return;
        mountScheduled = true;

        const run = function () {
            mountScheduled = false;
            mountControls();
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run);
        } else {
            setTimeout(run, 0);
        }
    }

    function handleNativeThemeInteraction(event) {
        if (!currentTheme || !isThemeRoute()) return;
        const target = event.target;
        if (!target || !target.closest) return;

        const panel = target.closest('#' + PANEL_ID);
        if (panel) return;

        const nativeItem = target.closest('[data-test-automation-id^="theme-select-item-"]');
        const nativeSection = target.closest('[data-test-automation-id="settingSection-themeGeneral"]');
        if (nativeItem || (event.type === 'change' && nativeSection)) {
            setTheme(null, { persist: true, announce: false });
        }
    }

    function startDomIntegration() {
        injectStyles();
        applyRootAttribute();
        scheduleMount();

        document.addEventListener('click', handleNativeThemeInteraction, true);
        document.addEventListener('change', handleNativeThemeInteraction, true);

        if (typeof MutationObserver === 'function') {
            const observer = new MutationObserver(function (mutations) {
                if (!isThemeRoute()) return;

                // Ignore our own live-status/card updates. If React replaces
                // the whole panel, the mutation target is its external parent
                // and the controls are mounted again as intended.
                for (let i = 0; i < mutations.length; i += 1) {
                    const target = mutations[i].target;
                    if (target && target.closest && target.closest('#' + PANEL_ID)) continue;
                    scheduleMount();
                    break;
                }
            });
            observer.observe(document.body || document.documentElement, {
                childList: true,
                subtree: true,
            });
        }

        window.addEventListener('popstate', scheduleMount);
    }

    window.addEventListener('storage', function (event) {
        if (event.key !== STORAGE_KEY) return;
        currentTheme = normalizeTheme(event.newValue);
        applyRootAttribute();
        updateControls(false);
    });

    // Tiny public API for console users and for interoperability with other
    // personal scripts. Example: RCCustomThemes.set('macaron').
    window.RCCustomThemes = Object.freeze({
        version: VERSION,
        get: function () { return currentTheme; },
        set: function (theme) { setTheme(theme, { persist: true, announce: true }); },
        reset: function () { setTheme(null, { persist: true, announce: true }); },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startDomIntegration, { once: true });
    } else {
        startDomIntegration();
    }
})();
