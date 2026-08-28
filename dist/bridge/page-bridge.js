import { AI_BRIDGE_TIMEOUT_MS, AI_BRIDGE_VERSION } from '../shared/ai-bridge-types.js';
export function installPageBridge(target = window, timeoutMs = AI_BRIDGE_TIMEOUT_MS) {
    const call = (method, params) => {
        const requestId = target.crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timeout = target.setTimeout(() => { cleanup(); reject(Object.assign(new Error('Web State Inspector did not respond in time.'), { code: 'WEB_STATE_INSPECTOR_TIMEOUT' })); }, timeoutMs);
            const listener = (event) => { const response = event.data; if (event.source !== target || response?.source !== 'web-state-inspector-extension' || response.type !== 'response' || response.requestId !== requestId)
                return; cleanup(); response.success ? resolve(response.data) : reject(Object.assign(new Error(response.error?.message ?? 'Bridge request failed.'), { code: response.error?.code })); };
            const cleanup = () => { target.clearTimeout(timeout); target.removeEventListener('message', listener); };
            target.addEventListener('message', listener);
            target.postMessage({ source: 'web-state-inspector-page', type: 'request', requestId, method, params }, target.location.origin);
        });
    };
    // The inspected app may already use this explicit namespace for Pinia/TanStack diagnostics.
    // Augment it rather than replacing the app-owned read-only diagnostic bridge.
    target.__WEB_STATE_INSPECTOR__ = { ...(target.__WEB_STATE_INSPECTOR__ ?? {}), version: AI_BRIDGE_VERSION, isAvailable: () => true, getSummary: () => call('getSummary'), getErrors: (options) => call('getErrors', options), getNetworkErrors: (options) => call('getNetworkErrors', options), getTimeline: (options) => call('getTimeline', options) };
}
installPageBridge();
