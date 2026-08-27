export type NavigationId =
  | 'local-storage'
  | 'session-storage'
  | 'cookies'
  | 'indexeddb'
  | 'cache-storage'
  | 'change-timeline'
  | 'pinia'
  | 'tanstack-query';

export interface StorageEntry {
  key: string;
  value: string;
  parsedValue?: unknown;
  isJson: boolean;
}

export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

export interface IndexedDbStoreSummary {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  recordCount?: number;
}

export interface IndexedDbSummary {
  name: string;
  version?: number;
  stores: IndexedDbStoreSummary[];
  error?: string;
}

export interface IndexedDbRecord {
  key: unknown;
  value: unknown;
}

export interface CacheEntry {
  url: string;
  method: string;
  status: number;
  statusText: string;
  responseType: string;
}

export interface CacheSummary {
  name: string;
  entries: CacheEntry[];
  totalEntries: number;
  truncated: boolean;
  error?: string;
}

export interface FrameworkState {
  detected: boolean;
  message: string;
  data?: unknown;
}

export interface InspectResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type StorageAreaName = 'localStorage' | 'sessionStorage';
export type StorageChangeOperation = 'setItem' | 'removeItem' | 'clear' | 'external-storage-event';

export interface ClearedStorageEntry {
  key: string;
  value: string;
}

export interface StorageChangeEvent {
  id: number;
  timestamp: string;
  performanceMs: number;
  storageArea: StorageAreaName;
  operation: StorageChangeOperation;
  key: string | null;
  oldValue: string | null;
  newValue: string | null;
  clearedEntries?: ClearedStorageEntry[];
  externalUrl?: string;
  stack: string[];
  outcome: 'changed' | 'unchanged' | 'error';
  error?: string;
}

export interface ChangeTrackerStatus {
  active: boolean;
  capacity: number;
  eventCount: number;
}

export interface ChangeTrackingSnapshot extends ChangeTrackerStatus {
  events: StorageChangeEvent[];
}

export interface PageInfo {
  url: string;
  origin: string;
}

export interface CookieRequest {
  type: 'GET_COOKIES';
  url: string;
}

export interface CookieResponse {
  ok: boolean;
  data?: CookieEntry[];
  error?: string;
}
