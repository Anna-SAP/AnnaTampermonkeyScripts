// "thank you" — lavender blob presses its paws together and bows gratefully.
STK.register({
    id: 'thankyou',
    label: 'thank you',
    frames: 16,
    delay: 80,
    palette: { text: '#8a4dff', textLight: '#caa8ff', textDark: '#2e1466' },
    labelAnim(t, H) {
        // Nod along with the bow.
        const b = H.easeInOut(H.seg(t, 0.1, 0.4)) - H.easeInOut(H.seg(t, 0.62, 0.92));
        return { scale: 1 + 0.02 * b, dy: 1.2 * b };
    },
    mascot(t, H, uid) {
        const { f } = H;
        const ink = '#2e1466';
        const paw = '#dccaff';
        const arm = '#c09bff';
        // Bow: dip forward, hold, rise back; 0 at both ends so the loop is seamless.
        const b = H.easeInOut(H.seg(t, 0.1, 0.4)) - H.easeInOut(H.seg(t, 0.62, 0.92));
        // A front-facing blob reads a big rotation as a sideways lean, so the bow is
        // mostly a squash plus the face and tuft sliding down (head pitching forward).
        const tilt = -3 * b;
        const sx = 1 + 0.03 * b, sy = 1 - 0.08 * b;
        const dip = 4.5 * b;
        const faceY = 6.5 * b;
        const handY = 3 * b;
        const tuftY = 5 * b;
        // Twinkling stars at different phases; never shrink below ~70% so they stay stars at 1x.
        const star = (x, y, r, phase) => {
            const k = 0.5 + 0.5 * H.wave(t, 1, phase);
            return `<g transform="translate(${x} ${y}) rotate(${f(25 * k)}) scale(${f(0.7 + 0.3 * k)})">` +
                H.sparkle(0, 0, r, '#ffd84d', ink) + `</g>`;
        };
        // Tiny heart pops out at the bottom of the bow and floats up.
        const hk = H.seg(t, 0.32, 0.96);
        const heartS = hk <= 0 ? 0 : (hk < 0.25 ? H.easeOutBack(hk / 0.25) : 1 - H.easeInOut(H.seg(hk, 0.8, 1)));
        const heart = heartS > 0.25
            ? `<g transform="translate(${f(84 + 2.5 * H.wave(hk, 1))} ${f(27.5 - 19 * hk)}) scale(${f(heartS)}) rotate(12)">` +
                H.heart(0, 0, 7, '#ff5c93', ink, 2) + `</g>`
            : '';
        // Open grin while upright; a small closed smile once the face has slid down to the paws.
        const mouth = b > 0.5
            ? `<path d="M46 55 Q50 59 54 55" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`
            : `<path d="M44.5 55 Q50 64 55.5 55 Z" fill="#5a1f6e" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>` +
              `<path d="M47 59 Q50 61.8 53 59 Q50 57.5 47 59Z" fill="#ff7a9c"/>`;
        const armL = 'M17 63 Q13 88 41 85';
        const armR = 'M83 63 Q87 88 59 85';
        const defs = H.radial(`thankyou-body-${uid}`, '#efe3ff', '#b58cff');
        const body =
            star(8, 22, 8, 0) + star(104, 44, 7, 0.4) +
            heart +
            `<g transform="translate(0 ${f(dip)}) translate(50 92) rotate(${f(tilt)}) scale(${f(sx)} ${f(sy)}) translate(-50 -92)">` +
            // Hair tuft.
            `<path d="M49 ${f(25 + tuftY)} Q46 ${f(15 + tuftY)} 54 ${f(13 + tuftY)} Q60 ${f(13 + tuftY)} 57 ${f(19 + tuftY)}" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>` +
            // Body.
            `<ellipse cx="50" cy="58" rx="37" ry="34" fill="url(#thankyou-body-${uid})" stroke="${ink}" stroke-width="2.8"/>` +
            H.gloss(35, f(38 + 4 * b), 10, 5.5) +
            // Face: happy closed eyes, blush, smile.
            `<g transform="translate(0 ${f(faceY)})">` +
            H.closedEye(36, 48, { w: 11, h: 5, color: ink, sw: 2.7 }) +
            H.closedEye(64, 48, { w: 11, h: 5, color: ink, sw: 2.7 }) +
            H.blush(27, 56, { rx: 5.5 }) + H.blush(73, 56, { rx: 5.5 }) +
            mouth +
            `</g>` +
            // Arms hug in from the sides: ink under a body-coloured stroke.
            `<g transform="translate(0 ${f(handY)})">` +
            `<path d="${armL}" fill="none" stroke="${ink}" stroke-width="10.5" stroke-linecap="round"/>` +
            `<path d="${armR}" fill="none" stroke="${ink}" stroke-width="10.5" stroke-linecap="round"/>` +
            `<path d="${armL}" fill="none" stroke="${arm}" stroke-width="5.7" stroke-linecap="round"/>` +
            `<path d="${armR}" fill="none" stroke="${arm}" stroke-width="5.7" stroke-linecap="round"/>` +
            // Paws pressed together, fingertips up (like the prayer-hands emoji).
            `<ellipse cx="45.2" cy="76" rx="6.8" ry="10.5" fill="${paw}" stroke="${ink}" stroke-width="2.4" transform="rotate(13 45.2 76)"/>` +
            `<ellipse cx="54.8" cy="76" rx="6.8" ry="10.5" fill="${paw}" stroke="${ink}" stroke-width="2.4" transform="rotate(-13 54.8 76)"/>` +
            H.gloss(43.5, 71.5, 1.8, 3.4, 13, 0.75) +
            `</g>` +
            `</g>`;
        return { defs, body };
    },
});
