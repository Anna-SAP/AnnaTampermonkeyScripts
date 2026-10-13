'use strict';

// Chromium's preset zoom levels, i.e. the same steps as Ctrl + Plus / Minus.
const LEVELS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const EPSILON = 0.001;

const zoomOut = document.getElementById('zoom-out');
const zoomIn = document.getElementById('zoom-in');
const zoomLevel = document.getElementById('zoom-level');
const message = document.getElementById('message');

let tabId = null;

function render(zoom) {
    zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
    zoomOut.disabled = zoom <= LEVELS[0] + EPSILON;
    zoomIn.disabled = zoom >= LEVELS[LEVELS.length - 1] - EPSILON;
}

function disable(text) {
    for (const button of [zoomOut, zoomLevel, zoomIn]) button.disabled = true;
    message.textContent = text;
    message.hidden = false;
}

async function setZoom(factor) {
    try {
        // A factor of 0 resets the tab to the default zoom level.
        await chrome.tabs.setZoom(tabId, factor);
    } catch {
        disable('此页面不支持缩放');
    }
}

async function step(direction) {
    if (tabId === null) return;
    const zoom = await chrome.tabs.getZoom(tabId);
    const next = direction > 0
        ? LEVELS.find((level) => level > zoom + EPSILON)
        : LEVELS.findLast((level) => level < zoom - EPSILON);
    if (next !== undefined) await setZoom(next);
}

zoomOut.addEventListener('click', () => step(-1));
zoomIn.addEventListener('click', () => step(1));
zoomLevel.addEventListener('click', () => setZoom(0));

document.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') step(1);
    else if (event.key === '-' || event.key === '_') step(-1);
    else if (event.key === '0') setZoom(0);
    else return;
    event.preventDefault();
});

chrome.tabs.onZoomChange.addListener((info) => {
    if (info.tabId === tabId) render(info.newZoomFactor);
});

(async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        render(await chrome.tabs.getZoom(tab.id));
        tabId = tab.id;
    } catch {
        disable('此页面不支持缩放');
    }
})();
