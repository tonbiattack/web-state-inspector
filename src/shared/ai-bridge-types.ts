import type { DebugError, DebugSessionStatus, NetworkEntry, StorageChangeEvent, TimelineEvent } from './types.js';

export const AI_BRIDGE_VERSION = '1.0';
export const AI_BRIDGE_TIMEOUT_MS = 5_000;
export const AI_BRIDGE_DEFAULT_LIMIT = 50;
export const AI_BRIDGE_MAX_LIMIT = 200;

export type BridgeMethod = 'getSummary' | 'getErrors' | 'getNetworkErrors' | 'getTimeline';
export type BridgeTimelineType = 'user-action' | 'route-change' | 'storage-change' | 'network' | 'error';
export interface DebugSummary { recording: boolean; url: string; startedAt?: string; elapsedMs?: number; userActions: number; routeChanges: number; storageChanges: number; networkRequests: number; networkErrors: number; javascriptErrors: number; snapshots: number; }
export interface BridgeRequest { source: 'web-state-inspector-page'; type: 'request'; requestId: string; method: BridgeMethod; params?: { limit?: number; eventTypes?: BridgeTimelineType[] }; }
export interface BridgeError { code: 'NOT_RECORDING' | 'UNKNOWN_METHOD' | 'INVALID_REQUEST' | 'WEB_STATE_INSPECTOR_TIMEOUT'; message: string; }
export interface BridgeResponse { source: 'web-state-inspector-extension'; type: 'response'; requestId: string; success: boolean; data?: DebugSummary | DebugError[] | NetworkEntry[] | TimelineEvent[]; error?: BridgeError; }
export interface BridgeStateSource { getStatus(): DebugSessionStatus; getUrl(): string; getErrors(): DebugError[]; getNetwork(): NetworkEntry[]; getTimeline(): TimelineEvent[]; getStorageChanges(): Promise<StorageChangeEvent[]>; getSnapshotCount(): number; }
