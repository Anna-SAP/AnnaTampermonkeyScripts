'use strict';

// The toolbar badge shows the zoom level whenever it differs from the default,
// like Firefox's zoom indicator. Clicking the icon opens popup.html.

const EPSILON = 0.001;

chrome.action.setBadgeBackgroundColor({ color: '#5F6368' });
chrome.action.setBadgeTextColor({ color: '#FFFFFF' });

async function updateBadge(tabId) {
    try {
        const [zoom, settings] = await Promise.all([
            chrome.tabs.getZoom(tabId),
            chrome.tabs.getZoomSettings(tabId),
        ]);
        const isDefault = Math.abs(zoom - settings.defaultZoomFactor) < EPSILON;
        await chrome.action.setBadgeText({ tabId, text: isDefault ? '' : String(Math.round(zoom * 100)) });
    } catch {
        // The tab was closed, or it cannot be zoomed.
    }
}

async function updateAllTabs() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => updateBadge(tab.id)));
}

chrome.tabs.onZoomChange.addListener(({ tabId }) => updateBadge(tabId));
// Per-tab badge text is reset on navigation, and zoom is stored per site.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') updateBadge(tabId);
});
chrome.runtime.onInstalled.addListener(updateAllTabs);
chrome.runtime.onStartup.addListener(updateAllTabs);
