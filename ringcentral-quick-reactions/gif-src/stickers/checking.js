// "checking" — minty blob peers through a big magnifying glass, scanning left and right.
STK.register({
    id: 'checking',
    label: 'checking',
    frames: 16,
    delay: 80,
    palette: { text: '#1e88e5', textLight: '#7cc8ff', textDark: '#0b2d5c' },
    labelAnim(t, H) {
        // Sway gently with the scan.
        const dir = -Math.cos(H.TAU * t);
        return { rot: 1.2 * dir, dy: 0.8 * H.wave(t, 2, 0.25), scale: 1 + 0.02 * H.wave(t, 2) };
    },
    mascot(t, H, uid) {
        const { f } = H;
        const ink = '#0b3d3a';
        const eyeInk = '#082b29';
        const limb = '#5fdccd';
        // Scan: -1 = looking left (t=0), +1 = looking right (t=0.5).
        const dir = -Math.cos(H.TAU * t);
        const lean = 6 * dir;
        const fx = 7 * dir;
        // Lens rides with the face; handle angles down-right to the hand.
        const L = [65 + fx, 45];
        const ang = 56 * Math.PI / 180;
        const along = (r) => [L[0] + r * Math.cos(ang), L[1] + r * Math.sin(ang)];
        const hs = along(20), he = along(43), hand = along(35.5);
        // Glint when the glass crosses the middle.
        const g = H.clamp(1 - Math.abs(dir) * 1.6, 0, 1);
        // Floating "?" bob.
        const qy = 1.2 * H.wave(t, 2);
        const qr = -12 + 6 * dir;
        const defs = H.radial(`chk-body-${uid}`, '#b8fff0', '#35d0c0') +
            H.radial(`chk-lens-${uid}`, '#ffffff', '#c6f3ff', { cx: '35%', cy: '30%', r: '80%' }) +
            `<clipPath id="chk-clip-${uid}"><circle cx="0" cy="0" r="12.4"/></clipPath>`;
        const handleLine = `M${f(hs[0])} ${f(hs[1])} L${f(he[0])} ${f(he[1])}`;
        const armPath = `M78 80 Q${f(hand[0] - 2)} ${f(hand[1] + 8)} ${f(hand[0])} ${f(hand[1])}`;
        const qPath = 'M-4.5 -4 Q-4.5 -10 1 -10 Q6.5 -10 6.5 -5 Q6.5 -1.5 1.5 0.5 L1.2 3.5';
        const body =
            // Curious "?" above the head.
            `<g transform="translate(14 ${f(21 + qy)}) rotate(${f(qr)})">` +
            `<path d="${qPath}" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
            `<circle cx="1.2" cy="10" r="4" fill="${ink}"/>` +
            `<path d="${qPath}" fill="none" stroke="#3aa0ff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>` +
            `<circle cx="1.2" cy="10" r="2" fill="#3aa0ff"/>` +
            `</g>` +
            `<g transform="rotate(${f(lean)} 50 92)">` +
            // Left arm stub.
            `<ellipse cx="17" cy="72" rx="8" ry="6" fill="${limb}" stroke="${ink}" stroke-width="2.4" transform="rotate(25 17 72)"/>` +
            // Body.
            `<ellipse cx="50" cy="60" rx="36" ry="33" fill="url(#chk-body-${uid})" stroke="${ink}" stroke-width="2.8"/>` +
            H.gloss(33, 40, 9, 5) +
            // Face: raised brow over the free eye, blush, small curious mouth.
            H.eye(34 + fx, 57, { color: eyeInk, look: [0.8 * dir, 0] }) +
            `<path d="M${f(29 + fx)} 47 Q${f(34 + fx)} 43.5 ${f(39 + fx)} 46.5" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>` +
            // Opaque-ish pink so the 64-colour palette keeps it pink on teal (0.55 quantised to grey).
            H.blush(29 + fx, 67, { color: '#ff86a8', opacity: 0.85 }) +
            H.blush(63 + fx, 74, { color: '#ff86a8', opacity: 0.85 }) +
            `<ellipse cx="${f(47 + fx)}" cy="73.5" rx="4.4" ry="4" fill="#9c2f3a" stroke="${ink}" stroke-width="2"/>` +
            `<ellipse cx="${f(47 + fx)}" cy="75.4" rx="2.6" ry="1.4" fill="#ff7a8a"/>` +
            // Arm up to the handle.
            `<path d="${armPath}" fill="none" stroke="${ink}" stroke-width="11.5" stroke-linecap="round"/>` +
            `<path d="${armPath}" fill="none" stroke="${limb}" stroke-width="6.7" stroke-linecap="round"/>` +
            // Handle with a light stripe.
            `<path d="${handleLine}" fill="none" stroke="${ink}" stroke-width="11" stroke-linecap="round"/>` +
            `<path d="${handleLine}" fill="none" stroke="#1e6fd0" stroke-width="6.4" stroke-linecap="round"/>` +
            `<path d="${handleLine}" fill="none" stroke="#6fc0ff" stroke-width="1.8" stroke-linecap="round" transform="translate(-1.6 1.1)"/>` +
            // Lens: glass, magnified eye, glare, then the rim.
            `<g transform="translate(${f(L[0])} ${f(L[1])})">` +
            `<circle cx="0" cy="0" r="13" fill="url(#chk-lens-${uid})"/>` +
            `<g clip-path="url(#chk-clip-${uid})">` +
            H.eye(2.4 * dir, 1.5, { rx: 7.6, ry: 9.4, color: eyeInk, look: [0.6 * dir, 0] }) +
            `</g>` +
            `<path d="M-9 -3.5 A9.5 9.5 0 0 1 -3.5 -9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".9"/>` +
            `<circle cx="0" cy="0" r="17.2" fill="none" stroke="${ink}" stroke-width="10"/>` +
            `<circle cx="0" cy="0" r="17.2" fill="none" stroke="#56b4ff" stroke-width="5.4"/>` +
            `<path d="M-12.5 -9.5 A16 16 0 0 1 -5 -15.5" fill="none" stroke="#c9ecff" stroke-width="1.6" stroke-linecap="round"/>` +
            (g > 0.02 ? H.sparkle(15, -16, f(2.5 + 5.5 * g), '#fff6b0', ink) : '') +
            `</g>` +
            // Mitten hand wrapped around the handle.
            `<g transform="translate(${f(hand[0])} ${f(hand[1])}) rotate(56)">` +
            `<ellipse cx="0" cy="0" rx="5.5" ry="7.2" fill="${limb}" stroke="${ink}" stroke-width="2.4"/>` +
            // Two finger creases wrapping across the handle.
            `<path d="M-1.7 -2.2 L-1.7 2.4 M1.9 -2.2 L1.9 2.4" stroke="${ink}" stroke-width="1.1" stroke-linecap="round"/>` +
            `</g>` +
            `</g>`;
        return { defs, body };
    },
});
