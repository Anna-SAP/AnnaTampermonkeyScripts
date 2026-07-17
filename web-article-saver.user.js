// ==UserScript==
// @name         Web Article Saver (网页正文提取保存)
// @namespace    https://github.com/Anna-SAP/AnnaTampermonkeyScripts
// @version      1.3.0
// @description  悬浮按钮一键提取网页纯净正文：剔除广告/侧边栏/评论区/导航等噪音，完整保留图片、SVG、表格、代码块、图表等正文资产；相对路径自动转绝对路径，可选图片 Base64 内嵌（完全离线可读），下载为独立 HTML 文件；PDF 双通道：自动保存到下载目录（html2canvas+jsPDF），或打印对话框导出（文字可选）。支持 claude.ai artifact 等"正文在跨域沙箱 iframe 中"的分享页。快捷键 Alt+Shift+S 快速保存。
// @author       Anna Su
// @match        http://*/*
// @match        https://*/*
// @icon         data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20100%20100%22%3E%3Ctext%20y=%22.9em%22%20font-size=%2290%22%3E%F0%9F%93%A5%3C/text%3E%3C/svg%3E
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_download
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/web-article-saver.user.js
// @downloadURL  https://raw.githubusercontent.com/Anna-SAP/AnnaTampermonkeyScripts/main/web-article-saver.user.js
// ==/UserScript==
(function () {
    'use strict';

    // ---------- 0. 常量与配置 ----------
    const VERSION = '1.3.0';
    const LOG = (...a) => console.log('%c[WCX]', 'color:#2563eb;font-weight:600', ...a);
    const WARN = (...a) => console.warn('[WCX]', ...a);

    const CFG = {
        MIN_ARTICLE_CHARS: 250,      // 低于此字数认为没有明显正文 → 回退保存整个 body
        MIN_CANDIDATE_SCORE: 25,     // 候选评分下限
        EMBED_CONCURRENCY: 4,        // Base64 内嵌并发数
        EMBED_TIMEOUT: 30000,        // 单张图片抓取超时 (ms)
        EMBED_MAX_BYTES: 25 * 1024 * 1024, // 单张图片体积上限，超出则保留在线 URL
    };

    // 懒加载图片常见的真实地址属性（按优先级）
    const LAZY_ATTRS = ['data-src', 'data-original', 'data-actualsrc', 'data-lazy-src',
        'data-lazyload', 'data-hi-res-src', 'data-full-src', 'data-image', 'data-echo', 'data-url'];

    // 允许保留的第三方嵌入 iframe（视频/代码演示等）
    const EMBED_IFRAME_RE = /(youtube(-nocookie)?\.com\/embed|youtu\.be|player\.vimeo\.com|player\.bilibili\.com|bilibili\.com\/player|codepen\.io|jsfiddle\.net|codesandbox\.io|open\.spotify\.com|w\.soundcloud\.com|music\.163\.com|docs\.google\.com|observablehq\.com)/i;

    // 强噪音词：命中即删（除非该节点承载了大半正文）
    const STRONG_NOISE = ['ad', 'ads', 'advert', 'advertisement', 'adsense', 'adbox', 'sponsor', 'sponsored',
        'promo', 'promotion', 'comment', 'comments', 'disqus', 'giscus', 'utterances', 'livefyre',
        'newsletter', 'subscribe', 'subscription', 'signup', 'paywall', 'outbrain', 'taboola',
        'popup', 'modal', 'overlay', 'cookie', 'gdpr', 'consent', 'share', 'sharing', 'sharebar',
        'social', 'socials', 'related', 'recommend', 'recommended', 'recommendation', 'breadcrumb',
        'breadcrumbs', 'pagination', 'pager', 'masthead', 'skiplink', 'backtotop', 'announcement'];
    // 强噪音词中，若节点内含正文级媒体（表格/大图等）且链接密度低，则豁免的子集
    // （避免误删 class="share-image"、"promo-figure" 之类承载真实配图的容器）
    const MEDIA_GUARDED_NOISE = new Set(['share', 'sharing', 'sharebar', 'social', 'socials',
        'related', 'recommend', 'recommended', 'recommendation', 'promo', 'promotion']);
    // 弱噪音词：需同时满足"文字占比低/链接密度高"等条件才删
    const WEAK_NOISE = ['header', 'footer', 'nav', 'navbar', 'menu', 'sidebar', 'aside', 'widget',
        'toolbar', 'dropdown', 'banner', 'tags', 'taglist', 'author-box', 'bio', 'search', 'login', 'follow'];

    const DROP_ROLES = new Set(['navigation', 'banner', 'complementary', 'contentinfo', 'search',
        'searchbox', 'dialog', 'alertdialog', 'alert', 'menu', 'menubar', 'toolbar', 'tooltip']);

    const ALWAYS_DROP_TAGS = new Set(['script', 'style', 'link', 'meta', 'template', 'object', 'embed',
        'applet', 'dialog', 'select', 'option', 'optgroup', 'input', 'textarea', 'button', 'fieldset',
        'legend', 'datalist', 'output', 'portal']);

    // 已知站点专属噪音（提取后直接删除，跨站无副作用）
    const SITE_CLEANUP_SEL = '.mw-editsection, .mw-jump-link';

    // 判定"含有重要内容资产"时统计的选择器（svg 故意排除：分享按钮多为 svg 图标）
    const BIG_MEDIA_SEL = 'table, pre, video, picture, figure';

    // 常见正文容器提示选择器（含中文站点）
    const HINT_SELECTORS = [
        'article', 'main', '[role="main"]', '[itemprop~="articleBody"]',
        '.post-content', '.post-body', '.post__content', '.article-content', '.article-body',
        '.article__content', '.entry-content', '.entry__content', '.markdown-body', '.story-body',
        '.rich_media_content', '#js_content',            // 微信公众号
        '.RichText', '.Post-RichTextContainer',          // 知乎
        '#content_views', '.article_content',            // CSDN
        '.note-content', '.blog-content', '.main-content', '.page-content',
        '.td-post-content', '.prose', '#content', '.content',
    ].join(',');

    const gmXHR = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest
        : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') ? GM.xmlHttpRequest
            : null;
    const gmDownload = (typeof GM_download === 'function') ? GM_download
        : (typeof GM !== 'undefined' && GM && typeof GM.download === 'function') ? GM.download
            : null;
    // 是否运行在子 frame 中（claude.ai artifact 等把正文放在跨域沙箱 iframe 里）
    const IS_FRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

    // ---------- 1. 基础工具 ----------
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function textOf(el) {
        return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function toAbs(url, base) {
        if (!url) return url;
        url = String(url).trim();
        if (/^(data:|blob:|#|mailto:|tel:|javascript:|about:)/i.test(url)) return url;
        try { return new URL(url, base || document.baseURI).href; } catch (e) { return url; }
    }

    // srcset 解析器：兼容 URL 内含逗号（如 Cloudinary 变换参数）的情况
    function parseSrcset(input) {
        const out = [];
        let s = String(input || '').trim(), pos = 0;
        while (pos < s.length) {
            while (pos < s.length && /[\s,]/.test(s[pos])) pos++;
            let start = pos;
            while (pos < s.length && !/\s/.test(s[pos])) pos++;
            let url = s.slice(start, pos);
            if (!url) break;
            if (/,+$/.test(url)) {           // "url1," 无描述符，逗号粘连
                out.push({ url: url.replace(/,+$/, ''), desc: '' });
                continue;
            }
            while (pos < s.length && /\s/.test(s[pos])) pos++;
            start = pos;
            while (pos < s.length && s[pos] !== ',') pos++;
            out.push({ url, desc: s.slice(start, pos).trim() });
            pos++;
        }
        return out.filter(c => c.url);
    }

    function absSrcset(ss) {
        const cands = parseSrcset(ss);
        if (!cands.length) return ss;
        return cands.map(c => toAbs(c.url) + (c.desc ? ' ' + c.desc : '')).join(', ');
    }

    // 从 srcset 中挑选最大宽度（或最高像素密度）的候选
    function pickBestFromSrcset(ss) {
        const cands = parseSrcset(ss);
        if (!cands.length) return null;
        let best = null, bestVal = -1;
        for (const c of cands) {
            let v = 1;
            const m = /([\d.]+)\s*([wx])/i.exec(c.desc || '');
            if (m) v = m[2].toLowerCase() === 'w' ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
            if (v > bestVal) { bestVal = v; best = c.url; }
        }
        return best;
    }

    function isPlaceholderSrc(u) {
        if (!u) return true;
        u = String(u).trim();
        if (/^about:blank$/i.test(u)) return true;
        if (/^data:/i.test(u)) return u.length < 600;   // 微型占位 data URI
        if (/(^|\/)(blank|spacer|placeholder|pixel|transparent|lazy(load)?|1x1)[^\/]*\.(gif|png|jpe?g|svg|webp)([?#]|$)/i.test(u)) return true;
        return false;
    }

    // CSS url() 绝对化：支持带引号（可含括号）与不带引号两种写法
    function absolutizeCssUrls(cssValue) {
        return String(cssValue).replace(
            /url\(\s*"([^"]*)"\s*\)|url\(\s*'([^']*)'\s*\)|url\(\s*([^'")][^)]*)\)/g,
            (m, dq, sq, bare) => 'url("' + toAbs((dq != null ? dq : sq != null ? sq : bare).trim()) + '")');
    }

    function linkDensity(el) {
        const total = textOf(el).length;
        if (!total) return 0;
        let linked = 0;
        el.querySelectorAll('a').forEach(a => { linked += textOf(a).length; });
        return Math.min(1, linked / total);
    }

    // 一次 DFS 预计算子树文本长度 / 链接文本长度，classify 阶段 O(1) 查询，
    // 避免大页面上反复 textContent + querySelectorAll 造成卡顿
    function buildMetrics(rootLive) {
        const textLen = new WeakMap(), linkLen = new WeakMap();
        (function dfs(el, inLink) {
            let t = 0, l = 0;
            const linkHere = inLink || el.localName === 'a';
            for (const n of el.childNodes) {
                if (n.nodeType === Node.TEXT_NODE) {
                    const c = (n.data || '').replace(/\s+/g, ' ').trim().length;
                    t += c;
                    if (linkHere) l += c;
                } else if (n.nodeType === Node.ELEMENT_NODE) {
                    dfs(n, linkHere);
                    t += textLen.get(n) || 0;
                    l += linkLen.get(n) || 0;
                }
            }
            textLen.set(el, t);
            linkLen.set(el, l);
        })(rootLive, false);
        return {
            len: el => textLen.has(el) ? textLen.get(el) : textOf(el).length,
            ld: el => {
                if (!textLen.has(el)) return linkDensity(el);
                const t = textLen.get(el);
                return t ? Math.min(1, (linkLen.get(el) || 0) / t) : 0;
            },
        };
    }

    // id/class 的 token 级噪音匹配：词必须出现在 token 的开头或结尾，
    // 避免 "market-share-chart" 这类中缀误伤
    function tokenNoiseMatch(el, words) {
        const tokens = [];
        if (el.id) tokens.push(el.id);
        if (typeof el.className === 'string' && el.className) tokens.push(...el.className.split(/\s+/));
        for (const raw of tokens) {
            const t = raw.toLowerCase();
            for (const w of words) {
                if (t === w) return w;
                if (t.startsWith(w + '-') || t.startsWith(w + '_')) return w;
                if (t.endsWith('-' + w) || t.endsWith('_' + w)) return w;
            }
        }
        return null;
    }

    function containsBigMedia(el) {
        if (el.querySelector(BIG_MEDIA_SEL)) return true;
        for (const img of el.querySelectorAll('img')) {
            const src = img.currentSrc || img.getAttribute('src') || '';
            if (isPlaceholderSrc(src) && !LAZY_ATTRS.some(a => img.getAttribute(a))) continue;
            if (img.naturalWidth === 0 || img.naturalWidth >= 80) return true;
        }
        return false;
    }

    // ---------- 2. 正文候选发现与评分 ----------
    function scoreCandidate(el) {
        const t = textOf(el);
        const len = t.length;
        if (len < 140) return 0;
        const pCount = el.querySelectorAll('p').length;
        const commas = (t.match(/[,，.。;；]/g) || []).length;
        const ld = linkDensity(el);
        let s = Math.sqrt(len) + pCount * 8 + Math.min(commas, 100);
        s *= (1 - Math.min(ld, 0.9));
        if (el.localName === 'article' || (el.matches && el.matches('main,[role="main"],[itemprop~="articleBody"]'))) s *= 1.3;
        const hint = ((typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '')).toLowerCase();
        if (/(article|content|post|entry|main|body|markdown|prose|story)/.test(hint)) s *= 1.15;
        if (/(comment|sidebar|widget|footer|nav|menu|promo|related|recommend)/.test(hint)) s *= 0.4;
        return s;
    }

    function discoverCandidate() {
        if (!document.body) return null;

        // 2a. 段落聚合评分（Readability 思路）：给内容块的父辈记分
        const scores = new Map();
        const bump = (el, pts) => {
            if (!el || el === document.body || el === document.documentElement) return;
            scores.set(el, (scores.get(el) || 0) + pts);
        };
        document.body.querySelectorAll('p, blockquote, pre, td, h2, h3, h4, figcaption').forEach(n => {
            const len = textOf(n).length;
            if (len < 25 && !['pre', 'td'].includes(n.localName)) return;
            const pts = 1 + Math.min(Math.floor(len / 90), 3);
            bump(n.parentElement, pts);
            if (n.parentElement) bump(n.parentElement.parentElement, pts / 2);
        });

        // 候选归一化：表格内部结构元素（tbody/tr/td…）不能作为提取根——
        // 脱离 <table> 上下文序列化时会被 HTML 解析器丢弃标签，整张表格报废。
        // 提升到 table 的父容器（表格型 artifact 页面正是这种结构）
        const normalizeCandidate = el => {
            const t = el.closest && el.closest('table');
            return (t && t.parentElement) ? t.parentElement : el;
        };
        const pool = new Set();
        [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([el]) => pool.add(normalizeCandidate(el)));
        try {
            document.querySelectorAll(HINT_SELECTORS).forEach(el => pool.add(normalizeCandidate(el)));
        } catch (e) { /* 选择器兼容性兜底 */ }

        // 2b. 用统一的精细评分挑最优
        let best = null, bestScore = 0;
        for (const el of pool) {
            if (!el.isConnected) continue;
            if (el.id && el.id.startsWith('__WCX')) continue;
            const s = scoreCandidate(el);
            if (s > bestScore) { best = el; bestScore = s; }
        }
        if (!best || bestScore < CFG.MIN_CANDIDATE_SCORE) return null;

        // 2c. 尝试向上攀升，吸收被拆分的正文段（严格限制，避免吸进侧边栏）
        for (let i = 0; i < 3; i++) {
            const p = best.parentElement;
            if (!p || p === document.body || p === document.documentElement) break;
            const sp = scoreCandidate(p);
            if (sp > bestScore * 1.05 && textOf(p).length < textOf(best).length * 1.6) {
                best = p; bestScore = sp;
            } else break;
        }
        if (textOf(best).length < CFG.MIN_ARTICLE_CHARS) return null;
        return best;
    }

    // ---------- 3. 克隆 + 去噪 + 懒加载还原（live/clone 平行遍历） ----------
    function extractContent() {
        let live = discoverCandidate();
        let usedFallback = false;
        if (!live) {
            live = document.body;
            usedFallback = true;
            if (!live) return null;
        }
        const m = buildMetrics(live);
        const ctx = { totalLen: Math.max(1, m.len(live)), m };
        let clone = live.cloneNode(true);

        hydrateElement(live, clone, ctx);
        transplant(live, clone, ctx);

        // body 回退模式：把 <body> 克隆转成 <div>，避免序列化出嵌套 body 标签
        if (clone.localName === 'body') {
            const div = document.createElement('div');
            while (clone.firstChild) div.appendChild(clone.firstChild);
            clone = div;
        }
        postProcess(clone);

        const wrapper = document.createElement('div');
        wrapper.appendChild(clone);
        return { root: wrapper, usedFallback, textLen: textOf(wrapper).length };
    }

    // classify 返回: 'drop' | 'keep' | 'skip'（keep 但不再深入）
    function classify(live, clone, ctx) {
        const tag = live.localName;

        // 自身 UI 与结构性噪音
        if (live.id && live.id.startsWith('__WCX')) return 'drop';
        if (tag === 'noscript') return 'skip';           // 留给 postProcess 提取真实图片
        if (live.closest('svg')) return tag === 'script' ? 'drop' : 'skip'; // svg 内部整体保留
        if (tag === 'form') {
            return (ctx.m.len(live) / ctx.totalLen > 0.4) ? 'keep' : 'drop';
        }
        if (ALWAYS_DROP_TAGS.has(tag)) return 'drop';

        if (tag === 'canvas') {
            // 图表 canvas → 栅格化为 img（Chart.js/ECharts 等）
            try {
                const durl = live.toDataURL('image/png');
                if (durl && durl.length > 256) {
                    const img = document.createElement('img');
                    img.src = durl;
                    if (live.width) img.width = live.width;
                    if (live.height) img.height = live.height;
                    img.alt = live.getAttribute('aria-label') || 'chart';
                    clone.replaceWith(img);
                    return 'skip';
                }
            } catch (e) { /* canvas 被跨域污染 */ }
            return 'drop';
        }

        if (tag === 'iframe') {
            // 兼容懒加载 iframe（真实地址在 data-src）
            const src = toAbs(live.getAttribute('src') || live.getAttribute('data-src') || '');
            if (src && EMBED_IFRAME_RE.test(src) && !live.getAttribute('srcdoc')) {
                clone.setAttribute('src', src);
                clone.removeAttribute('srcdoc');
                clone.removeAttribute('data-src');
                return 'skip';
            }
            return 'drop';
        }

        if (tag === 'br' || tag === 'hr' || tag === 'wbr' || tag === 'source' || tag === 'track') return 'skip';

        // 计算样式判定（隐藏元素 / fixed 悬浮层）
        let cs = null;
        try { cs = getComputedStyle(live); } catch (e) { }
        const mediaExempt = (tag === 'img' || tag === 'picture' || tag === 'svg' || tag === 'math' || tag === 'video' || tag === 'audio');
        if (cs && !mediaExempt && !live.closest('details')) {
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return 'drop';
            if (cs.position === 'fixed') return 'drop';
        }

        if (tag === 'img') {
            // 追踪像素：仅在没有任何懒加载真实地址线索时才删
            const lazyish = LAZY_ATTRS.some(a => live.getAttribute(a))
                || live.getAttribute('data-srcset') || live.getAttribute('srcset');
            if (!lazyish) {
                const w = parseInt(live.getAttribute('width') || '', 10);
                const h = parseInt(live.getAttribute('height') || '', 10);
                if ((w > 0 && w <= 3) || (h > 0 && h <= 3)) return 'drop';
                if (live.naturalWidth > 0 && live.naturalWidth <= 3) return 'drop';
            }
            return 'skip';
        }
        if (mediaExempt) return (tag === 'video' || tag === 'audio' || tag === 'picture') ? 'keep' : 'skip';

        // 语义角色噪音
        const role = (live.getAttribute('role') || '').toLowerCase();
        if (role && DROP_ROLES.has(role)) return 'drop';
        if (live.getAttribute('aria-modal') === 'true') return 'drop';

        // 强噪音词（先于 header/footer 分支，避免带噪音类名的元素漏网）
        const share = ctx.m.len(live) / ctx.totalLen;
        const strongHit = tokenNoiseMatch(live, STRONG_NOISE);
        if (strongHit && share < 0.5) {
            const guarded = MEDIA_GUARDED_NOISE.has(strongHit)
                && containsBigMedia(live) && ctx.m.ld(live) < 0.5;
            if (!guarded) return 'drop';
        }

        if (tag === 'nav') return 'drop';
        if (tag === 'footer' || tag === 'aside') {
            if (containsBigMedia(live) && ctx.m.ld(live) < 0.5) return 'keep';
            return 'drop';
        }
        if (tag === 'header') {
            // 站点级 header 删；文章内 header（标题 + hero 图）留
            if (ctx.m.ld(live) > 0.5 || live.querySelector('nav')) return 'drop';
            return 'keep';
        }

        // 弱噪音词
        if (tokenNoiseMatch(live, WEAK_NOISE)) {
            const ld = ctx.m.ld(live);
            if (ld > 0.55) return 'drop';
            if (share < 0.2 && !containsBigMedia(live) && live.querySelectorAll('p').length < 3) return 'drop';
        }

        // 通用高链接密度块（导航/相关阅读残留）
        if (tag === 'div' || tag === 'section' || tag === 'ul' || tag === 'ol') {
            const len = ctx.m.len(live);
            if (len > 80 && share < 0.3 && ctx.m.ld(live) > 0.8 && !containsBigMedia(live)) return 'drop';
        }
        return 'keep';
    }

    function hydrateElement(live, clone, ctx) {
        if (live.localName === 'img') { hydrateImg(live, clone); return; }
        if (live.localName === 'source') {
            const dss = live.getAttribute('data-srcset');
            if (dss && !live.getAttribute('srcset')) clone.setAttribute('srcset', dss);
            return;
        }
        // 背景图片固化为内联样式（hero banner 等）
        try {
            const cs = getComputedStyle(live);
            const bg = cs.backgroundImage;
            if (bg && bg !== 'none' && bg.includes('url(')) {
                clone.style.backgroundImage = absolutizeCssUrls(bg);
                if (cs.backgroundSize && cs.backgroundSize !== 'auto') clone.style.backgroundSize = cs.backgroundSize;
            }
        } catch (e) { }
    }

    // 懒加载图片真实地址还原。候选优先级：
    //   非占位的 http(s) 地址 > 非占位 data: > currentSrc/src 兜底
    // 这样 LQIP（模糊 data URI 预览图）不会顶掉真实地址
    function hydrateImg(live, clone) {
        const srcAttr = live.getAttribute('src') || '';
        const liveSrcset = live.getAttribute('srcset') || '';
        const dss = live.getAttribute('data-srcset') || live.getAttribute('data-lazy-srcset') || '';
        const cands = [];
        const push = (u, from) => { if (u) cands.push({ u: String(u), from }); };

        push(live.currentSrc, 'current');
        for (const a of LAZY_ATTRS) push(live.getAttribute(a), 'lazy');
        if (dss) push(pickBestFromSrcset(dss), 'lazy');
        if (liveSrcset) push(pickBestFromSrcset(liveSrcset), 'srcset');
        push(srcAttr, 'src');
        // <picture> 兜底：img 自身没有真实地址时借用兄弟 <source>
        if (live.parentElement && live.parentElement.localName === 'picture') {
            for (const so of live.parentElement.querySelectorAll('source')) {
                const sss = so.getAttribute('srcset') || so.getAttribute('data-srcset');
                if (sss) push(pickBestFromSrcset(sss), 'picture');
            }
        }

        const real = c => !isPlaceholderSrc(c.u);
        const noData = c => !/^data:/i.test(c.u);
        // 最后一级回退信任懒加载属性：data-src 几乎总是真图，文件名启发式不应一票否决
        const chosen = cands.find(c => real(c) && noData(c)) || cands.find(real)
            || cands.find(c => c.from === 'lazy') || cands[0];
        if (chosen) clone.setAttribute('src', toAbs(chosen.u));

        // srcset 取舍：data-srcset 最可信；live srcset 仅当其最优项非占位才保留；
        // 若 src 来自懒加载属性而 srcset 是旧占位（或与之竞争），移除以免遮蔽 src
        let outSS = dss || liveSrcset;
        if (outSS) {
            const b = pickBestFromSrcset(outSS);
            if (!b || isPlaceholderSrc(b)) outSS = '';
            else if (chosen && (chosen.from === 'lazy' || chosen.from === 'picture') && !dss) outSS = '';
        }
        if (outSS) clone.setAttribute('srcset', absSrcset(outSS));
        else clone.removeAttribute('srcset');

        for (const a of LAZY_ATTRS) clone.removeAttribute(a);
        clone.removeAttribute('data-srcset');
        clone.removeAttribute('data-lazy-srcset');
    }

    function transplant(live, clone, ctx) {
        const lcs = [...live.children], ccs = [...clone.children];
        for (let i = 0; i < lcs.length; i++) {
            const l = lcs[i], c = ccs[i];
            if (!c) continue;
            const act = classify(l, c, ctx);
            if (act === 'drop') { c.remove(); continue; }
            hydrateElement(l, c, ctx);
            if (act === 'skip') continue;
            // 开放 shadow DOM 且无 light children：将 shadow 内容拍平进克隆
            if (l.shadowRoot && l.children.length === 0) {
                for (const sc of [...l.shadowRoot.children]) {
                    if (['style', 'script', 'link'].includes(sc.localName)) continue;
                    const scc = sc.cloneNode(true);
                    if (classify(sc, scc, ctx) === 'drop') continue;
                    c.appendChild(scc);
                    hydrateElement(sc, scc, ctx);
                    transplant(sc, scc, ctx);
                }
                continue;
            }
            transplant(l, c, ctx);
        }
    }

    // ---------- 4. 克隆树后处理 ----------
    function postProcess(root) {
        // 4a. noscript → 提取其中的真实 <img>（Medium 等站点的懒加载回退）
        root.querySelectorAll('noscript').forEach(ns => {
            try {
                const doc = new DOMParser().parseFromString(ns.textContent || '', 'text/html');
                const imgs = [...doc.querySelectorAll('img')];
                const parent = ns.parentElement;
                if (imgs.length && parent) {
                    // 仅当附近没有"真实"图片（http 且非占位）时才提升，LQIP 不算真实
                    const hasReal = [...parent.querySelectorAll('img')].some(i => {
                        const s = i.getAttribute('src') || '';
                        return /^https?:/i.test(s) && !isPlaceholderSrc(s);
                    });
                    if (!hasReal) {
                        const existing = new Set([...parent.querySelectorAll('img')].map(i => i.getAttribute('src')));
                        for (const im of imgs) {
                            const s = im.getAttribute('src');
                            if (!s) continue;
                            const abs = toAbs(s);
                            if (existing.has(abs)) continue;
                            const nimg = document.createElement('img');
                            nimg.src = abs;
                            if (im.getAttribute('srcset')) nimg.setAttribute('srcset', absSrcset(im.getAttribute('srcset')));
                            if (im.getAttribute('alt')) nimg.alt = im.getAttribute('alt');
                            ns.before(nimg);
                        }
                    }
                }
            } catch (e) { }
            ns.remove();
        });

        // 4b. SVG sprite 内联：<use href="#id"> 引用的 symbol 若在正文外，从原文档搬入
        inlineSvgUseRefs(root);

        // 4c. 所有 URL 属性绝对化
        const URL_ATTRS = [
            ['img', 'src'], ['img', 'srcset'], ['source', 'src'], ['source', 'srcset'],
            ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'],
            ['a', 'href'], ['area', 'href'], ['iframe', 'src'], ['image', 'href'], ['use', 'href'],
        ];
        for (const [tag, attr] of URL_ATTRS) {
            root.querySelectorAll(tag).forEach(el => {
                const v = el.getAttribute(attr);
                if (!v) return;
                if (attr === 'srcset') el.setAttribute(attr, absSrcset(v));
                else el.setAttribute(attr, toAbs(v));
            });
        }
        // SVG 1.1 xlink:href
        root.querySelectorAll('image, use').forEach(el => {
            const v = el.getAttribute('xlink:href');
            if (v) el.setAttribute('xlink:href', toAbs(v));
        });
        // 内联样式中的 url()
        root.querySelectorAll('[style]').forEach(el => {
            const st = el.getAttribute('style');
            if (st && st.includes('url(')) el.setAttribute('style', absolutizeCssUrls(st));
        });

        // 4d. 站点专属噪音
        try { root.querySelectorAll(SITE_CLEANUP_SEL).forEach(el => el.remove()); } catch (e) { }

        // 4e. 安全清理：脚本、事件处理器、javascript: 协议
        root.querySelectorAll('script, link, meta, base').forEach(el => el.remove());
        root.querySelectorAll('*').forEach(el => {
            for (const at of [...el.attributes]) {
                const n = at.name.toLowerCase();
                if (n.startsWith('on')) { el.removeAttribute(at.name); continue; }
                if ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'formaction' || n === 'data')
                    && /^\s*javascript:/i.test(at.value)) { el.removeAttribute(at.name); continue; }
                if (['srcdoc', 'integrity', 'nonce', 'crossorigin', 'referrerpolicy', 'contenteditable', 'autofocus', 'ping'].includes(n)) {
                    el.removeAttribute(at.name); continue;
                }
            }
            if (el.getAttribute && el.getAttribute('target')) el.setAttribute('rel', 'noopener noreferrer');
        });

        // 4f. 自底向上清除空容器。
        // 绝不进入 svg/math/pre/code/table 内部（空白 span 是高亮器的换行、path 无文本皆正常），
        // 保留锚点(id/name)、带背景图样式、以及包含受保护媒体的节点
        const KEEP_EMPTY = new Set(['br', 'hr', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'table',
            'caption', 'colgroup', 'col', 'iframe', 'svg', 'math', 'img', 'video', 'audio', 'picture',
            'source', 'track', 'canvas']);
        const PROTECTED_SEL = 'img, svg, math, video, audio, iframe, picture, table, pre, hr, br, canvas, embed, object';
        const all = [...root.querySelectorAll('*')];
        for (let i = all.length - 1; i >= 0; i--) {
            const el = all[i];
            if (!root.contains(el)) continue;             // 已随祖先一起被移除（克隆树是游离的，不能用 isConnected）
            if (KEEP_EMPTY.has(el.localName)) continue;
            if (el.closest('svg, math, pre, code, table')) continue;
            if (el.id || el.getAttribute('name')) continue;   // 锚点目标
            const st = el.getAttribute('style') || '';
            if (st.includes('url(') || st.includes('background')) continue;
            if (textOf(el)) continue;
            if (el.querySelector(PROTECTED_SEL)) continue;
            el.remove();
        }

        // 4g. 表格包裹（横向滚动）
        root.querySelectorAll('table').forEach(t => {
            if (t.parentElement && t.parentElement.classList.contains('wcx-tablewrap')) return;
            if (t.parentElement && t.parentElement.closest('table')) return;  // 嵌套表格不重复包
            const w = document.createElement('div');
            w.className = 'wcx-tablewrap';
            t.before(w);
            w.appendChild(t);
        });

        // 4h. 懒加载遗留属性清理
        root.querySelectorAll('img').forEach(img => {
            img.removeAttribute('loading');
            img.removeAttribute('decoding');
        });
    }

    // <use href="#id"> 引用文档级 sprite 时，把对应 symbol/defs 克隆进正文，
    // 保证图标与 SVG 流程图离线可用
    function inlineSvgUseRefs(root) {
        const need = new Set();
        root.querySelectorAll('use').forEach(u => {
            const href = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').trim();
            const m = /^#(.+)$/.exec(href);
            if (m) need.add(m[1]);
        });
        if (!need.size) return;
        const defs = [];
        for (const id of need) {
            let sel;
            try { sel = '#' + CSS.escape(id); } catch (e) { continue; }
            if (root.querySelector(sel)) continue;            // 已在正文内
            const src = document.querySelector(sel);
            if (src && src.closest('svg')) defs.push(src.cloneNode(true));
        }
        if (!defs.length) return;
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const carrier = document.createElementNS(SVG_NS, 'svg');
        carrier.setAttribute('aria-hidden', 'true');
        carrier.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
        const d = document.createElementNS(SVG_NS, 'defs');
        defs.forEach(n => d.appendChild(n));
        carrier.appendChild(d);
        root.prepend(carrier);
    }

    // ---------- 5. 页面元数据 ----------
    function metaContent(sel) {
        const el = document.querySelector(sel);
        return el ? (el.getAttribute('content') || '').trim() : '';
    }

    function getPageMeta(root) {
        let title = metaContent('meta[property="og:title"]') || metaContent('meta[name="twitter:title"]');
        if (!title) {
            const h1 = root && root.querySelector('h1');
            title = (h1 && textOf(h1)) || document.title || location.hostname;
        }
        const byline = metaContent('meta[name="author"]') || metaContent('meta[property="article:author"]').replace(/^https?:\/\/\S+$/, '');
        let published = metaContent('meta[property="article:published_time"]') || metaContent('meta[name="date"]');
        if (!published) {
            const t = document.querySelector('article time[datetime], time[datetime]');
            if (t) published = t.getAttribute('datetime');
        }
        if (published) {
            const d = new Date(published);
            published = isNaN(d) ? published : d.toLocaleDateString();
        }
        return { title: title.trim(), byline: (byline || '').trim(), published: (published || '').trim() };
    }

    // ---------- 6. 独立 HTML 文档构建 ----------
    const DOC_CSS = [
        ':root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--codebg:#f6f8fa;--accent:#0969da}',
        '@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--border:#30363d;--codebg:#161b22;--accent:#4493f8}}',
        '*{box-sizing:border-box}',
        'body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}',
        '.wcx-page{max-width:760px;margin:0 auto;padding:36px 20px 64px}',
        '.wcx-title{font-size:1.9em;line-height:1.35;margin:.1em 0 .45em;font-weight:700}',
        '.wcx-meta{color:var(--muted);font-size:.85em;border-bottom:1px solid var(--border);padding-bottom:14px;margin-bottom:26px}',
        '.wcx-meta a{color:var(--accent);text-decoration:none;word-break:break-all}',
        'h1,h2,h3,h4,h5,h6{line-height:1.4;margin:1.6em 0 .6em}',
        'p{margin:.9em 0}',
        'a{color:var(--accent)}',
        'img{max-width:100%;height:auto;border-radius:4px}',
        'svg{max-width:100%}',
        'video,iframe{max-width:100%;border:0}',
        'figure{margin:1.6em 0;text-align:center}',
        'figure img{margin:0 auto}',
        'figcaption{font-size:.85em;color:var(--muted);margin-top:.55em;line-height:1.5}',
        'pre{background:var(--codebg);border:1px solid var(--border);padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:.875em;line-height:1.6}',
        'code{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;background:var(--codebg);padding:.15em .4em;border-radius:4px;font-size:.9em}',
        'pre code{background:none;border:0;padding:0;font-size:1em}',
        '.wcx-tablewrap{overflow-x:auto;margin:1.3em 0}',
        'table{border-collapse:collapse;font-size:.92em}',
        'th,td{border:1px solid var(--border);padding:7px 12px;text-align:left;vertical-align:top}',
        'th{background:var(--codebg);font-weight:600}',
        'blockquote{margin:1.3em 0;padding:.2em 1.1em;border-left:4px solid var(--border);color:var(--muted)}',
        'hr{border:0;border-top:1px solid var(--border);margin:2.2em 0}',
        'ul,ol{padding-left:1.6em}',
        'li{margin:.3em 0}',
        '.wcx-footer{margin-top:52px;padding-top:14px;border-top:1px solid var(--border);color:var(--muted);font-size:.8em;line-height:1.6}',
        '@page{margin:16mm 13mm}',
        // 打印/导出 PDF：强制浅色调色板（避免暗色模式打出深底 PDF）、保留代码块与表头底色、避免关键元素被断页劈开
        '@media print{',
        ':root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--codebg:#f6f8fa;--accent:#0969da}',
        '.wcx-page{max-width:100%;padding:0}',
        'pre{white-space:pre-wrap}',
        'pre,code,th{print-color-adjust:exact;-webkit-print-color-adjust:exact}',
        'tr,img,figure{break-inside:avoid}',
        'a{word-break:break-all}',
        '}',
    ].join('\n');

    function buildDoc(root, meta, opts) {
        const lang = document.documentElement.getAttribute('lang') || 'zh-CN';
        const now = new Date();
        const words = textOf(root).length;
        const readMin = Math.max(1, Math.ceil(words / 400));
        // frame 模式下 location 是内容沙箱域（如 *.claudeusercontent.com 哈希域），
        // 对读者无意义，优先记录 referrer 指向的宿主页面
        let srcURL = location.href, srcHost = location.hostname;
        if (IS_FRAME && document.referrer) {
            try { srcHost = new URL(document.referrer).hostname; srcURL = document.referrer; } catch (e) { }
        }
        const metaBits = [];
        metaBits.push('<a href="' + esc(srcURL) + '">' + esc(srcHost) + '</a>');
        if (meta.byline) metaBits.push(esc(meta.byline));
        if (meta.published) metaBits.push(esc(meta.published));
        metaBits.push('约 ' + words + ' 字 · ' + readMin + ' 分钟');

        // 若正文开头已有同名 h1，则去掉，避免标题重复
        const firstH1 = root.querySelector('h1');
        if (firstH1 && textOf(firstH1).replace(/\s+/g, '') === meta.title.replace(/\s+/g, '')) firstH1.remove();

        return [
            '<!DOCTYPE html>',
            '<html lang="' + esc(lang) + '">',
            '<head>',
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            '<meta name="referrer" content="no-referrer">',
            '<title>' + esc(meta.title) + '</title>',
            '<!-- Saved by Web Article Saver v' + VERSION + ' | ' + esc(srcURL) + ' | ' + now.toISOString() + ' -->',
            '<style>' + DOC_CSS + '</style>'
            // PDF 栅格化渲染必须强制浅色（渲染 iframe 会继承浏览器暗色偏好，否则整本 PDF 是深底）
            + (opts && opts.forceLight
                ? '<style>html{color-scheme:light}:root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--codebg:#f6f8fa;--accent:#0969da}</style>'
                : ''),
            '</head>',
            '<body>',
            '<div class="wcx-page">',
            '<h1 class="wcx-title">' + esc(meta.title) + '</h1>',
            '<div class="wcx-meta">' + metaBits.join(' · ') + '</div>',
            '<main class="wcx-body">' + root.innerHTML + '</main>',
            '<div class="wcx-footer">本文保存自 <a href="' + esc(srcURL) + '">' + esc(srcURL) + '</a><br>'
            + '保存时间：' + esc(now.toLocaleString()) + ' · Web Article Saver v' + VERSION
            + (opts && opts.embedded ? ' · 图片已内嵌 (Base64)' : ' · 图片为在线引用') + '</div>',
            '</div>',
            '</body>',
            '</html>',
        ].join('\n');
    }

    // ---------- 7. 图片抓取与 Base64 内嵌 ----------
    const MIME_BY_EXT = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
    };

    function blobToDataURL(blob, url) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => {
                let r = String(fr.result || '');
                // MIME 缺失/不可渲染时按扩展名修正
                if (/^data:(application\/octet-stream|text\/plain)[;,]/i.test(r) || /^data:;/i.test(r) || /^data:,/.test(r)) {
                    const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url || '');
                    const mime = m && MIME_BY_EXT[m[1].toLowerCase()];
                    if (mime) r = r.replace(/^data:[^;,]*/i, 'data:' + mime);
                }
                resolve(r);
            };
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
        });
    }

    function pageFetchBlob(url) {
        return fetch(url, { mode: 'cors', credentials: 'omit' }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
        });
    }

    function gmFetchBlob(url) {
        return new Promise((resolve, reject) => {
            gmXHR({
                method: 'GET', url, responseType: 'blob', timeout: CFG.EMBED_TIMEOUT,
                onload: r => (r.status >= 200 && r.status < 300 && r.response) ? resolve(r.response) : reject(new Error('HTTP ' + r.status)),
                onerror: () => reject(new Error('network error')),
                ontimeout: () => reject(new Error('timeout')),
            });
        });
    }

    async function fetchAsDataURL(url) {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        try {
            let blob = null;
            if (url.startsWith('blob:')) {
                blob = await pageFetchBlob(url);            // blob: 仅本页会话有效，必须现在转存
            } else if (gmXHR) {
                try { blob = await gmFetchBlob(url); }
                catch (e) { blob = await pageFetchBlob(url); }
            } else {
                blob = await pageFetchBlob(url);
            }
            if (!blob || blob.size === 0) return null;
            if (blob.size > CFG.EMBED_MAX_BYTES) { WARN('图片过大，保留在线链接:', url); return null; }
            return await blobToDataURL(blob, url);
        } catch (e) {
            WARN('图片抓取失败:', url, e && e.message);
            return null;
        }
    }

    async function runPool(tasks, limit, onEach) {
        let idx = 0;
        const n = Math.max(1, Math.min(limit, tasks.length));
        const workers = Array.from({ length: n }, async () => {
            while (idx < tasks.length) {
                const t = tasks[idx++];
                try { await t(); } catch (e) { }
                if (onEach) onEach();
            }
        });
        await Promise.all(workers);
    }

    // opts.blobOnly=true 时仅转存 blob: 地址（在线模式也必须做，否则本地文件里是死链）
    async function embedAssets(root, onProgress, opts) {
        const blobOnly = !!(opts && opts.blobOnly);
        const want = u => !!u && !u.startsWith('data:') && (!blobOnly || u.startsWith('blob:'));

        if (!blobOnly) {
            // <picture> 拍平为单个 img（src 已在提取阶段解析为最优地址）
            root.querySelectorAll('picture').forEach(pic => {
                const img = pic.querySelector('img');
                if (img) pic.replaceWith(img);
                else pic.remove();
            });
        }

        const cache = new Map();
        const failed = new Set();
        const get = url => {
            if (!cache.has(url)) {
                cache.set(url, fetchAsDataURL(url).then(d => { if (!d) failed.add(url); return d; }));
            }
            return cache.get(url);
        };
        const jobs = [];

        root.querySelectorAll('img').forEach(img => {
            const u = img.getAttribute('src');
            if (!want(u)) return;
            jobs.push(async () => {
                const d = await get(u);
                if (d) {
                    img.setAttribute('src', d);
                    img.removeAttribute('srcset');
                    img.removeAttribute('sizes');
                } else if (u.startsWith('blob:')) {
                    img.remove();                             // 转存失败的 blob: 是永久死链
                }
            });
        });
        root.querySelectorAll('video[poster]').forEach(v => {
            const u = v.getAttribute('poster');
            if (!want(u)) return;
            jobs.push(async () => {
                const d = await get(u);
                if (d) v.setAttribute('poster', d);
                else if (u.startsWith('blob:')) v.removeAttribute('poster');
            });
        });
        root.querySelectorAll('image').forEach(im => {
            for (const attr of ['href', 'xlink:href']) {
                const u = im.getAttribute(attr);
                if (!want(u) || (u && u.startsWith('#'))) continue;
                jobs.push(async () => { const d = await get(u); if (d) im.setAttribute(attr, d); });
            }
        });
        if (!blobOnly) {
            root.querySelectorAll('[style*="url("]').forEach(el => {
                const st = el.getAttribute('style') || '';
                const urls = new Set([...st.matchAll(/url\(\s*"([^"]*)"\s*\)|url\(\s*'([^']*)'\s*\)|url\(\s*([^'")][^)]*)\)/g)]
                    .map(m => (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] || '').trim())
                    .filter(u => /^https?:/i.test(u)));
                if (!urls.size) return;
                jobs.push(async () => {
                    const map = new Map();
                    for (const u of urls) {
                        const d = await get(u);
                        if (d) map.set(u, d);
                    }
                    if (!map.size) return;
                    // 整体正则重写，避免 split/join 在"一个 URL 是另一个前缀"时相互污染
                    const cur = el.getAttribute('style') || '';
                    el.setAttribute('style', cur.replace(
                        /url\(\s*"([^"]*)"\s*\)|url\(\s*'([^']*)'\s*\)|url\(\s*([^'")][^)]*)\)/g,
                        (mm, dq, sq, bare) => {
                            const u = (dq != null ? dq : sq != null ? sq : bare || '').trim();
                            return map.has(u) ? 'url("' + map.get(u) + '")' : mm;
                        }));
                });
            });
        }

        const total = jobs.length;
        let done = 0;
        if (total && onProgress) onProgress(0, total);
        await runPool(jobs, CFG.EMBED_CONCURRENCY, () => { done++; if (onProgress) onProgress(done, total); });
        return { total, failedCount: failed.size };
    }

    // ---------- 8. 下载 ----------
    function sanitizeFilename(name) {
        return String(name)
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim().replace(/[. ]+$/, '')                 // Windows 不允许结尾点/空格
            .slice(0, 80) || 'article';
    }

    function anchorDownload(url, fn) {
        const a = document.createElement('a');
        a.href = url;
        a.download = fn;
        document.documentElement.appendChild(a);
        a.click();
        a.remove();
    }

    // ---- 沙箱 iframe 下载中继 ----
    // claude.ai artifact 的沙箱 iframe 无 allow-downloads：<a download> 被浏览器静默拦截，
    // GM_download 对页面 blob: URL 的支持也不可靠（下载模式/白名单相关）。
    // 但本脚本同时运行在顶层宿主页面（外壳模式），顶层无沙箱限制 ——
    // 让 iframe 实例把 HTML postMessage 给顶层实例代为下载，并等待回执确认。
    const DL_MSG = '__WCX_DL_v1__';
    let lastRelayAt = 0;

    // 顶层：接收内嵌 frame 的下载请求（带多重防滥用校验）
    function setupTopRelay() {
        window.addEventListener('message', e => {
            const d = e.data;
            if (!d || d.t !== DL_MSG || d.ack || typeof d.fn !== 'string') return;
            const isBlob = (typeof Blob !== 'undefined') && (d.blob instanceof Blob);
            if (!isBlob && typeof d.html !== 'string') return;
            // 来源必须是本页面里真实存在的内容级大 iframe（拦掉广告位等小 frame 的伪造请求）
            const frame = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source);
            if (!frame) return;
            const r = frame.getBoundingClientRect();
            const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
            if (r.width < 500 || r.height < 350 || (r.width * r.height) / (vw * vh) < 0.25) return;
            const now = Date.now();
            if (now - lastRelayAt < 2000) return;             // 节流：2 秒最多一次
            lastRelayAt = now;
            if (d.mode === 'print') {
                if (typeof d.html !== 'string') return;
                // 代打印：接受即回执（打印流程含图片等待，异步进行，避免 frame 侧超时后重复弹窗）
                try { e.source.postMessage({ t: DL_MSG, ack: d.id }, '*'); } catch (err) { }
                printHTMLViaIframe(String(d.html));
                LOG('已代内嵌 frame 调起打印对话框');
                return;
            }
            // 扩展名强制与载荷类型绑定：PDF blob → .pdf，其余一律 .html
            const ext = (isBlob && d.blob.type === 'application/pdf') ? '.pdf' : '.html';
            const fn = sanitizeFilename(String(d.fn).replace(/\.(html?|pdf)$/i, '')) + ext;
            const blob = isBlob ? d.blob : new Blob([d.html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            anchorDownload(url, fn);
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            try { e.source.postMessage({ t: DL_MSG, ack: d.id }, '*'); } catch (err) { }
            LOG('已代内嵌 frame 下载:', fn);
        });
    }

    // 子 frame：请求顶层代执行（mode: 'download' | 'print'），3 秒内收到回执视为成功
    function relayViaTop(payload) {
        return new Promise(resolve => {
            const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
            let settled = false;
            const finish = ok => { if (!settled) { settled = true; window.removeEventListener('message', onMsg); resolve(ok); } };
            const onMsg = e => { const d = e.data; if (d && d.t === DL_MSG && d.ack === id) finish(true); };
            window.addEventListener('message', onMsg);
            try {
                window.top.postMessage({ t: DL_MSG, id, mode: payload.mode || 'download', fn: payload.fn, html: payload.html, blob: payload.blob }, '*');
            } catch (e) { finish(false); return; }
            setTimeout(() => finish(false), 3000);
        });
    }

    // GM_download Promise 化：onload/onerror/超时都有明确结果，不再"发射后不管"
    function gmDownloadURL(url, fn) {
        return new Promise(resolve => {
            if (!gmDownload) { resolve(false); return; }
            let settled = false;
            const finish = ok => { if (!settled) { settled = true; resolve(ok); } };
            try {
                gmDownload({
                    url, name: fn, saveAs: false,
                    onload: () => finish(true),
                    onerror: e => { WARN('GM_download 失败:', e && (e.error || e.message)); finish(false); },
                    ontimeout: () => finish(false),
                });
            } catch (e) { WARN('GM_download 异常:', e && e.message); finish(false); }
            setTimeout(() => finish(false), 8000);
        });
    }

    // 返回 { fn, bytes, via }；via = 'anchor' | 'top' | 'gm' | 'unverified'
    // （'unverified' 表示走了沙箱内 <a download> 兜底，无法确认文件真正落盘）
    async function downloadHTML(html, title) {
        const d = new Date();
        const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
        let host = location.hostname;
        if (IS_FRAME && document.referrer) {
            try { host = new URL(document.referrer).hostname; } catch (e) { }
        }
        host = sanitizeFilename(host.replace(/^[0-9a-f-]{20,}\./i, ''));   // 去掉 artifact 域名哈希前缀
        const fn = sanitizeFilename(title) + '_' + host + '_' + ymd + '.html';
        const bytes = new Blob([html]).size;

        if (IS_FRAME) {
            // 沙箱 frame 首选顶层中继（唯一可确认成功的通道）
            if (await relayViaTop({ mode: 'download', fn, html })) return { fn, bytes, via: 'top' };
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
            if (await gmDownloadURL(url, fn)) {
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                return { fn, bytes, via: 'gm' };
            }
            anchorDownload(url, fn);                          // 尽力而为，可能被沙箱拦截
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return { fn, bytes, via: 'unverified' };
        }

        // 顶层：<a download> 直接可用，最可靠
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        anchorDownload(url, fn);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return { fn, bytes, via: 'anchor' };
    }

    // ---------- 8b. PDF 导出（浏览器打印引擎，对话框中选"另存为 PDF"） ----------
    // 不用 jsPDF/html2canvas：中文需内嵌巨型字体、内容被栅格化、表格质量差。
    // 打印引擎输出的 PDF 文字可选、矢量清晰，文件名默认取文档 <title>（即文章标题）。
    function printHTMLViaIframe(html) {
        return new Promise(resolve => {
            const fr = document.createElement('iframe');
            fr.id = '__WCX_PRINT__';
            // 不能 display:none（不渲染则无法打印）；用零尺寸 + visibility 隐藏
            fr.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden');
            // 内容已消毒，仍禁脚本双保险；allow-modals 是 print() 的前提，allow-same-origin 供本脚本调用
            fr.setAttribute('sandbox', 'allow-same-origin allow-modals');
            let settled = false, printURL = null, cleaned = false;
            const finish = ok => { if (!settled) { settled = true; resolve(ok); } };
            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                fr.remove();
                if (printURL) { URL.revokeObjectURL(printURL); printURL = null; }
            };
            fr.addEventListener('load', () => {
                let doc = null;
                try { doc = fr.contentDocument; } catch (e) { }
                if (!doc || !doc.body || doc.body.children.length === 0) return;  // 空白初载/被 CSP 拦，等下一次或超时
                // 等图片就绪（上限 10s），再留 400ms 让字体与布局稳定
                const pending = [...doc.images].filter(i => !i.complete);
                let went = false;
                const go = () => {
                    if (went) return;
                    went = true;
                    setTimeout(() => {
                        try {
                            fr.contentWindow.focus();
                            fr.contentWindow.print();
                            finish(true);
                        } catch (e) { WARN('print 调用失败:', e && e.message); finish(false); }
                        // 对话框关闭后回收；afterprint 并非处处可靠，2 分钟兜底
                        try { fr.contentWindow.addEventListener('afterprint', () => setTimeout(cleanup, 500)); } catch (e) { }
                        setTimeout(cleanup, 120000);
                    }, 400);
                };
                if (!pending.length) { go(); return; }
                let left = pending.length;
                const done = () => { if (--left <= 0) go(); };
                pending.forEach(i => { i.addEventListener('load', done); i.addEventListener('error', done); });
                setTimeout(go, 10000);
            });
            try {
                fr.srcdoc = toTrustedHTML(html);              // 先赋值再挂载，避免 about:blank 抢跑 load
            } catch (e) {
                printURL = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
                fr.src = printURL;
            }
            document.documentElement.appendChild(fr);
            setTimeout(() => { if (!settled) { finish(false); cleanup(); } }, 20000);  // load 始终未达（CSP 拦截等）
        });
    }

    async function exportPDFViaPrint() {
        if (busy) { toast('正在处理中，请稍候…'); return; }
        if (!IS_FRAME && isShellTopPage()) {
            toast('⚠️ 本页正文位于跨域内嵌页面中，请点击内容区域内的悬浮按钮操作');
            return;
        }
        busy = true;
        try {
            toast('正在提取正文…', { sticky: true });
            await new Promise(r => setTimeout(r, 30));
            const ex = extractContent();
            if (!ex) { toast('⚠️ 未能找到可提取的正文'); return; }
            const meta = getPageMeta(ex.root);
            // 走打印引擎前先内嵌图片：在线图偶发加载失败会在 PDF 里变成空框
            const embedInfo = await embedAssets(ex.root, (done, total) => {
                toast('正在内嵌图片 ' + done + '/' + total + ' …', { sticky: true, progress: total ? done / total : 1 });
            });
            const html = buildDoc(ex.root, meta, { embedded: true });
            let viaTop = false, ok;
            if (IS_FRAME) {
                viaTop = await relayViaTop({ mode: 'print', fn: meta.title, html });
                ok = viaTop || await printHTMLViaIframe(html);
            } else {
                ok = await printHTMLViaIframe(html);
            }
            if (viaTop) {
                toast('🖨 已在宿主页面打开打印对话框，请在"目标/打印机"中选择「另存为 PDF」', { duration: 9000 });
            } else if (ok && IS_FRAME) {
                // 沙箱内本地 print 可能被静默忽略，无法确认，措辞留余地
                toast('🖨 已尝试打开打印对话框，请选择「另存为 PDF」；若无反应请改用"下载 HTML"', { duration: 9000 });
            } else if (ok) {
                let msg = '🖨 已打开打印对话框，请在"目标/打印机"中选择「另存为 PDF」';
                if (embedInfo && embedInfo.failedCount) msg += '（' + embedInfo.failedCount + ' 张图片抓取失败）';
                toast(msg, { duration: 9000 });
            } else {
                toast('❌ 打印对话框未能打开（可能被页面沙箱或 CSP 限制），请改用"下载 HTML"', { duration: 8000 });
            }
        } catch (e) {
            WARN(e);
            toast('❌ PDF 导出失败：' + (e && e.message));
        } finally {
            busy = false;
        }
    }

    // ---------- 8c. PDF 自动导出（html2canvas 栅格化 + jsPDF，直接落到浏览器下载目录） ----------
    // 打印对话框的保存位置由所选"打印机"决定（如 WPS 虚拟打印机会写进临时目录），脚本无法控制；
    // 此通道由脚本自己生成 PDF 字节流，走与 HTML 相同的下载链路（含沙箱 frame 顶层中继）。
    // 中文经浏览器渲染后栅格化，显示完好；代价是文字不可选中——需要可选文字时用打印通道。

    // 把独立 HTML 文档在离屏 iframe 中排版渲染成一张长 canvas
    function renderDocToCanvas(html) {
        return new Promise((resolve, reject) => {
            if (typeof html2canvas !== 'function') { reject(new Error('html2canvas 未加载（@require 被禁用？）')); return; }
            const fr = document.createElement('iframe');
            fr.id = '__WCX_RENDER__';
            // 离屏但正常渲染：不能用 visibility:hidden（html2canvas 会跳过隐藏元素）
            fr.setAttribute('style', 'position:fixed;left:-12000px;top:0;width:794px;height:800px;border:0;pointer-events:none');
            fr.setAttribute('sandbox', 'allow-same-origin');
            let settled = false, blobURL = null;
            const finish = (v, err) => {
                if (settled) return;
                settled = true;
                fr.remove();
                if (blobURL) URL.revokeObjectURL(blobURL);
                err ? reject(err) : resolve(v);
            };
            fr.addEventListener('load', () => {
                let doc = null;
                try { doc = fr.contentDocument; } catch (e) { }
                if (!doc || !doc.body || doc.body.children.length === 0) return;
                const pending = [...doc.images].filter(i => !i.complete);
                let went = false;
                const go = () => {
                    if (went) return;
                    went = true;
                    setTimeout(async () => {
                        try {
                            try { await doc.fonts.ready; } catch (e) { }
                            const fullH = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
                            // 控制 canvas 尺寸上限：超长文章自动降低渲染倍率（浏览器 canvas 有维度/面积上限）
                            let scale = 2;
                            const MAX_DIM = 30000, MAX_AREA = 140e6;
                            if (fullH * scale > MAX_DIM) scale = Math.max(1, MAX_DIM / fullH);
                            if (794 * fullH * scale * scale > MAX_AREA) scale = Math.max(1, Math.sqrt(MAX_AREA / (794 * fullH)));
                            const canvas = await html2canvas(doc.body, {
                                scale, width: 794, windowWidth: 794,
                                backgroundColor: '#ffffff', logging: false, useCORS: true,
                            });
                            finish(canvas);
                        } catch (e) { finish(null, e); }
                    }, 400);
                };
                if (!pending.length) { go(); return; }
                let left = pending.length;
                const done = () => { if (--left <= 0) go(); };
                pending.forEach(i => { i.addEventListener('load', done); i.addEventListener('error', done); });
                setTimeout(go, 10000);
            });
            try {
                fr.srcdoc = toTrustedHTML(html);
            } catch (e) {
                blobURL = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
                fr.src = blobURL;
            }
            document.documentElement.appendChild(fr);
            setTimeout(() => finish(null, new Error('页面渲染超时')), 90000);
        });
    }

    // 在目标切割线上方寻找一行"几乎全白"的像素行作为分页点，避免把文字行劈成两半
    function findBreakY(ctx, canvas, targetY, searchUp, minY) {
        try {
            const w = canvas.width;
            const from = Math.max(minY, targetY - searchUp);
            if (from >= targetY) return targetY;
            const data = ctx.getImageData(0, from, w, targetY - from).data;
            for (let yy = targetY - from - 1; yy >= 0; yy--) {
                let white = true;
                for (let x = 0; x < w; x += 6) {           // 横向抽样即可
                    const o = (yy * w + x) * 4;
                    if (data[o] < 246 || data[o + 1] < 246 || data[o + 2] < 246) { white = false; break; }
                }
                if (white) return from + yy;
            }
        } catch (e) { }
        return targetY;
    }

    // 长 canvas 按 A4 切页并组装 PDF
    async function canvasToPDFBlob(canvas, onProgress) {
        const jsPDFCtor = (typeof jspdf !== 'undefined' && jspdf && jspdf.jsPDF)
            || (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF);
        if (!jsPDFCtor) throw new Error('jsPDF 未加载（@require 被禁用？）');
        const pdf = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
        const MARGIN = 10, USABLE_W = 210 - 2 * MARGIN, USABLE_H = 297 - 2 * MARGIN;
        const pagePx = Math.floor(canvas.width * USABLE_H / USABLE_W);   // 每页对应的源画布高度
        const ctx = canvas.getContext('2d');
        const totalPages = Math.max(1, Math.ceil(canvas.height / pagePx));
        let y = 0, page = 0;
        while (y < canvas.height && page < 500) {
            let end = Math.min(y + pagePx, canvas.height);
            if (end < canvas.height) {
                end = findBreakY(ctx, canvas, end, Math.floor(pagePx * 0.18), y + Math.floor(pagePx * 0.4));
            }
            const sliceH = end - y;
            const pc = document.createElement('canvas');
            pc.width = canvas.width;
            pc.height = sliceH;
            const pctx = pc.getContext('2d');
            pctx.fillStyle = '#ffffff';
            pctx.fillRect(0, 0, pc.width, pc.height);
            pctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
            if (page > 0) pdf.addPage();
            pdf.addImage(pc.toDataURL('image/jpeg', 0.9), 'JPEG', MARGIN, MARGIN, USABLE_W, USABLE_W * sliceH / canvas.width);
            y = end;
            page++;
            if (onProgress) onProgress(Math.min(page, totalPages), totalPages);
            await new Promise(r => setTimeout(r, 0));      // 让 UI 有喘息机会
        }
        return pdf.output('blob');
    }

    // Blob 走与 HTML 一致的下载链路（frame 中继 → GM_download → <a download>）
    async function deliverBlob(blob, fn) {
        if (IS_FRAME) {
            if (await relayViaTop({ mode: 'download', fn, blob })) return { via: 'top' };
            const url = URL.createObjectURL(blob);
            if (await gmDownloadURL(url, fn)) {
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                return { via: 'gm' };
            }
            anchorDownload(url, fn);
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return { via: 'unverified' };
        }
        const url = URL.createObjectURL(blob);
        anchorDownload(url, fn);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return { via: 'anchor' };
    }

    async function exportPDF() {
        if (busy) { toast('正在处理中，请稍候…'); return; }
        if (!IS_FRAME && isShellTopPage()) {
            toast('⚠️ 本页正文位于跨域内嵌页面中，请点击内容区域内的悬浮按钮操作');
            return;
        }
        busy = true;
        try {
            toast('正在提取正文…', { sticky: true });
            await new Promise(r => setTimeout(r, 30));
            const ex = extractContent();
            if (!ex) { toast('⚠️ 未能找到可提取的正文'); return; }
            const meta = getPageMeta(ex.root);
            const embedInfo = await embedAssets(ex.root, (done, total) => {
                toast('正在内嵌图片 ' + done + '/' + total + ' …', { sticky: true, progress: total ? done / total : 1 });
            });
            const html = buildDoc(ex.root, meta, { embedded: true, forceLight: true });
            toast('正在渲染页面…', { sticky: true });
            const canvas = await renderDocToCanvas(html);
            const blob = await canvasToPDFBlob(canvas, (p, t) => {
                toast('正在生成 PDF ' + p + '/' + t + ' 页…', { sticky: true, progress: t ? p / t : 1 });
            });
            const d = new Date();
            const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
            let host = location.hostname;
            if (IS_FRAME && document.referrer) {
                try { host = new URL(document.referrer).hostname; } catch (e) { }
            }
            host = sanitizeFilename(host.replace(/^[0-9a-f-]{20,}\./i, ''));
            const fn = sanitizeFilename(meta.title) + '_' + host + '_' + ymd + '.pdf';
            const { via } = await deliverBlob(blob, fn);
            const sizeStr = blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB';
            if (via === 'unverified') {
                toast('⚠️ 已尝试下载 ' + fn + '，但当前内容处于受限沙箱且宿主页面未能代为下载，文件可能未保存。', { duration: 9000 });
            } else {
                let msg = '✅ PDF 已保存：' + fn + '（' + sizeStr + '）';
                if (via === 'top') msg += '（经由宿主页面下载）';
                if (embedInfo && embedInfo.failedCount) msg += '，' + embedInfo.failedCount + ' 张图片抓取失败';
                toast(msg, { duration: 7000 });
            }
            LOG('pdf saved', fn, sizeStr, 'via=' + via);
        } catch (e) {
            WARN(e);
            toast('❌ PDF 导出失败：' + (e && e.message) + '。可尝试"导出 PDF（打印对话框）"', { duration: 8000 });
        } finally {
            busy = false;
        }
    }

    // ---------- 9. UI（悬浮按钮 / 菜单 / 进度提示 / 预览） ----------
    const UI_CSS = [
        '#__WCX_FAB__{position:fixed;right:22px;bottom:92px;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 6px 16px rgba(0,0,0,.28);cursor:pointer;z-index:2147483645;user-select:none;transition:transform .15s;touch-action:none}',
        '#__WCX_FAB__:hover{transform:scale(1.08)}',
        '#__WCX_MENU__{position:fixed;min-width:230px;background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.28);z-index:2147483646;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;display:none;flex-direction:column;color:#1f2328}',
        '#__WCX_MENU__ .hd{padding:10px 14px;font-size:12px;color:#666;border-bottom:1px solid #eee;background:#fafafa}',
        '#__WCX_MENU__ button{display:flex;align-items:center;gap:9px;width:100%;border:0;background:#fff;padding:11px 14px;font-size:13px;cursor:pointer;text-align:left;color:#1f2328}',
        '#__WCX_MENU__ button:hover{background:#f2f6ff}',
        '#__WCX_MENU__ .ft{padding:8px 14px;font-size:11px;color:#999;border-top:1px solid #eee}',
        '#__WCX_TOAST__{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);max-width:76vw;background:rgba(28,30,34,.94);color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;line-height:1.5;z-index:2147483646;display:none;box-shadow:0 8px 24px rgba(0,0,0,.35);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
        '#__WCX_TOAST__ .bar{height:4px;background:rgba(255,255,255,.25);border-radius:2px;margin-top:8px;overflow:hidden;display:none}',
        '#__WCX_TOAST__ .bar i{display:block;height:100%;width:0;background:#4ade80;border-radius:2px;transition:width .2s}',
        '#__WCX_PREVIEW__{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483646;display:none;align-items:center;justify-content:center}',
        '#__WCX_PREVIEW__ .box{width:min(920px,94vw);height:min(88vh,1000px);background:#fff;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)}',
        '#__WCX_PREVIEW__ .bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e5e5e5;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
        '#__WCX_PREVIEW__ .bar .t{font-size:13px;font-weight:600;color:#333;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '#__WCX_PREVIEW__ .bar button{border:1px solid #d5d5d5;background:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;color:#1f2328}',
        '#__WCX_PREVIEW__ .bar button:hover{background:#f0f4ff}',
        '#__WCX_PREVIEW__ .bar button.pri{background:#2563eb;border-color:#2563eb;color:#fff}',
        '#__WCX_PREVIEW__ iframe{flex:1;border:0;width:100%;background:#fff}',
    ].join('\n');

    let fab, menu, toastEl, previewEl, previewFrame, previewURL = null;
    let busy = false;

    function injectStyles() {
        const st = document.createElement('style');
        st.id = '__WCX_STYLE__';
        st.textContent = UI_CSS;
        (document.head || document.documentElement).appendChild(st);
    }

    function toast(msg, opts) {
        opts = opts || {};
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.id = '__WCX_TOAST__';
            const txt = document.createElement('div');
            txt.className = 'txt';
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.appendChild(document.createElement('i'));
            toastEl.appendChild(txt);
            toastEl.appendChild(bar);
            document.documentElement.appendChild(toastEl);
        }
        toastEl.querySelector('.txt').textContent = msg;
        const bar = toastEl.querySelector('.bar');
        if (typeof opts.progress === 'number') {
            bar.style.display = 'block';
            bar.querySelector('i').style.width = Math.round(opts.progress * 100) + '%';
        } else {
            bar.style.display = 'none';
        }
        toastEl.style.display = 'block';
        clearTimeout(toast._t);
        if (!opts.sticky) toast._t = setTimeout(() => { toastEl.style.display = 'none'; }, opts.duration || 3400);
    }

    function hideToast() { if (toastEl) toastEl.style.display = 'none'; }

    function buildMenu() {
        menu = document.createElement('div');
        menu.id = '__WCX_MENU__';
        const hd = document.createElement('div');
        hd.className = 'hd';
        hd.textContent = '📥 Web Article Saver v' + VERSION;
        menu.appendChild(hd);
        const items = [
            ['👁', '预览提取结果', () => openPreview()],
            ['📄', '下载 HTML（图片在线引用）', () => saveArticle(false)],
            ['📦', '下载 HTML（图片 Base64 内嵌，离线可用）', () => saveArticle(true)],
            ['🖨', '导出 PDF（自动保存到下载目录）', () => exportPDF()],
            ['🧾', '导出 PDF（打印对话框，文字可选中）', () => exportPDFViaPrint()],
        ];
        for (const [icon, label, fn] of items) {
            const b = document.createElement('button');
            const i = document.createElement('span');
            i.textContent = icon;
            const t = document.createElement('span');
            t.textContent = label;
            b.appendChild(i);
            b.appendChild(t);
            b.addEventListener('click', () => { hideMenu(); fn(); });
            menu.appendChild(b);
        }
        const ft = document.createElement('div');
        ft.className = 'ft';
        ft.textContent = '快捷键 Alt+Shift+S：快速下载（在线图片）';
        menu.appendChild(ft);
        document.documentElement.appendChild(menu);
        document.addEventListener('click', e => {
            if (menu.style.display !== 'none' && !menu.contains(e.target) && e.target !== fab && !fab.contains(e.target)) hideMenu();
        }, true);
    }

    function showMenu() {
        const r = fab.getBoundingClientRect();
        menu.style.display = 'flex';
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        let left = r.left + r.width / 2 > window.innerWidth / 2 ? r.right - mw : r.left;
        let top = r.top - mh - 10;
        if (top < 8) top = r.bottom + 10;
        menu.style.left = Math.max(8, Math.min(left, window.innerWidth - mw - 8)) + 'px';
        menu.style.top = Math.max(8, top) + 'px';
    }
    function hideMenu() { if (menu) menu.style.display = 'none'; }

    function buildFab() {
        fab = document.createElement('div');
        fab.id = '__WCX_FAB__';
        fab.textContent = '📥';
        fab.title = '提取并保存本页正文 (Web Article Saver)';
        document.documentElement.appendChild(fab);

        // 位置恢复
        try {
            const pos = JSON.parse(localStorage.getItem('__WCX_FAB_POS__') || 'null');
            if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') applyFabPos(pos.x, pos.y);
        } catch (e) { }

        // 拖拽 + 点击
        let drag = null;
        fab.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            const r = fab.getBoundingClientRect();
            drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
            try { fab.setPointerCapture(e.pointerId); } catch (err) { }
            e.preventDefault();
        });
        fab.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
            if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
            if (drag.moved) applyFabPos(drag.ox + dx, drag.oy + dy);
        });
        fab.addEventListener('pointerup', e => {
            if (!drag) return;
            if (drag.moved) {
                const r = fab.getBoundingClientRect();
                try { localStorage.setItem('__WCX_FAB_POS__', JSON.stringify({ x: r.left, y: r.top })); } catch (err) { }
            } else {
                menu.style.display === 'flex' ? hideMenu() : showMenu();
            }
            drag = null;
        });
        window.addEventListener('resize', () => {
            const r = fab.getBoundingClientRect();
            applyFabPos(r.left, r.top);
        });

        // SPA 重渲染守护：UI 被移除时重挂；顶层同时复核外壳页显隐
        // （SPA 可能在运行中导航进/出 artifact 类外壳页）
        setInterval(() => {
            if (fab && !fab.isConnected) document.documentElement.appendChild(fab);
            if (menu && !menu.isConnected) document.documentElement.appendChild(menu);
            if (!IS_FRAME && fab) {
                const shell = isShellTopPage();
                const want = shell ? 'none' : 'flex';
                if (fab.style.display !== want) { fab.style.display = want; if (shell) hideMenu(); }
            }
        }, 3000);
    }

    function applyFabPos(x, y) {
        const w = fab.offsetWidth || 48, h = fab.offsetHeight || 48;
        x = Math.max(4, Math.min(x, window.innerWidth - w - 4));
        y = Math.max(4, Math.min(y, window.innerHeight - h - 4));
        fab.style.left = x + 'px';
        fab.style.top = y + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    }

    // ---------- 10. 预览 ----------
    // Trusted Types 兼容：优先 srcdoc（不受 frame-src CSP 限制），策略被禁则回退 blob URL
    let ttPolicy = null, ttTried = false;
    function toTrustedHTML(s) {
        try {
            if (window.trustedTypes && window.trustedTypes.createPolicy) {
                if (!ttPolicy && !ttTried) {
                    ttTried = true;
                    ttPolicy = window.trustedTypes.createPolicy('wcx-preview', { createHTML: x => x });
                }
                if (ttPolicy) return ttPolicy.createHTML(s);
            }
        } catch (e) { }
        return s;
    }

    function buildPreviewShell() {
        previewEl = document.createElement('div');
        previewEl.id = '__WCX_PREVIEW__';
        const box = document.createElement('div');
        box.className = 'box';
        const bar = document.createElement('div');
        bar.className = 'bar';
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = '提取预览';
        bar.appendChild(t);
        const mk = (label, cls, fn) => {
            const b = document.createElement('button');
            b.textContent = label;
            if (cls) b.className = cls;
            b.addEventListener('click', fn);
            bar.appendChild(b);
            return b;
        };
        mk('下载（在线图片）', 'pri', () => { closePreview(); saveArticle(false); });
        mk('下载（内嵌 Base64）', '', () => { closePreview(); saveArticle(true); });
        mk('导出 PDF', '', () => { closePreview(); exportPDF(); });   // 自动保存通道
        mk('✕ 关闭', '', () => closePreview());
        previewFrame = document.createElement('iframe');
        previewFrame.setAttribute('sandbox', '');     // 禁脚本禁同源，纯静态预览
        box.appendChild(bar);
        box.appendChild(previewFrame);
        previewEl.appendChild(box);
        previewEl.addEventListener('click', e => { if (e.target === previewEl) closePreview(); });
        document.documentElement.appendChild(previewEl);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && previewEl.style.display === 'flex') closePreview();
        });
    }

    function showPreviewHTML(html) {
        if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = null; }
        try {
            previewFrame.srcdoc = toTrustedHTML(html);
        } catch (e) {
            // Trusted Types 策略被站点 CSP 禁止 → 回退 blob URL（可能被 frame-src 拦，尽力而为）
            previewURL = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
            previewFrame.removeAttribute('srcdoc');
            previewFrame.src = previewURL;
        }
    }

    function openPreview() {
        if (busy) { toast('正在处理中，请稍候…'); return; }
        if (!IS_FRAME && isShellTopPage()) {
            toast('⚠️ 本页正文位于跨域内嵌页面中，请点击内容区域内的悬浮按钮操作');
            return;
        }
        toast('正在提取正文…', { sticky: true });
        setTimeout(() => {
            try {
                const ex = extractContent();
                if (!ex) { toast('⚠️ 未能找到可提取的正文'); return; }
                const meta = getPageMeta(ex.root);
                const html = buildDoc(ex.root, meta, { embedded: false });
                if (!previewEl) buildPreviewShell();
                showPreviewHTML(html);
                previewEl.querySelector('.t').textContent = '提取预览 — ' + meta.title;
                previewEl.style.display = 'flex';
                hideToast();
                if (ex.usedFallback) toast('⚠️ 未检测到明显正文结构，已按整页主体提取');
            } catch (e) {
                WARN(e);
                toast('❌ 提取失败：' + (e && e.message));
            }
        }, 30);
    }

    function closePreview() {
        if (previewEl) previewEl.style.display = 'none';
        if (previewFrame) { previewFrame.removeAttribute('srcdoc'); previewFrame.src = 'about:blank'; }
        if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = null; }
    }

    // ---------- 11. 主流程 ----------
    async function saveArticle(embed) {
        if (busy) { toast('正在处理中，请稍候…'); return; }
        if (!IS_FRAME && isShellTopPage()) {
            toast('⚠️ 本页正文位于跨域内嵌页面中，请点击内容区域内的悬浮按钮操作（或先点击内容再按 Alt+Shift+S）');
            return;
        }
        busy = true;
        try {
            toast('正在提取正文…', { sticky: true });
            await new Promise(r => setTimeout(r, 30));    // 让 toast 先渲染
            const ex = extractContent();
            if (!ex) { toast('⚠️ 未能找到可提取的正文'); return; }
            const meta = getPageMeta(ex.root);
            if (ex.usedFallback) LOG('未找到明显正文候选，回退为整页主体');

            let embedInfo = null;
            if (embed) {
                embedInfo = await embedAssets(ex.root, (done, total) => {
                    toast('正在内嵌图片 ' + done + '/' + total + ' …', { sticky: true, progress: total ? done / total : 1 });
                });
            } else {
                // 在线模式也必须转存 blob: 图片（会话结束即失效）
                await embedAssets(ex.root, null, { blobOnly: true });
            }
            const html = buildDoc(ex.root, meta, { embedded: !!embed });
            const { fn, bytes, via } = await downloadHTML(html, meta.title);
            const sizeStr = bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
            if (via === 'unverified') {
                // 沙箱 frame 内所有可确认通道均失败，<a download> 兜底无法验证是否落盘，不能谎报成功
                toast('⚠️ 已尝试下载 ' + fn + '，但当前内容处于受限沙箱且宿主页面未能代为下载。'
                    + '若未看到文件：请确认 Tampermonkey 也在顶层页面运行，或在 Tampermonkey 设置中将下载模式改为"浏览器 API"。', { duration: 10000 });
            } else {
                let msg = '✅ 已保存：' + fn + '（' + sizeStr + '）';
                if (via === 'top') msg += '（经由宿主页面下载）';
                if (embedInfo && embedInfo.failedCount) msg += '，' + embedInfo.failedCount + ' 张图片抓取失败已保留在线链接';
                if (ex.usedFallback) msg += '（整页模式）';
                toast(msg, { duration: 6000 });
            }
            LOG('saved', fn, sizeStr, 'via=' + via, embedInfo || '');
        } catch (e) {
            WARN(e);
            toast('❌ 保存失败：' + (e && e.message));
        } finally {
            busy = false;
        }
    }

    // ---------- 12. 初始化 ----------
    // "外壳页"判定：顶层自身几乎没有正文，且被一个大型跨域 iframe 覆盖
    // （claude.ai artifact 分享页即此结构——正文在 *.claudeusercontent.com 沙箱 iframe 里，
    //   脚本会在那个 iframe 内单独挂载按钮，顶层按钮只会误存外壳，故隐藏）
    function isShellTopPage() {
        if (!document.body) return false;
        if (textOf(document.body).length > 3000) return false;
        const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
        for (const f of document.querySelectorAll('iframe')) {
            const r = f.getBoundingClientRect();
            if (r.width * r.height < 0.6 * vw * vh) continue;
            try { void f.contentDocument.documentElement; } catch (e) { return true; }  // 跨域大 iframe
            if (!f.contentDocument) return true;
        }
        return false;
    }

    // 子 frame 挂载的静态资格：与顶层跨域（顶层无法触达本文档）、非视频/播放器类嵌入。
    // 注意：尺寸不在这里查——脚本注入时宿主可能尚未完成布局（innerWidth 为 0），
    // 尺寸与内容一样属于"会就绪"的动态条件，放进 initFrameMode 的轮询里反复复查
    function frameEligible() {
        if (EMBED_IFRAME_RE.test(location.href)) return false;
        try { void window.top.document; return false; } catch (e) { return true; }
    }

    function frameHasContent() {
        if (!document.body) return false;
        if (document.body.querySelector('table, pre')) return true;
        if (textOf(document.body).length >= 300) return true;
        // 纯图形类内容（SVG 图表 / canvas / 大图）；注意 React 壳页也有空 <main>，
        // 故不能用 article/main 作为内容判据
        const media = document.body.querySelector('svg, canvas, img[src]');
        return !!(media && media.getBoundingClientRect().width > 200);
    }

    function mountUI() {
        injectStyles();
        buildFab();
        buildMenu();
        document.addEventListener('keydown', e => {
            if (e.altKey && e.shiftKey && e.code === 'KeyS') {
                const t = e.target;
                if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || ''))) return;
                e.preventDefault();
                saveArticle(false);
            }
        });
        LOG('Web Article Saver v' + VERSION + ' ready' + (IS_FRAME ? ' (frame mode: ' + location.hostname + ')' : '') + '.',
            gmXHR ? '(GM_xmlhttpRequest 可用)' : '(GM_xmlhttpRequest 不可用，Base64 内嵌将受 CORS 限制)');
    }

    function initTopMode() {
        setupTopRelay();          // 无论是否外壳页都监听：为内容级 iframe 代执行下载
        mountUI();
        if (isShellTopPage()) fab.style.display = 'none';   // 显隐由 buildFab 的守护 interval 持续复核
    }

    function initFrameMode() {
        if (!frameEligible()) return;
        // 尺寸（宿主布局就绪后 innerWidth 才有值）与内容（mermaid/表格等异步渲染）都轮询等待；
        // 尺寸门槛用于把广告位、追踪像素类小 frame 挡在外面
        let tries = 0;
        (function attempt() {
            const sized = window.innerWidth >= 500 && window.innerHeight >= 350;
            if (sized && frameHasContent()) { mountUI(); return; }
            if (++tries < 20) setTimeout(attempt, 1000);
        })();
    }

    function init() {
        if (IS_FRAME) initFrameMode();
        else initTopMode();
    }

    if (document.body) init();
    else {
        // @run-at document-idle 时 DOMContentLoaded 可能早已触发，轮询等待 body
        const timer = setInterval(() => {
            if (document.body) { clearInterval(timer); init(); }
        }, 200);
        setTimeout(() => clearInterval(timer), 15000);
    }
})();
