function formatExpiry(expirationDate) {
    if (!expirationDate)
        return 'Session';
    return new Date(expirationDate * 1000).toISOString();
}
function toCookieEntry(cookie) {
    return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: formatExpiry(cookie.expirationDate),
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
    };
}
// ── Frame tree cache ──────────────────────────────────────────────────────────
// Keyed by tabId → Map<frameId, FrameInfo>.
// Rebuilt from chrome.webNavigation.getAllFrames on demand and updated
// incrementally on onCommitted events.
const frameCache = new Map();
function originFromUrl(url) {
    try {
        return new URL(url).origin;
    }
    catch {
        return url;
    }
}
function buildFrameInfo(tabId, frameId, parentFrameId, url) {
    const isMainFrame = frameId === 0;
    const origin = originFromUrl(url);
    let isCrossOrigin;
    if (!isMainFrame) {
        const tabFrames = frameCache.get(tabId);
        const mainFrame = tabFrames?.get(0);
        if (mainFrame?.origin) {
            isCrossOrigin = origin !== mainFrame.origin;
        }
    }
    return {
        frameId,
        parentFrameId: frameId === 0 ? undefined : parentFrameId,
        url,
        origin,
        isMainFrame,
        isCrossOrigin,
    };
}
async function refreshFrameCache(tabId) {
    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        if (!frames)
            return;
        const map = new Map();
        for (const frame of frames) {
            map.set(frame.frameId, buildFrameInfo(tabId, frame.frameId, frame.parentFrameId, frame.url));
        }
        frameCache.set(tabId, map);
    }
    catch {
        // Tab may have closed; ignore.
    }
}
function emitFrameLifecycleEvent(tabId, kind, frameInfo, fromUrl) {
    const event = {
        id: `frame-${kind}-${tabId}-${String(frameInfo.frameId)}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        performanceMs: 0,
        kind,
        frame: frameInfo,
        summary: `${kind}: ${frameInfo.url}`,
        fromUrl,
        toUrl: kind !== 'frame-removed' ? frameInfo.url : undefined,
    };
    chrome.runtime.sendMessage({ type: 'FRAME_LIFECYCLE_EVENT', tabId, event }).catch(() => undefined);
}
// Listen for frame navigations and emit lifecycle events.
chrome.webNavigation.onCommitted.addListener((details) => {
    const { tabId, frameId, parentFrameId = -1, url } = details;
    const tabFrames = frameCache.get(tabId);
    const existing = tabFrames?.get(frameId);
    const frameInfo = buildFrameInfo(tabId, frameId, parentFrameId, url);
    if (!tabFrames) {
        frameCache.set(tabId, new Map([[frameId, frameInfo]]));
    }
    else {
        tabFrames.set(frameId, frameInfo);
    }
    // Refresh full frame cache async to pick up sibling frames.
    void refreshFrameCache(tabId);
    if (existing) {
        // Frame already known — this is a navigation within the frame.
        emitFrameLifecycleEvent(tabId, 'frame-navigated', frameInfo, existing.url);
    }
    else {
        // New frame — emit frame-added.
        emitFrameLifecycleEvent(tabId, 'frame-added', frameInfo);
    }
});
// Detect frame removal by comparing frame snapshots when new navigations happen.
// chrome.webNavigation has no direct "frame removed" event; we approximate by
// rebuilding the cache and diffing against the previous snapshot.
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    const { tabId, frameId } = details;
    if (frameId !== 0)
        return; // Only top-level navigations clear the frame tree significantly.
    const tabFrames = frameCache.get(tabId);
    if (!tabFrames)
        return;
    // Emit frame-removed for all non-main iframes before the top-level navigation.
    for (const [id, info] of tabFrames.entries()) {
        if (id !== 0)
            emitFrameLifecycleEvent(tabId, 'frame-removed', info);
    }
    frameCache.delete(tabId);
});
// Clean up cache when a tab is closed.
chrome.tabs.onRemoved.addListener((tabId) => { frameCache.delete(tabId); });
// ── Existing cookie handler ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'GET_COOKIES')
        return;
    const cookieRequest = message;
    if (typeof cookieRequest.url !== 'string')
        return;
    let parsedUrl;
    try {
        parsedUrl = new URL(cookieRequest.url);
    }
    catch {
        sendResponse({ ok: false, error: 'このページのURLはCookie APIで利用できません。' });
        return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        sendResponse({ ok: false, error: 'Cookieの表示はHTTP/HTTPSページで利用できます。' });
        return;
    }
    chrome.cookies
        .getAll({ url: parsedUrl.href })
        .then((cookies) => {
        sendResponse({
            ok: true,
            data: cookies
                .map(toCookieEntry)
                .sort((a, b) => a.name.localeCompare(b.name)),
        });
    })
        .catch((error) => {
        sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Cookieの取得に失敗しました。',
        });
    });
    return true;
});
export {};
