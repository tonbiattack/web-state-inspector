import type { DebugError, DebugSessionStatus, NetworkEntry, RouteChangeEvent, StorageChangeEvent, TimelineEvent, UserActionEvent } from '../shared/types.js';
import { ChangeTracker } from './change-tracker.js';
import { ErrorCollector } from './error-collector.js';
import { NetworkCollector } from './network-collector.js';
import { InteractionTracker } from './interaction-tracker.js';

export const MAX_TIMELINE_EVENTS = 1000;

export class DebugSession {
  private active = false;
  private startedAt: string | undefined;
  private readonly timeline: TimelineEvent[] = [];
  private readonly seenStorageEventIds = new Set<number>();
  private readonly seenErrorIds = new Set<string>();
  private readonly seenUserActionIds = new Set<string>();
  private readonly seenRouteChangeIds = new Set<string>();
  private storagePollId: number | undefined;
  private errors: DebugError[] = [];
  private userActions: UserActionEvent[] = [];
  private routeChanges: RouteChangeEvent[] = [];
  private readonly network: NetworkCollector;

  constructor(
    private readonly storageTracker: ChangeTracker,
    private readonly errorCollector: ErrorCollector,
    now: () => number = () => performance.now(),
    private readonly interactionTracker?: InteractionTracker,
  ) {
    this.network = new NetworkCollector((entry, events) => {
      if (!this.active) return;
      this.addEvents(events);
    }, now);
  }

  async start(): Promise<{ ok: boolean; data?: DebugSessionStatus; error?: string }> {
    if (this.active) return { ok: true, data: this.status() };
    await this.storageTracker.clear();
    await this.errorCollector.clear();
    await this.interactionTracker?.clear();
    const storage = await this.storageTracker.start(MAX_TIMELINE_EVENTS);
    if (!storage.ok) return { ok: false, error: storage.error ?? 'Storage change tracking could not start.' };
    const errors = await this.errorCollector.start();
    if (!errors.ok) {
      await this.storageTracker.stop();
      return { ok: false, error: errors.error ?? 'JavaScript error tracking could not start.' };
    }
    if (this.interactionTracker) {
      const interactions = await this.interactionTracker.start();
      if (!interactions.ok) {
        await Promise.all([this.storageTracker.stop(), this.errorCollector.stop()]);
        return { ok: false, error: interactions.error ?? 'User action tracking could not start.' };
      }
    }
    this.clearLocal();
    this.active = true;
    this.startedAt = new Date().toISOString();
    this.network.start();
    this.storagePollId = window.setInterval(() => { void this.refreshDerivedEvents(); }, 400);
    return { ok: true, data: this.status() };
  }

  async stop(): Promise<{ ok: boolean; data?: DebugSessionStatus; error?: string }> {
    await this.refreshDerivedEvents();
    this.active = false;
    if (this.storagePollId !== undefined) window.clearInterval(this.storagePollId);
    this.storagePollId = undefined;
    this.network.stop();
    const [storage, errors, interactions] = await Promise.all([this.storageTracker.stop(), this.errorCollector.stop(), this.interactionTracker?.stop() ?? Promise.resolve<{ ok: boolean; error?: string }>({ ok: true })]);
    if (!storage.ok || !errors.ok || !interactions.ok) return { ok: false, error: storage.error ?? errors.error ?? interactions.error ?? 'Debug recording could not stop cleanly.' };
    return { ok: true, data: this.status() };
  }

  async clear(): Promise<{ ok: boolean; data?: DebugSessionStatus; error?: string }> {
    const [storage, errors, interactions] = await Promise.all([this.storageTracker.clear(), this.errorCollector.clear(), this.interactionTracker?.clear() ?? Promise.resolve<{ ok: boolean; error?: string }>({ ok: true })]);
    if (!storage.ok || !errors.ok || !interactions.ok) return { ok: false, error: storage.error ?? errors.error ?? interactions.error ?? 'Debug recording could not be cleared.' };
    this.network.clear();
    this.clearLocal();
    if (this.active) this.startedAt = new Date().toISOString();
    return { ok: true, data: this.status() };
  }

  async refresh(): Promise<void> {
    await this.refreshDerivedEvents();
  }

  getStatus(): DebugSessionStatus {
    return this.status();
  }

  getTimeline(): TimelineEvent[] {
    // Network callback and page-side hooks run in different execution contexts.
    // Their performance.now() origins are not comparable, so use the wall-clock ISO timestamp.
    return this.timeline.slice().sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  getNetwork(): NetworkEntry[] {
    return this.network.getEntries();
  }

  getErrors(): DebugError[] {
    return this.errors.map((error) => ({ ...error, stack: [...error.stack] }));
  }

  async getUserActions(): Promise<UserActionEvent[]> {
    const result = await this.interactionTracker?.getSnapshot();
    return result?.ok && result.data ? result.data.actions.map((event) => ({ ...event, target: { ...event.target } })) : [];
  }

  async getRouteChanges(): Promise<RouteChangeEvent[]> {
    const result = await this.interactionTracker?.getSnapshot();
    return result?.ok && result.data ? result.data.routes.map((event) => ({ ...event })) : [];
  }

  async getStorageChanges(): Promise<StorageChangeEvent[]> {
    const result = await this.storageTracker.getSnapshot();
    return result.ok && result.data ? result.data.events.map((event) => ({ ...event, stack: [...event.stack] })) : [];
  }

  private async refreshDerivedEvents(): Promise<void> {
    if (!this.active) return;
    const [storage, errors, interactions] = await Promise.all([this.storageTracker.getSnapshot(), this.errorCollector.getErrors(), this.interactionTracker?.getSnapshot() ?? Promise.resolve(undefined)]);
    if (storage.ok && storage.data) {
      for (const event of storage.data.events) {
        if (this.seenStorageEventIds.has(event.id)) continue;
        this.seenStorageEventIds.add(event.id);
        this.addEvents([{
          id: `storage-${event.id}`,
          timestamp: event.timestamp,
          performanceMs: event.performanceMs,
          kind: 'storage',
          summary: `${event.storageArea}.${event.key ?? 'clear'}: ${event.oldValue ?? 'null'} → ${event.newValue ?? 'null'}`,
          storage: { ...event, stack: [...event.stack] },
        }]);
      }
    }
    if (interactions?.ok && interactions.data) {
      this.userActions = interactions.data.actions.map((event) => ({ ...event, target: { ...event.target } }));
      this.routeChanges = interactions.data.routes.map((event) => ({ ...event }));
      for (const event of this.userActions) {
        if (this.seenUserActionIds.has(event.id)) continue;
        this.seenUserActionIds.add(event.id);
        this.addEvents([{ ...event }]);
      }
      for (const event of this.routeChanges) {
        if (this.seenRouteChangeIds.has(event.id)) continue;
        this.seenRouteChangeIds.add(event.id);
        this.addEvents([{ ...event }]);
      }
    }
    if (errors.ok && errors.data) {
      this.errors = errors.data.map((error) => ({ ...error, stack: [...error.stack] }));
      for (const error of errors.data) {
        if (this.seenErrorIds.has(error.id)) continue;
        this.seenErrorIds.add(error.id);
        this.addEvents([{
          id: `error-${error.id}`,
          timestamp: error.timestamp,
          performanceMs: error.performanceMs,
          kind: error.kind,
          summary: error.message,
          error: { ...error, stack: [...error.stack] },
        }]);
      }
    }
  }

  /** Add events originating outside the normal poll cycle (e.g. frame lifecycle events from the background service worker). */
  addExternalEvents(events: TimelineEvent[]): void {
    if (!this.active) return;
    this.addEvents(events);
  }

  private addEvents(events: TimelineEvent[]): void {
    this.timeline.push(...events);
    if (this.timeline.length > MAX_TIMELINE_EVENTS) this.timeline.splice(0, this.timeline.length - MAX_TIMELINE_EVENTS);
  }

  private clearLocal(): void {
    this.timeline.length = 0;
    this.seenStorageEventIds.clear();
    this.seenErrorIds.clear();
    this.seenUserActionIds.clear();
    this.seenRouteChangeIds.clear();
    this.errors = [];
    this.userActions = [];
    this.routeChanges = [];
  }

  private status(): DebugSessionStatus {
    return {
      active: this.active,
      startedAt: this.startedAt,
      eventCount: this.timeline.length,
      networkCount: this.network.getEntries().length,
      errorCount: this.errors.length,
      userActionCount: this.userActions.length,
      routeChangeCount: this.routeChanges.length,
    };
  }
}
