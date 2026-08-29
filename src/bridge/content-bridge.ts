import type { BridgeRequest, BridgeResponse } from '../shared/ai-bridge-types.js';

const PAGE_SOURCE = 'web-state-inspector-page';
const EXTENSION_SOURCE = 'web-state-inspector-extension';

// Stable per-frame ID — generated once and persisted on documentElement so the
// injected page-bridge script in the same frame can read it.
const FRAME_ID_ATTR = 'webStateInspectorFrameId';
function getOrCreateFrameId(): string {
  let id = document.documentElement.dataset[FRAME_ID_ATTR];
  if (!id) {
    id = crypto.randomUUID();
    document.documentElement.dataset[FRAME_ID_ATTR] = id;
  }
  return id;
}

function computeIsMainFrame(): boolean {
  try { return window === window.top; } catch { return false; }
}

function computeIsCrossOrigin(): boolean {
  try {
    // Accessing top.location throws for cross-origin frames.
    void window.top?.location.href;
    return false;
  } catch {
    return true;
  }
}

// Expose frameId to the injected page-bridge script via a dataset attribute
// before injecting so page-bridge can read document.documentElement.dataset.webStateInspectorFrameId.
getOrCreateFrameId();

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

// Only inject the page-level bridge API (for __WEB_STATE_INSPECTOR__) in the main frame to
// avoid polluting iframe JS contexts with the diagnostic namespace.
if (computeIsMainFrame()) {
  injectPageApi();
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !isRequest(event.data)) return;
  chrome.runtime.sendMessage({ type: 'WEB_STATE_INSPECTOR_BRIDGE_REQUEST', request: event.data }).then((response: BridgeResponse | undefined) => {
    if (response) window.postMessage(response, location.origin);
  }).catch(() => undefined);
});

// Send a frame-registered notification to the background so it can correlate
// this content-script frameId with the chrome.webNavigation frameId.
void chrome.runtime.sendMessage({
  type: 'FRAME_REGISTERED',
  frameId: getOrCreateFrameId(),
  isMainFrame: computeIsMainFrame(),
  isCrossOrigin: computeIsCrossOrigin(),
  url: location.href,
  origin: location.origin,
}).catch(() => undefined);

// Kept explicit so malformed runtime broadcasts cannot become page responses.
void EXTENSION_SOURCE;
