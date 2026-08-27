export type NavigationId =
  | 'local-storage'
  | 'session-storage'
  | 'cookies'
  | 'indexeddb'
  | 'cache-storage'
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
