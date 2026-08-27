import type { HeaderEntry, NetworkBody, NetworkEntry, NetworkFilter, NetworkRequestEvent, NetworkResponseEvent, TimelineEvent } from '../shared/types.js';

export const MAX_NETWORK_ENTRIES = 500;
export const MAX_RESPONSE_BODY_BYTES = 100 * 1024;

interface HarLikeRequest {
  startedDateTime?: string;
  time?: number;
  _resourceType?: string;
  request?: {
    method?: string;
    url?: string;
    headers?: HeaderEntry[];
    postData?: { text?: string };
  };
  response?: {
    status?: number;
    statusText?: string;
    headers?: HeaderEntry[];
  };
  getContent?: ((callback: (content?: string) => void) => unknown) | (() => Promise<string>);
}

function clampBody(text: string, limit = MAX_RESPONSE_BODY_BYTES): NetworkBody {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= limit) return { available: true, text, truncated: false };
  const truncated = new TextDecoder().decode(bytes.slice(0, limit));
  return { available: true, text: `${truncated}\n[truncated]`, truncated: true, reason: `Response body exceeded ${limit} bytes.` };
}

function unavailableBody(reason: string): NetworkBody {
  return { available: false, reason };
}

async function responseBody(request: HarLikeRequest): Promise<NetworkBody> {
  if (!request.getContent) return unavailableBody('DevTools did not provide getContent for this request.');
  try {
    const content = await new Promise<string | undefined>((resolve, reject) => {
      const returned = request.getContent!.call(request, (value?: string) => resolve(value));
      if (returned && typeof (returned as Promise<string>).then === 'function') {
        (returned as Promise<string>).then(resolve, reject);
      }
    });
    if (content === undefined) return unavailableBody('Response body was not available from DevTools.');
    return clampBody(content);
  } catch (error) {
    return unavailableBody(error instanceof Error ? error.message : String(error));
  }
}

function requestBody(request: HarLikeRequest): NetworkBody {
  const text = request.request?.postData?.text;
  return text === undefined ? unavailableBody('Request body is not included in DevTools HAR entries.') : clampBody(text);
}

function normalizeHeaders(headers?: HeaderEntry[]): HeaderEntry[] {
  return (headers ?? []).map((header) => ({ name: String(header.name), value: String(header.value) }));
}

export function matchesNetworkFilter(entry: NetworkEntry, filter: NetworkFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'fetch-xhr') return entry.resourceType === 'fetch' || entry.resourceType === 'xhr';
  if (filter === 'error-only') return Boolean(entry.error) || entry.status === 0 || entry.status >= 400;
  return entry.status >= 400;
}

export class NetworkCollector {
  private active = false;
  private entries: NetworkEntry[] = [];
  private readonly listener = (request: unknown) => { void this.record(request as HarLikeRequest); };

  constructor(
    private readonly onEntry: (entry: NetworkEntry, events: [NetworkRequestEvent, NetworkResponseEvent]) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(): void {
    if (this.active) return;
    this.entries = [];
    this.active = true;
    chrome.devtools.network.onRequestFinished.addListener(this.listener);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    chrome.devtools.network.onRequestFinished.removeListener(this.listener);
  }

  clear(): void {
    this.entries = [];
  }

  getEntries(): NetworkEntry[] {
    return this.entries.map((entry) => ({ ...entry, requestHeaders: [...entry.requestHeaders], responseHeaders: [...entry.responseHeaders], requestBody: { ...entry.requestBody }, responseBody: { ...entry.responseBody } }));
  }

  isActive(): boolean {
    return this.active;
  }

  private async record(request: HarLikeRequest): Promise<void> {
    if (!this.active) return;
    const id = `network-${crypto.randomUUID()}`;
    const timestamp = request.startedDateTime ?? new Date().toISOString();
    const performanceMs = Number(this.now().toFixed(3));
    const method = request.request?.method ?? 'UNKNOWN';
    const url = request.request?.url ?? 'Unknown URL';
    const status = Number(request.response?.status ?? 0);
    const durationMs = Number(request.time ?? 0);
    const body = await responseBody(request);
    if (!this.active) return;
    const entry: NetworkEntry = {
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
    if (this.entries.length > MAX_NETWORK_ENTRIES) this.entries.splice(0, this.entries.length - MAX_NETWORK_ENTRIES);
    const requestEvent: NetworkRequestEvent = { id: `${id}-request`, timestamp, performanceMs, kind: 'network-request', requestId: id, method, url, summary: `${method} ${url}` };
    const responseEvent: NetworkResponseEvent = { id: `${id}-response`, timestamp: new Date(Date.parse(timestamp) + durationMs).toISOString(), performanceMs: performanceMs + durationMs, kind: 'network-response', requestId: id, method, url, status, durationMs, summary: `${status} ${method} ${url} (${durationMs} ms)` };
    this.onEntry(entry, [requestEvent, responseEvent]);
  }
}
