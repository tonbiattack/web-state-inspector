import { AI_BRIDGE_DEFAULT_LIMIT, AI_BRIDGE_MAX_LIMIT } from '../shared/ai-bridge-types.js';
import type { BridgeRequest, BridgeResponse, BridgeStateSource, BridgeTimelineType } from '../shared/ai-bridge-types.js';
import type { TimelineEvent } from '../shared/types.js';

function limit(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(AI_BRIDGE_MAX_LIMIT, Math.max(1, Math.floor(parsed))) : AI_BRIDGE_DEFAULT_LIMIT; }
function failure(requestId: string, code: 'NOT_RECORDING' | 'UNKNOWN_METHOD' | 'INVALID_REQUEST', message: string): BridgeResponse { return { source: 'web-state-inspector-extension', type: 'response', requestId, success: false, error: { code, message } }; }
function eventType(event: TimelineEvent): BridgeTimelineType { if (event.kind === 'storage') return 'storage-change'; if (event.kind.startsWith('network-')) return 'network'; if (event.kind === 'user-action' || event.kind === 'route-change') return event.kind; return 'error'; }

export async function handleBridgeRequest(request: BridgeRequest, source: BridgeStateSource): Promise<BridgeResponse> {
  if (!request || typeof request.requestId !== 'string' || !request.requestId || typeof request.method !== 'string') return failure(request?.requestId ?? '', 'INVALID_REQUEST', 'Bridge request is invalid.');
  const status = source.getStatus();
  if (!status.active) return failure(request.requestId, 'NOT_RECORDING', 'Debug Recording is not running.');
  const boundedLimit = limit(request.params?.limit);
  if (request.method === 'getSummary') {
    const [storageChanges] = await Promise.all([source.getStorageChanges()]); const network = source.getNetwork();
    return { source: 'web-state-inspector-extension', type: 'response', requestId: request.requestId, success: true, data: { recording: status.active, url: source.getUrl(), startedAt: status.startedAt, elapsedMs: status.startedAt ? Math.max(0, Date.now() - Date.parse(status.startedAt)) : undefined, userActions: status.userActionCount, routeChanges: status.routeChangeCount, storageChanges: storageChanges.length, networkRequests: network.length, networkErrors: network.filter((entry) => Boolean(entry.error) || entry.status === 0 || entry.status >= 400).length, javascriptErrors: status.errorCount, snapshots: source.getSnapshotCount() } };
  }
  if (request.method === 'getErrors') return { source: 'web-state-inspector-extension', type: 'response', requestId: request.requestId, success: true, data: source.getErrors().slice(-boundedLimit) };
  if (request.method === 'getNetworkErrors') return { source: 'web-state-inspector-extension', type: 'response', requestId: request.requestId, success: true, data: source.getNetwork().filter((entry) => Boolean(entry.error) || entry.status === 0 || entry.status >= 400).slice(-boundedLimit) };
  if (request.method === 'getTimeline') {
    const types = request.params?.eventTypes; if (types && (!Array.isArray(types) || types.some((type) => !['user-action', 'route-change', 'storage-change', 'network', 'error'].includes(type)))) return failure(request.requestId, 'INVALID_REQUEST', 'eventTypes contains an unsupported value.');
    return { source: 'web-state-inspector-extension', type: 'response', requestId: request.requestId, success: true, data: source.getTimeline().filter((event) => !types || types.includes(eventType(event))).slice(-boundedLimit) };
  }
  return failure(request.requestId, 'UNKNOWN_METHOD', `Unsupported bridge method: ${request.method}`);
}
