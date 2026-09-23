// Build quick-reaction sticker GIFs.
//   node build.mjs                 -> every sticker in ./stickers
//   node build.mjs onit working    -> only those
//   node build.mjs --preview onit  -> also write ../preview/<id>.png review sheets
// Needs Microsoft Edge or Google Chrome (headless screenshot) and ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '..', 'gifs');
const PREVIEW_DIR = path.resolve(HERE, '..', 'preview');
const SIZE = 160;
const MAX_COLORS = 64;

const BROWSERS = [
    process.env.CHROME_PATH,
    // Chrome first: managed Edge installs often block --headless.
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
].filter(Boolean);

function findBrowser() {
    const hit = BROWSERS.find((p) => fs.existsSync(p));
    if (!hit) throw new Error('No Edge/Chrome found; set CHROME_PATH.');
    return hit;
}

function stickerMeta(id) {
    const src = fs.readFileSync(path.join(HERE, 'stickers', `${id}.js`), 'utf8');
    const frames = Number((src.match(/frames:\s*(\d+)/) || [])[1] || 16);
    const delay = Number((src.match(/delay:\s*(\d+)/) || [])[1] || 80);
    return { frames, delay };
}

function screenshot(browser, url, width, height, outFile) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-sticker-'));
    try {
        execFileSync(browser, [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            `--user-data-dir=${profile}`,
            '--force-device-scale-factor=1',
            '--default-background-color=00000000',
            '--virtual-time-budget=4000',
            `--window-size=${width},${height}`,
            `--screenshot=${outFile}`,
            url,
        ], { stdio: 'pipe', timeout: 60000 });
    } finally {
        fs.rmSync(profile, { recursive: true, force: true });
    }
    if (!fs.existsSync(outFile)) throw new Error(`screenshot failed: ${url}`);
}

// ffmpeg writes "do not dispose" frames; switch every frame to "restore to
// background" so transparent pixels never show the previous frame through.
function setDisposalRestoreBackground(file) {
    const b = fs.readFileSync(file);
    let p = 13;
    const gctFlag = b[10] & 0x80;
    if (gctFlag) p += 3 * (1 << ((b[10] & 0x07) + 1));
    const skipSubBlocks = () => { while (b[p] !== 0) p += b[p] + 1; p += 1; };
    let patched = 0;
    while (p < b.length) {
        const tag = b[p];
        if (tag === 0x21) {
            const label = b[p + 1];
            if (label === 0xf9) {
                b[p + 3] = (b[p + 3] & ~0x1c) | (2 << 2);
                patched++;
            }
            p += 2;
            skipSubBlocks();
        } else if (tag === 0x2c) {
            const packed = b[p + 9];
            p += 10;
            if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1));
            p += 1; // LZW minimum code size
            skipSubBlocks();
        } else if (tag === 0x3b) {
            break;
        } else {
            throw new Error(`unexpected GIF block 0x${tag.toString(16)} at ${p}`);
        }
    }
    fs.writeFileSync(file, b);
    return patched;
}

// Decode the finished GIF and fail if any frame paints the outermost pixel
// ring: that means the artwork or its die-cut border was clipped.
function assertEdgesClear(file) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
        { maxBuffer: 64 * 1024 * 1024 });
    const frameBytes = SIZE * SIZE * 4;
    const hits = [];
    for (let fi = 0; fi * frameBytes < raw.length; fi++) {
        const base = fi * frameBytes;
        const alpha = (x, y) => raw[base + (y * SIZE + x) * 4 + 3];
        let n = 0;
        for (let i = 0; i < SIZE; i++) {
            if (alpha(i, 0)) n++;
            if (alpha(i, SIZE - 1)) n++;
            if (alpha(0, i)) n++;
            if (alpha(SIZE - 1, i)) n++;
        }
        if (n) hits.push(`frame ${fi}: ${n}px`);
    }
    if (hits.length) throw new Error(`${path.basename(file)} touches the canvas edge (${hits.join(', ')})`);
}

function buildGif(browser, id, tmp) {
    const { frames, delay } = stickerMeta(id);
    const sheet = path.join(tmp, `${id}-sheet.png`);
    const url = `${pathToFileURL(path.join(HERE, 'render.html')).href}?id=${id}&mode=sheet`;
    screenshot(browser, url, SIZE * frames, SIZE, sheet);
    const out = path.join(OUT_DIR, `${id}.gif`);
    const graph = [
        `[0:v]untile=${frames}x1,settb=1/1000,setpts=N*${delay},split[a][b]`,
        `[a]palettegen=max_colors=${MAX_COLORS}:reserve_transparent=1:stats_mode=full[p]`,
        `[b][p]paletteuse=dither=none:alpha_threshold=128`,
    ].join(';');
    execFileSync('ffmpeg', [
        '-y', '-v', 'error', '-i', sheet,
        '-filter_complex', graph,
        '-fps_mode', 'vfr', '-gifflags', '0', '-loop', '0', out,
    ], { stdio: 'pipe' });
    const patched = setDisposalRestoreBackground(out);
    assertEdgesClear(out);
    const kb = (fs.statSync(out).size / 1024).toFixed(1);
    console.log(`${id}.gif  ${SIZE}x${SIZE}  ${frames} frames x ${delay}ms  ${kb} KB  (disposal patched: ${patched})`);
}

function buildPreview(browser, id) {
    const { frames } = stickerMeta(id);
    const rows = Math.ceil(frames / 8);
    const gridH = rows * SIZE + (rows - 1) * 6 + 16;
    const width = 8 * SIZE + 7 * 6 + 16;
    const height = gridH * 2 + SIZE * 2 + 16;
    const out = path.join(PREVIEW_DIR, `${id}.png`);
    const url = `${pathToFileURL(path.join(HERE, 'render.html')).href}?id=${id}&mode=preview`;
    screenshot(browser, url, width, height, out);
    console.log(`preview -> ${out}`);
}

const args = process.argv.slice(2);
const preview = args.includes('--preview');
let ids = args.filter((a) => !a.startsWith('--'));
if (!ids.length) ids = fs.readdirSync(path.join(HERE, 'stickers')).filter((n) => n.endsWith('.js')).map((n) => n.slice(0, -3));

const browser = findBrowser();
fs.mkdirSync(OUT_DIR, { recursive: true });
if (preview) fs.mkdirSync(PREVIEW_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-sticker-build-'));
try {
    for (const id of ids) {
        buildGif(browser, id, tmp);
        if (preview) buildPreview(browser, id);
    }
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
