import type { BridgeRequest, BridgeResponse } from '../shared/ai-bridge-types.js';

const PAGE_SOURCE = 'web-state-inspector-page';
const EXTENSION_SOURCE = 'web-state-inspector-extension';

function isRequest(value: unknown): value is BridgeRequest { const request = value as Partial<BridgeRequest>; return Boolean(request && request.source === PAGE_SOURCE && request.type === 'request' && typeof request.requestId === 'string' && typeof request.method === 'string'); }
function injectPageApi(): void {
  if (document.documentElement.dataset.webStateInspectorBridge === '1') return;
  document.documentElement.dataset.webStateInspectorBridge = '1';
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('bridge/page-bridge.js');
  script.async = false;
  // Removing an external script immediately after append can cancel its fetch on some pages.
  script.addEventListener('load', () => script.remove(), { once: true });
  script.addEventListener('error', () => { delete document.documentElement.dataset.webStateInspectorBridge; script.remove(); }, { once: true });
  (document.head || document.documentElement).append(script);
}

injectPageApi();
window.addEventListener('message', (event) => {
  if (event.source !== window || !isRequest(event.data)) return;
  chrome.runtime.sendMessage({ type: 'WEB_STATE_INSPECTOR_BRIDGE_REQUEST', request: event.data }).then((response: BridgeResponse | undefined) => {
    if (response) window.postMessage(response, location.origin);
  }).catch(() => undefined);
});
// Kept explicit so malformed runtime broadcasts cannot become page responses.
void EXTENSION_SOURCE;
