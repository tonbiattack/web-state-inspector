export type NavigationId =
  | 'local-storage'
  | 'session-storage'
  | 'cookies'
  | 'indexeddb'
  | 'cache-storage'
  | 'change-timeline'
  | 'debug-timeline'
  | 'network'
  | 'errors'
  | 'snapshots'
  | 'ai-export'
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

export type DebugEventKind = 'storage' | 'network-request' | 'network-response' | 'javascript-error' | 'console-error' | 'console-warn' | 'promise-rejection' | 'user-action' | 'route-change';

export interface TimelineEventBase {
  id: string;
  timestamp: string;
  performanceMs: number;
  kind: DebugEventKind;
  summary: string;
}

export interface StorageTimelineEvent extends TimelineEventBase {
  kind: 'storage';
  storage: StorageChangeEvent;
}

export interface NetworkRequestEvent extends TimelineEventBase {
  kind: 'network-request';
  requestId: string;
  method: string;
  url: string;
}

export interface NetworkResponseEvent extends TimelineEventBase {
  kind: 'network-response';
  requestId: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
}

export interface DebugError {
  id: string;
  timestamp: string;
  performanceMs: number;
  kind: 'javascript-error' | 'console-error' | 'console-warn' | 'promise-rejection';
  message: string;
  stack: string[];
  sourceUrl?: string;
  line?: number;
  column?: number;
  duplicateCount: number;
}

export interface ErrorTimelineEvent extends TimelineEventBase {
  kind: 'javascript-error' | 'console-error' | 'console-warn' | 'promise-rejection';
  error: DebugError;
}

export interface ElementSummary {
  tagName: string;
  selector: string;
  id?: string;
  className?: string;
  name?: string;
  type?: string;
  text?: string;
  ariaLabel?: string;
  dataTestId?: string;
  value?: string;
}

export interface UserActionEvent extends TimelineEventBase {
  kind: 'user-action';
  actionType: 'click' | 'input' | 'change' | 'submit' | 'focus' | 'blur' | 'keydown';
  target: ElementSummary;
  key?: string;
}

export interface RouteChangeEvent extends TimelineEventBase {
  kind: 'route-change';
  routeType: 'pushState' | 'replaceState' | 'popstate' | 'hashchange';
  from: string;
  to: string;
}

export type TimelineEvent = StorageTimelineEvent | NetworkRequestEvent | NetworkResponseEvent | ErrorTimelineEvent | UserActionEvent | RouteChangeEvent;

export interface HeaderEntry {
  name: string;
  value: string;
}

export interface NetworkBody {
  available: boolean;
  text?: string;
  truncated?: boolean;
  reason?: string;
}

export interface NetworkEntry {
  id: string;
  timestamp: string;
  performanceMs: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  requestHeaders: HeaderEntry[];
  requestBody: NetworkBody;
  responseHeaders: HeaderEntry[];
  responseBody: NetworkBody;
  resourceType?: string;
  error?: string;
}

export type NetworkFilter = 'all' | 'fetch-xhr' | 'error-only' | 'http-error';

export interface PageEnvironment {
  userAgent: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  readyState: string;
}

export interface SnapshotPageInfo extends PageInfo {
  title: string;
}

export interface SelectedElementSnapshot {
  id: string;
  timestamp: string;
  summary: ElementSummary;
  textContent: string;
  attributes: Record<string, string>;
  dataset: Record<string, string>;
  disabled: boolean;
  hidden: boolean;
  aria: Record<string, string>;
  boundingClientRect: { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
  computedStyle: Record<string, string>;
}

export interface ReproductionNotes {
  expectedResult: string;
  actualResult: string;
  reproductionSteps: string;
  additionalNotes: string;
}

export interface DebugSnapshot {
  id: string;
  label: string;
  timestamp: string;
  page: SnapshotPageInfo;
  environment: PageEnvironment;
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  cookies: CookieEntry[];
  indexedDb: IndexedDbSummary[];
  cacheStorage: Array<{ name: string; totalEntries: number; truncated: boolean; error?: string }>;
  pinia: FrameworkState;
  tanstackQuery: FrameworkState;
}

export interface DiffEntry {
  path: string;
  before: unknown;
  after: unknown;
  kind: 'added' | 'removed' | 'changed';
}

export interface SnapshotDiff {
  beforeId: string;
  afterId: string;
  entries: DiffEntry[];
}

export interface DebugSessionStatus {
  active: boolean;
  startedAt?: string;
  eventCount: number;
  networkCount: number;
  errorCount: number;
  userActionCount: number;
  routeChangeCount: number;
}

export interface FocusedEventContext {
  anchor: TimelineEvent;
  beforeMs: number;
  afterMs: number;
  startTimestamp: string;
  endTimestamp: string;
}

export interface AiDebugContext {
  generatedAt: string;
  page?: SnapshotPageInfo;
  environment?: PageEnvironment;
  session: DebugSessionStatus;
  snapshots: { before?: DebugSnapshot; after?: DebugSnapshot; diff?: SnapshotDiff };
  network: NetworkEntry[];
  errors: DebugError[];
  storageChanges: StorageChangeEvent[];
  timeline: TimelineEvent[];
  userActions: UserActionEvent[];
  routeChanges: RouteChangeEvent[];
  selectedElements: SelectedElementSnapshot[];
  reproductionNotes: ReproductionNotes;
  focusedEvent?: FocusedEventContext;
}

export interface InteractionTrackingSnapshot {
  active: boolean;
  actionCount: number;
  routeCount: number;
  actions: UserActionEvent[];
  routes: RouteChangeEvent[];
}
