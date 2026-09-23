// "love it" — glossy heart buddy thumps a lub-dub heartbeat, cheers, and puffs out little hearts.

// Heartbeat envelope 0..1: strong "lub", soft "dub", then a long rest (keys are frame-aligned).
function loveitBeat(t, H) {
    const keys = [[0, 0.2], [0.0625, 1], [0.125, 0.3], [0.1875, 0.22], [0.25, 0.75], [0.3125, 0.18], [0.375, 0], [0.9375, 0], [1, 0.2]];
    for (let i = 1; i < keys.length; i++) {
        const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
        if (t <= t1) return H.lerp(v0, v1, H.easeInOut((t - t0) / (t1 - t0)));
    }
    return 0;
}

STK.register({
    id: 'loveit',
    label: 'love it',
    frames: 16,
    delay: 80,
    palette: { text: '#ff3d6e', textLight: '#ff9ab5', textDark: '#5c0a24' },
    labelAnim(t, H) {
        // Label thumps along with the heartbeat.
        return { scale: 1 + 0.035 * loveitBeat(t, H) };
    },
    mascot(t, H, uid) {
        const { f } = H;
        const ink = '#5c0a24';
        const limb = '#ff5c86';
        const b = loveitBeat(t, H);
        // Pump: widen a touch more than it grows tall, anchored at the body centre.
        const sx = 1 + 0.12 * b, sy = 1 + 0.09 * b;
        const bob = b > 0.05 ? 0 : 1.2 * H.wave(t, 1, 0.1);
        // Stubby arms pop out of the lower sides in a "yay!", kicking up on each beat and waving at rest.
        const raise = 11 * b + 8 * H.wave(t, 2, 0.25);
        const arm = (side) => {
            const sh = [50 + side * 20, 72];
            const a = (side < 0 ? 200 + raise : -20 - raise) * Math.PI / 180;
            const hand = [sh[0] + 27 * Math.cos(a), sh[1] + 27 * Math.sin(a)];
            const ctl = [sh[0] + side * 16, sh[1] + 3];
            const d = `M${f(sh[0])} ${f(sh[1])} Q${f(ctl[0])} ${f(ctl[1])} ${f(hand[0])} ${f(hand[1])}`;
            return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>` +
                `<path d="${d}" fill="none" stroke="${limb}" stroke-width="5.4" stroke-linecap="round"/>` +
                `<circle cx="${f(hand[0])}" cy="${f(hand[1])}" r="4.8" fill="${limb}" stroke="${ink}" stroke-width="2.2"/>`;
        };
        // Little hearts drift up from behind the body; they grow in and shrink out so the loop is seamless.
        const floaters = [
            { off: 0, from: [26, 30], to: [12, 7], s: 6.5 },
            { off: 1 / 3, from: [74, 28], to: [90, 7], s: 7.5 },
            { off: 2 / 3, from: [50, 32], to: [50, 7], s: 5.5 },
        ].map(({ off, from, to, s }) => {
            const p = (t + off) % 1;
            const k = Math.min(1, p / 0.2) * Math.min(1, (1 - p) / 0.25);
            const r = s * H.easeInOut(k);
            if (r < 1.6) return '';
            const x = H.lerp(from[0], to[0], p) + 2.5 * Math.sin(H.TAU * p * 1.5);
            const y = H.lerp(from[1], to[1], p);
            return H.heart(x, y, r, '#ff5c86', ink, 1.8) + `<circle cx="${f(x - r * 0.42)}" cy="${f(y - r * 0.28)}" r="${f(r * 0.2)}" fill="#fff" opacity=".85"/>`;
        }).join('');
        // Twinkles beside the lobes.
        const tw1 = 6.5 * (0.35 + 0.65 * Math.abs(H.wave(t, 2)));
        const tw2 = 5.5 * (0.35 + 0.65 * Math.abs(H.wave(t, 2, 0.25)));
        // Eyes: glossy and sparkling, one quick happy blink during the rest.
        const blink = t > 0.66 && t < 0.72;
        const eyes = blink
            ? H.closedEye(37.5, 53, { color: ink, w: 10 }) + H.closedEye(62.5, 53, { color: ink, w: 10 })
            : H.eye(37.5, 52, { rx: 5.2, ry: 6.4, color: '#3d0a1c' }) + H.eye(62.5, 52, { rx: 5.2, ry: 6.4, color: '#3d0a1c' });
        const heartPath = 'M50 34 C46 25 38 22 31 22 C20 22 12 31 12 45 C12 64 34 80 46 91 Q50 95 54 91 ' +
            'C66 80 88 64 88 45 C88 31 80 22 69 22 C62 22 54 25 50 34Z';
        const defs = H.radial(`loveit-body-${uid}`, '#ffc4d4', '#ff3d6e', { cx: '38%', cy: '30%', r: '78%' });
        const body =
            floaters +
            `<g transform="translate(50 ${f(60 + bob)}) scale(${f(sx)} ${f(sy)}) translate(-50 -60)">` +
            arm(-1) + arm(1) +
            // Body.
            `<path d="${heartPath}" fill="url(#loveit-body-${uid})" stroke="${ink}" stroke-width="2.8" stroke-linejoin="round"/>` +
            H.gloss(27, 33, 8, 4.5, -38) + H.gloss(76, 30, 3, 2, -30, 0.55) +
            // Face: sparkling eyes, rosy cheeks, open happy mouth.
            eyes +
            H.blush(28, 63, { rx: 5, ry: 3, color: '#ff2a5f', opacity: 0.55 }) +
            H.blush(72, 63, { rx: 5, ry: 3, color: '#ff2a5f', opacity: 0.55 }) +
            `<path d="M42.5 62 Q50 77 57.5 62 Z" fill="#8a1530" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>` +
            `<path d="M46 68 Q50 72 54 68 Q50 66 46 68Z" fill="#ff8fab"/>` +
            `</g>` +
            H.sparkle(103, 30, tw1, '#ffe45c', ink) +
            H.sparkle(-3, 26, tw2, '#ffe45c', ink);
        return { defs, body };
    },
});
