export const MAX_NETWORK_ENTRIES = 500;
export const MAX_RESPONSE_BODY_BYTES = 100 * 1024;
function clampBody(text, limit = MAX_RESPONSE_BODY_BYTES) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength <= limit)
        return { available: true, text, truncated: false };
    const truncated = new TextDecoder().decode(bytes.slice(0, limit));
    return { available: true, text: `${truncated}\n[truncated]`, truncated: true, reason: `Response body exceeded ${limit} bytes.` };
}
function unavailableBody(reason) {
    return { available: false, reason };
}
async function responseBody(request) {
    if (!request.getContent)
        return unavailableBody('DevTools did not provide getContent for this request.');
    try {
        const content = await new Promise((resolve, reject) => {
            const returned = request.getContent.call(request, (value) => resolve(value));
            if (returned && typeof returned.then === 'function') {
                returned.then(resolve, reject);
            }
        });
        if (content === undefined)
            return unavailableBody('Response body was not available from DevTools.');
        return clampBody(content);
    }
    catch (error) {
        return unavailableBody(error instanceof Error ? error.message : String(error));
    }
}
function requestBody(request) {
    const text = request.request?.postData?.text;
    return text === undefined ? unavailableBody('Request body is not included in DevTools HAR entries.') : clampBody(text);
}
function normalizeHeaders(headers) {
    return (headers ?? []).map((header) => ({ name: String(header.name), value: String(header.value) }));
}
function normalizedTimestamp(value) {
    return value && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString();
}
function nonNegativeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
export function matchesNetworkFilter(entry, filter) {
    if (filter === 'all')
        return true;
    if (filter === 'fetch-xhr')
        return entry.resourceType === 'fetch' || entry.resourceType === 'xhr';
    if (filter === 'error-only')
        return Boolean(entry.error) || entry.status === 0 || entry.status >= 400;
    return entry.status >= 400;
}
export class NetworkCollector {
    onEntry;
    now;
    active = false;
    generation = 0;
    entries = [];
    listener = (request) => { void this.record(request); };
    constructor(onEntry, now = () => performance.now()) {
        this.onEntry = onEntry;
        this.now = now;
    }
    start() {
        if (this.active)
            return;
        this.entries = [];
        this.generation += 1;
        this.active = true;
        chrome.devtools.network.onRequestFinished.addListener(this.listener);
    }
    stop() {
        if (!this.active)
            return;
        this.generation += 1;
        this.active = false;
        chrome.devtools.network.onRequestFinished.removeListener(this.listener);
    }
    clear() {
        this.generation += 1;
        this.entries = [];
    }
    getEntries() {
        return this.entries.map((entry) => ({ ...entry, requestHeaders: [...entry.requestHeaders], responseHeaders: [...entry.responseHeaders], requestBody: { ...entry.requestBody }, responseBody: { ...entry.responseBody } }));
    }
    isActive() {
        return this.active;
    }
    async record(request) {
        if (!this.active)
            return;
        const generation = this.generation;
        const id = `network-${crypto.randomUUID()}`;
        const timestamp = normalizedTimestamp(request.startedDateTime);
        const performanceMs = Number(this.now().toFixed(3));
        const method = request.request?.method ?? 'UNKNOWN';
        const url = request.request?.url ?? 'Unknown URL';
        const status = nonNegativeNumber(request.response?.status);
        const durationMs = nonNegativeNumber(request.time);
        const body = await responseBody(request);
        if (!this.active || generation !== this.generation)
            return;
        const entry = {
            id,
            timestamp,
            performanceMs,
            method,
            url,
            status,
            statusText: request.response?.statusText ?? '',
            durationMs,
            requestHeaders: normalizeHeaders(request.request?.headers),
            requestBody: requestBody(request),
            responseHeaders: normalizeHeaders(request.response?.headers),
            responseBody: body,
            resourceType: request._resourceType?.toLowerCase(),
            error: status === 0 ? 'Network request did not receive an HTTP response.' : undefined,
        };
        this.entries.push(entry);
        if (this.entries.length > MAX_NETWORK_ENTRIES)
            this.entries.splice(0, this.entries.length - MAX_NETWORK_ENTRIES);
        const requestEvent = { id: `${id}-request`, timestamp, performanceMs, kind: 'network-request', requestId: id, method, url, summary: `${method} ${url}` };
        const responseEvent = { id: `${id}-response`, timestamp: new Date(Date.parse(timestamp) + durationMs).toISOString(), performanceMs: performanceMs + durationMs, kind: 'network-response', requestId: id, method, url, status, durationMs, summary: `${status} ${method} ${url} (${durationMs} ms)` };
        this.onEntry(entry, [requestEvent, responseEvent]);
    }
}
