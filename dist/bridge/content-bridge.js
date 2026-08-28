const PAGE_SOURCE = 'web-state-inspector-page';
const EXTENSION_SOURCE = 'web-state-inspector-extension';
function isRequest(value) { const request = value; return Boolean(request && request.source === PAGE_SOURCE && request.type === 'request' && typeof request.requestId === 'string' && typeof request.method === 'string'); }
function injectPageApi() { const script = document.createElement('script'); script.src = chrome.runtime.getURL('bridge/page-bridge.js'); script.async = false; (document.head || document.documentElement).append(script); script.remove(); }
injectPageApi();
window.addEventListener('message', (event) => {
    if (event.source !== window || !isRequest(event.data))
        return;
    chrome.runtime.sendMessage({ type: 'WEB_STATE_INSPECTOR_BRIDGE_REQUEST', request: event.data }).then((response) => {
        if (response)
            window.postMessage(response, location.origin);
    }).catch(() => undefined);
});
// Kept explicit so malformed runtime broadcasts cannot become page responses.
void EXTENSION_SOURCE;
export {};
