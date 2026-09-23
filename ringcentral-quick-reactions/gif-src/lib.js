// Sticker renderer shared by all quick-reaction GIFs.
// Each sticker registers a mascot drawn in a 100x100 box plus a text label;
// render.html lays frames out as a sprite sheet that build.mjs turns into a GIF.
(function () {
    'use strict';

    const SIZE = 160;
    const FONT = "'Cooper Black', 'Arial Rounded MT Bold', 'Segoe UI Black', sans-serif";
    // Mascot box (100x100 units) placed in the upper part of the canvas.
    const MASCOT = { x: 26, y: 2, scale: 1.08 };
    // Label band below the mascot. maxWidth leaves room for the outline, the
    // die-cut rim and small label animations; wordSpacing is a fraction of font size.
    const LABEL = { baseline: 149, maxWidth: 134, maxSize: 32, wordSpacing: 0.1 };
    const DEFS = {};

    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, k) => a + (b - a) * k;
    const easeOutBack = (k) => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
    const easeInOut = (k) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(k, 0, 1));
    // Smooth loop helpers: t is 0..1 over the whole animation.
    const wave = (t, cycles = 1, phase = 0) => Math.sin(TAU * (t * cycles + phase));
    // 0..1 progress of t inside [a,b], clamped.
    const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
    const f = (n) => Math.round(n * 100) / 100;

    const H = {
        TAU, clamp, lerp, easeOutBack, easeInOut, wave, seg, f,

        // Big glossy cartoon eye.
        eye(cx, cy, { rx = 4.2, ry = 5.4, color = '#2b1d12', look = [0, 0] } = {}) {
            return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${ry}" fill="${color}"/>` +
                `<circle cx="${f(cx - rx * 0.28 + look[0])}" cy="${f(cy - ry * 0.38 + look[1])}" r="${f(rx * 0.42)}" fill="#fff"/>` +
                `<circle cx="${f(cx + rx * 0.3 + look[0])}" cy="${f(cy + ry * 0.3 + look[1])}" r="${f(rx * 0.18)}" fill="#fff" opacity=".8"/>`;
        },
        // Closed happy eye (^ shape) or wink.
        closedEye(cx, cy, { w = 9, h = 4.5, color = '#2b1d12', sw = 2.4, up = true } = {}) {
            const dy = up ? -h : h;
            return `<path d="M${f(cx - w / 2)} ${f(cy)} Q${f(cx)} ${f(cy + dy * 2 - dy)} ${f(cx + w / 2)} ${f(cy)}" ` +
                `fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
        },
        blush(cx, cy, { rx = 5, ry = 3, color = '#ff7a8a', opacity = 0.55 } = {}) {
            return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${ry}" fill="${color}" opacity="${opacity}"/>`;
        },
        // Four-point twinkle star.
        sparkle(cx, cy, r, color = '#fff6b0', stroke = null) {
            const k = r * 0.28;
            const d = `M${f(cx)} ${f(cy - r)} Q${f(cx + k)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} Q${f(cx + k)} ${f(cy + k)} ${f(cx)} ${f(cy + r)} ` +
                `Q${f(cx - k)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} Q${f(cx - k)} ${f(cy - k)} ${f(cx)} ${f(cy - r)}Z`;
            return `<path d="${d}" fill="${color}"${stroke ? ` stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"` : ''}/>`;
        },
        // Heart centred on (cx, cy) with half-width s.
        heart(cx, cy, s, fill = '#ff4d7d', stroke = null, sw = 1.6) {
            const d = `M${f(cx)} ${f(cy + s * 0.95)} C${f(cx - s * 1.35)} ${f(cy + s * 0.05)} ${f(cx - s * 0.95)} ${f(cy - s * 1.05)} ${f(cx)} ${f(cy - s * 0.42)} ` +
                `C${f(cx + s * 0.95)} ${f(cy - s * 1.05)} ${f(cx + s * 1.35)} ${f(cy + s * 0.05)} ${f(cx)} ${f(cy + s * 0.95)}Z`;
            return `<path d="${d}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"` : ''}/>`;
        },
        // Soft glossy highlight blob.
        gloss(cx, cy, rx, ry, rot = -25, opacity = 0.65) {
            return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${ry}" fill="#fff" opacity="${opacity}" transform="rotate(${rot} ${f(cx)} ${f(cy)})"/>`;
        },
        // Radial gradient definition, referenced as url(#id).
        radial(id, inner, outer, { cx = '38%', cy = '32%', r = '75%' } = {}) {
            return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${inner}"/><stop offset="1" stop-color="${outer}"/></radialGradient>`;
        },
        linear(id, top, bottom) {
            return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
        },
    };

    function register(def) {
        DEFS[def.id] = Object.assign({ frames: 16, delay: 80 }, def);
    }

    // Measure label once per sticker so the font size fits the canvas width.
    const labelSizeCache = {};
    function labelFontSize(def) {
        if (labelSizeCache[def.id]) return labelSizeCache[def.id];
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', '400');
        svg.setAttribute('height', '80');
        svg.style.cssText = 'position:absolute;left:-9999px;top:0';
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('font-family', FONT);
        text.setAttribute('font-size', String(LABEL.maxSize));
        text.setAttribute('word-spacing', String(LABEL.maxSize * LABEL.wordSpacing));
        if (def.letterSpacing) text.setAttribute('letter-spacing', String(def.letterSpacing));
        text.textContent = def.label;
        svg.appendChild(text);
        document.body.appendChild(svg);
        const w = text.getComputedTextLength();
        svg.remove();
        const size = Math.min(LABEL.maxSize, LABEL.maxSize * LABEL.maxWidth / w);
        labelSizeCache[def.id] = Math.floor(size * 10) / 10;
        return labelSizeCache[def.id];
    }

    function labelSvg(def, t, uid) {
        const P = def.palette;
        const fs = labelFontSize(def);
        const a = def.labelAnim ? def.labelAnim(t, H) : {};
        const dx = a.dx || 0, dy = a.dy || 0, rot = a.rot || 0, sc = a.scale || 1;
        // Lift labels with descenders so g/y keep their white border inside the canvas.
        const base = /[gjpqy]/.test(def.label) ? LABEL.baseline - Math.round(fs * 0.18) : LABEL.baseline;
        const cx = SIZE / 2, cy = base - fs * 0.34;
        const common = `x="${cx}" y="${base}" text-anchor="middle" font-family="${FONT.replace(/"/g, '&quot;')}" font-size="${fs}"` +
            ` word-spacing="${f(fs * LABEL.wordSpacing)}"` +
            (def.letterSpacing ? ` letter-spacing="${def.letterSpacing}"` : '');
        return `<g transform="translate(${f(cx + dx)} ${f(cy + dy)}) rotate(${f(rot)}) scale(${f(sc)}) translate(${-cx} ${f(-cy)})">` +
            `<text ${common} fill="${P.textDark}" stroke="${P.textDark}" stroke-width="${f(fs * 0.24)}" stroke-linejoin="round">${def.label}</text>` +
            `<text ${common} fill="url(#lg-${uid})">${def.label}</text>` +
            `</g>`;
    }

    // One complete frame as an SVG string. uid keeps gradient ids unique per frame.
    function frameSvg(id, index) {
        const def = DEFS[id];
        const t = index / def.frames;
        const uid = `${id}-${index}`;
        const P = def.palette;
        const mascot = def.mascot(t, H, uid);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
            `<defs>` +
            // Die-cut sticker border: dilate the artwork alpha into a white rim with a faint grey edge.
            `<filter id="dc-${uid}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
            `<feMorphology in="SourceAlpha" operator="dilate" radius="4.2" result="outer"/>` +
            `<feGaussianBlur in="outer" stdDeviation="0.7" result="outerSoft"/>` +
            `<feComponentTransfer in="outerSoft" result="outerMask"><feFuncA type="linear" slope="3" intercept="-0.6"/></feComponentTransfer>` +
            `<feFlood flood-color="#d7d9e4"/><feComposite in2="outerMask" operator="in" result="rim"/>` +
            `<feMorphology in="SourceAlpha" operator="dilate" radius="3.2" result="inner"/>` +
            `<feGaussianBlur in="inner" stdDeviation="0.6" result="innerSoft"/>` +
            `<feComponentTransfer in="innerSoft" result="innerMask"><feFuncA type="linear" slope="3" intercept="-0.6"/></feComponentTransfer>` +
            `<feFlood flood-color="#ffffff"/><feComposite in2="innerMask" operator="in" result="white"/>` +
            `<feMerge><feMergeNode in="rim"/><feMergeNode in="white"/><feMergeNode in="SourceGraphic"/></feMerge>` +
            `</filter>` +
            H.linear(`lg-${uid}`, P.textLight, P.text) +
            (mascot.defs || '') +
            `</defs>` +
            `<g filter="url(#dc-${uid})">` +
            `<g transform="translate(${MASCOT.x} ${MASCOT.y}) scale(${MASCOT.scale})">${mascot.body}</g>` +
            labelSvg(def, t, uid) +
            `</g>` +
            `</svg>`;
    }

    function render() {
        const q = new URLSearchParams(location.search);
        const id = q.get('id');
        const mode = q.get('mode') || 'sheet';
        const def = DEFS[id];
        const root = document.getElementById('root');
        if (!def) {
            root.textContent = 'unknown sticker: ' + id;
            return;
        }
        document.title = `${id} ${def.frames} ${def.delay}`;
        if (mode === 'sheet') {
            // All frames in one row on a transparent page: build.mjs untiles them.
            root.style.cssText = `display:flex;width:${SIZE * def.frames}px;height:${SIZE}px`;
            for (let i = 0; i < def.frames; i++) root.insertAdjacentHTML('beforeend', frameSvg(id, i));
            return;
        }
        // Review sheet: frames at 1x on light and dark chat backgrounds, plus 3x zooms.
        document.body.style.background = '#ffffff';
        const perRow = 8;
        const rows = (bg) => {
            let html = `<div style="display:grid;grid-template-columns:repeat(${perRow},${SIZE}px);gap:6px;padding:8px;background:${bg}">`;
            for (let i = 0; i < def.frames; i++) html += frameSvg(id, i);
            return html + '</div>';
        };
        const zooms = [0, 0.25, 0.5, 0.75].map((k) => Math.floor(k * def.frames));
        let zoomHtml = `<div style="display:flex;gap:10px;padding:8px;background:#f3f4f8">`;
        zooms.forEach((i) => {
            zoomHtml += `<div style="width:${SIZE * 2}px;height:${SIZE * 2}px">` +
                frameSvg(id, i).replace(`width="${SIZE}" height="${SIZE}"`, `width="${SIZE * 2}" height="${SIZE * 2}"`) + '</div>';
        });
        zoomHtml += '</div>';
        root.innerHTML = rows('#ffffff') + rows('#1e1f24') + zoomHtml;
    }

    window.STK = { SIZE, FONT, H, register, render, DEFS, frameSvg };
})();
