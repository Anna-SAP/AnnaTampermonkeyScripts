// "on it" — sunny blob snaps a salute, winks, and sparks with energy.
STK.register({
    id: 'onit',
    label: 'on it',
    frames: 16,
    delay: 80,
    palette: { text: '#ff9f0a', textLight: '#ffd84d', textDark: '#5a3500' },
    labelAnim(t, H) {
        // One continuous pop as the salute lands; back to rest well before the loop seam.
        // The small lift keeps the popped, tilted label off the bottom edge.
        const pop = Math.sin(Math.PI * H.seg(t, 0.1, 0.42));
        return { scale: 1 + 0.06 * pop, rot: -2.5 * pop, dy: -1.5 * pop };
    },
    mascot(t, H, uid) {
        const { f } = H;
        const ink = '#5a3500';
        // Arm rests for two frames, snaps into a salute (slight overshoot), holds, then lowers
        // smoothly back to rest so the loop seam is continuous.
        const up = t < 0.75 ? H.easeOutBack(H.seg(t, 0.06, 0.28)) : 1 - H.easeInOut(H.seg(t, 0.8, 1));
        // Tremble only while the salute holds, windowed so it fades in/out without a jump.
        const tremble = 0.7 * H.wave(t, 4) * Math.sin(Math.PI * H.seg(t, 0.28, 0.8));
        // Mid-swing the hand arcs out to the side so it never sweeps across the face.
        const swing = Math.sin(Math.PI * H.clamp(up, 0, 1));
        const shoulder = [82, 66];
        const elbow = [H.lerp(92, 101, up) + 5 * swing, H.lerp(76, 50, up)];
        const hand = [H.lerp(84, 73.5, up) + 13 * swing, H.lerp(82, 35.5, up) + tremble];
        const handRot = H.lerp(35, -22, up);
        const armPath = `M${f(shoulder[0])} ${f(shoulder[1])} Q${f(elbow[0])} ${f(elbow[1])} ${f(hand[0])} ${f(hand[1])}`;
        // Body hop: squash on landing, stretch while rising.
        const hop = Math.max(0, H.wave(t, 1, 0.25));
        const bodyY = 60 - 3 * hop;
        const sx = 1 + 0.03 * (1 - hop), sy = 1 - 0.03 * (1 - hop);
        // Energy bolt flicker.
        const flash = 0.55 + 0.45 * Math.abs(H.wave(t, 2));
        const boltScale = 0.9 + 0.15 * Math.abs(H.wave(t, 2, 0.1));
        const defs = H.radial(`onit-body-${uid}`, '#fff27a', '#ffc21a');
        const body =
            // Energy lines + bolt behind the head.
            `<g opacity="${f(flash)}" stroke="#ff9f0a" stroke-width="3" stroke-linecap="round">` +
            `<line x1="87" y1="22" x2="95" y2="15"/><line x1="92" y1="33" x2="100" y2="31"/><line x1="78" y1="13" x2="80.6" y2="5.2"/>` +
            `</g>` +
            `<g transform="translate(17 22) scale(${f(boltScale)}) rotate(-14)">` +
            `<path d="M2 -13 L-7 2 L-1 2 L-4 13 L7 -3 L1 -3 L4 -13Z" fill="#ffdd33" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>` +
            `</g>` +
            `<g transform="translate(50 ${f(bodyY)}) scale(${f(sx)} ${f(sy)}) translate(-50 -60)">` +
            // Left arm stub.
            `<ellipse cx="17" cy="70" rx="8" ry="6" fill="#ffcc2e" stroke="${ink}" stroke-width="2.4" transform="rotate(25 17 70)"/>` +
            // Body.
            `<ellipse cx="50" cy="60" rx="36" ry="33" fill="url(#onit-body-${uid})" stroke="${ink}" stroke-width="2.8"/>` +
            H.gloss(36, 40, 10, 5.5) +
            // Face: open eye + wink, blush, big grin.
            H.eye(40, 58, { color: '#2b1d12' }) +
            `<path d="M56 58 Q61.5 52 67 58" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>` +
            H.blush(33, 68) + H.blush(69, 68) +
            `<path d="M43 67 Q51.5 79 60 67 Z" fill="#9c2f14" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>` +
            `<path d="M47 72.5 Q51.5 76.5 56 72.5 Q51.5 70.5 47 72.5Z" fill="#ff7a6b"/>` +
            `</g>` +
            // Saluting arm: ink stroke under a body-coloured stroke reads as an outlined limb.
            `<path d="${armPath}" fill="none" stroke="${ink}" stroke-width="11.5" stroke-linecap="round"/>` +
            `<path d="${armPath}" fill="none" stroke="#ffcc2e" stroke-width="6.7" stroke-linecap="round"/>` +
            // Flat mitten hand with a thumb, fingers pointing to the brow.
            `<g transform="translate(${f(hand[0])} ${f(hand[1])}) rotate(${f(handRot)})">` +
            `<ellipse cx="0" cy="0" rx="9.5" ry="6" fill="#ffcc2e" stroke="${ink}" stroke-width="2.4"/>` +
            `<ellipse cx="4" cy="-5.2" rx="3.4" ry="2.6" fill="#ffcc2e" stroke="${ink}" stroke-width="2" transform="rotate(-20 4 -5.2)"/>` +
            `<path d="M-5.5 -1.6 L1.5 -1.6 M-5.5 1.8 L1.5 1.8" stroke="${ink}" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>` +
            `</g>`;
        return { defs, body };
    },
});
