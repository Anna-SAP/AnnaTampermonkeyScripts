// "working" — orange tabby cat taps away at a little laptop while code types out on the glowing screen.
STK.register({
    id: 'working',
    label: 'working',
    frames: 12,
    delay: 90,
    palette: { text: '#ff8a1f', textLight: '#ffc266', textDark: '#5a2600' },
    labelAnim(t, H) {
        // Gentle bob in time with the typing. The bob only lifts (never drops below rest) and peaks exactly when the
        // sway tips the descending 'g' down, so the label's die-cut rim never reaches the canvas bottom.
        const bob = 0.5 - 0.5 * H.wave(t, 2, 0.25);
        return { dy: -1.2 * bob, rot: 1 * H.wave(t, 1), scale: 1 + 0.02 * bob };
    },
    mascot(t, H, uid) {
        const { f } = H;
        const ink = '#5a2600';
        const fur = '#ffa446';
        const stripe = '#e3701c';
        const cream = '#fff4e4';
        // Two typing beats per loop; in each beat one paw snaps up then taps down, then the other.
        const ph = (t * 2) % 1;
        const tap = (u) => (u > 0 && u < 1 ? Math.sin(Math.PI * Math.pow(u, 0.6)) : 0);
        const liftL = tap(ph * 2);
        const liftR = tap(ph * 2 - 1);
        // Head leans a touch toward whichever paw is working.
        const tilt = 1.5 * (liftR - liftL);
        // Tail swishes outward only, so it never crowds the body's die-cut edge.
        const tailRot = -6 + 7 * H.wave(t, 1);
        const dropY = 19 + 1.6 * H.wave(t, 1, 0.25);
        // Screen glow breathes with each keystroke.
        const glow = 0.5 + 0.2 * H.wave(t, 4, 0.25);

        // Laptop: lid is a skewed rectangle facing the cat, deck is a parallelogram in front of it.
        const LX = 64, LY = 43, LW = 38, LH = 30, SK = 12;
        const tan = Math.tan(SK * Math.PI / 180);
        const dx = -12, dy = 11;
        const P = (s, d) => [LX + LW * s + dx * d, LY + LH - LW * tan * s + dy * d];
        const pt = (p) => `${f(p[0])} ${f(p[1])}`;
        const quad = (a, b, c, d) => `M${pt(a)} L${pt(b)} L${pt(c)} L${pt(d)}Z`;
        const down = (p, k) => [p[0], p[1] + k];

        // Code: two lines typed per loop; the pattern repeats every two lines so the loop is seamless.
        const styles = [
            [[6, 11, '#ff9bd2'], [13.5, 22, '#ffffff'], [24.5, 29, '#ffe45c']],
            [[10, 16, '#ffe45c'], [18.5, 27, '#ffffff']],
        ];
        const line = Math.floor(t * 2);
        const typed = (Math.floor(ph * 6) + 1) / 6;
        let code = '';
        [8.5, 14.5, 20.5].forEach((y, r) => {
            const g = line - 2 + r;
            const segs = styles[((g % 2) + 2) % 2];
            const x0 = segs[0][0], x1 = segs[segs.length - 1][1];
            const end = r === 2 ? x0 + (x1 - x0) * typed : x1;
            segs.forEach(([a, b, c]) => {
                if (a >= end) return;
                code += `<line x1="${a}" y1="${y}" x2="${f(Math.min(b, end))}" y2="${y}" stroke="${c}"/>`;
            });
            if (r === 2) code += `<rect x="${f(end + 1.2)}" y="${y - 2.2}" width="2" height="4.4" fill="#fff"/>`;
        });

        const pawL = [60.5, 79.5 - 7 * liftL];
        const pawR = [75, 75.5 - 7 * liftR];
        // Ink stroke under a fur stroke reads as an outlined limb.
        const arm = (from, ctrl, to) => {
            const d = `M${pt(from)} Q${pt(ctrl)} ${pt(to)}`;
            return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>` +
                `<path d="${d}" fill="none" stroke="${fur}" stroke-width="5.4" stroke-linecap="round"/>`;
        };
        // Cream mitten paws so the taps stand out against the orange and grey.
        const paw = (p, rot) =>
            `<ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="6.8" ry="5.3" fill="${cream}" stroke="${ink}" stroke-width="2.2" transform="rotate(${f(rot)} ${pt(p)})"/>`;

        const defs =
            H.radial(`working-fur-${uid}`, '#ffd9a0', '#ff9a36') +
            H.linear(`working-scr-${uid}`, '#58b8ff', '#2556d4');
        const tailPath = 'M18 90 Q-2 92 -6 76 Q-9 64 0 58';
        const body =
            // Tail (behind everything), banded with dashes.
            `<g transform="rotate(${f(tailRot)} 18 90)">` +
            `<path d="${tailPath}" fill="none" stroke="${ink}" stroke-width="11" stroke-linecap="round"/>` +
            `<path d="${tailPath}" fill="none" stroke="${fur}" stroke-width="6.4" stroke-linecap="round"/>` +
            `<path d="${tailPath}" fill="none" stroke="${stripe}" stroke-width="6.4" stroke-dasharray="3 5" stroke-dashoffset="-6"/>` +
            `</g>` +
            // Laptop lid with glowing screen and code.
            `<g transform="translate(${LX} ${LY}) skewY(${-SK})">` +
            `<rect x="-4" y="-4" width="${LW + 8}" height="${LH + 6}" rx="8" fill="#9fdcff" opacity="${f(glow)}"/>` +
            `<rect x="0" y="0" width="${LW}" height="${LH}" rx="3.5" fill="#d3d8e2" stroke="${ink}" stroke-width="2.4"/>` +
            `<rect x="3" y="3" width="${LW - 6}" height="${LH - 8}" rx="1.8" fill="url(#working-scr-${uid})" stroke="${ink}" stroke-width="1.2"/>` +
            `<g stroke-width="2.6" stroke-linecap="round">${code}</g>` +
            `</g>` +
            // Laptop deck: slab sides, top face, keyboard.
            `<path d="M${pt(P(0, 0))} L${pt(P(1, 0))} L${pt(down(P(1, 0), 4))} L${pt(down(P(1, 1), 4))} L${pt(down(P(0, 1), 4))} L${pt(P(0, 1))}Z" fill="#a9b1bf" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
            `<path d="${quad(P(0, 0), P(1, 0), P(1, 1), P(0, 1))}" fill="#e2e6ed" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>` +
            `<path d="${quad(P(0.08, 0.14), P(0.92, 0.14), P(0.92, 0.58), P(0.08, 0.58))}" fill="#7c8596"/>` +
            // Body with cream belly and feet.
            `<ellipse cx="36" cy="78" rx="24" ry="18" fill="url(#working-fur-${uid})" stroke="${ink}" stroke-width="2.8"/>` +
            `<ellipse cx="36" cy="83" rx="12" ry="9.5" fill="${cream}"/>` +
            `<path d="M13.5 73 L19 74.5 M13 80.5 L18.5 81" stroke="${stripe}" stroke-width="3" stroke-linecap="round"/>` +
            `<ellipse cx="25" cy="94" rx="6.5" ry="4" fill="${cream}" stroke="${ink}" stroke-width="2.2"/>` +
            `<ellipse cx="44" cy="94.5" rx="6.5" ry="4" fill="${cream}" stroke="${ink}" stroke-width="2.2"/>` +
            // Arms reaching onto the keys.
            arm([51, 68], [62, 72], pawR) + paw(pawR, -14 + 10 * liftR) +
            arm([47, 77], [54, 80], pawL) + paw(pawL, -10 + 10 * liftL) +
            // Head.
            `<g transform="rotate(${f(tilt)} 40 62)">` +
            // Ears.
            `<path d="M15 29 L12.5 7 L35 17Z" fill="${fur}" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
            `<path d="M17.5 24 L16.3 13.5 L28 18Z" fill="#ff9fb0"/>` +
            `<path d="M44 16 L66.5 7 L62 28Z" fill="${fur}" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
            `<path d="M50 16 L61.8 13.5 L59.5 23Z" fill="#ff9fb0"/>` +
            `<ellipse cx="38" cy="38" rx="30" ry="25" fill="url(#working-fur-${uid})" stroke="${ink}" stroke-width="2.8"/>` +
            H.gloss(24, 23, 8, 4.5) +
            // Tabby stripes.
            `<path d="M34 16 L35.5 22.5 M41 15 L41 22 M48 16 L46.5 22.5 M10.5 36 L15.5 37.5 M10.5 42 L15 42.5" stroke="${stripe}" stroke-width="3" stroke-linecap="round"/>` +
            // Face turned toward the screen: eyes on the code, nose, w-mouth, tongue poking out in concentration.
            H.eye(32.5, 40, { color: '#2b1d12', look: [0.8, 0.5] }) +
            H.eye(55.5, 40, { color: '#2b1d12', look: [0.8, 0.5] }) +
            H.blush(24, 49) + H.blush(63, 48, { rx: 4 }) +
            `<ellipse cx="48.4" cy="53" rx="1.9" ry="2.7" fill="#ff7a8a" stroke="${ink}" stroke-width="1.5" transform="rotate(-35 48.4 53)"/>` +
            `<path d="M41 46.5 L47 46.5 L44 49.5Z" fill="#ff8fa3" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>` +
            `<path d="M44 49.5 L44 51 M39.5 50.5 Q41.8 53.5 44 51 Q46.2 53.5 48.5 50.5" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
            // Whiskers on the open cheek only: on the far cheek they would sit on the laptop's bezel and read as noise at 1x.
            `<path d="M13 47 L1 45 M13 51 L2 53.5" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>` +
            // Sweat drop of effort beside the ear.
            `<g transform="translate(73 ${f(dropY)})">` +
            `<path d="M0 -5.5 Q4.2 -0.5 4.2 2.2 A4.2 4.2 0 0 1 -4.2 2.2 Q-4.2 -0.5 0 -5.5Z" fill="#8fd8ff" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>` +
            `<ellipse cx="-1.4" cy="2" rx="1" ry="1.5" fill="#fff"/>` +
            `</g>` +
            `</g>`;
        return { defs, body };
    },
});
