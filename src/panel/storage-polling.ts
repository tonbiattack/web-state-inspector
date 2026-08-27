import type { NavigationId } from '../shared/types.js';

export interface StoragePollingConfig {
  selected: NavigationId;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMs: number;
  changeTrackingActive: boolean;
  loading: boolean;
}

export type IntervalScheduler = (callback: () => void, milliseconds: number) => number;
export type IntervalCanceller = (intervalId: number) => void;

export function isStorageList(id: NavigationId): id is 'local-storage' | 'session-storage' {
  return id === 'local-storage' || id === 'session-storage';
}

/**
 * Storage一覧を必要な場合に限り更新する。ユーザー指定のAuto Refreshを優先し、
 * Timelineの記録中は一覧を700ms間隔で追従させる。
 */
export class StoragePollingController {
  private intervalId: number | undefined;

  constructor(
    private readonly getConfig: () => StoragePollingConfig,
    private readonly refreshInBackground: () => void,
    private readonly schedule: IntervalScheduler = window.setInterval.bind(window),
    private readonly cancel: IntervalCanceller = window.clearInterval.bind(window),
  ) {}

  sync(): void {
    this.stop();
    const config = this.getConfig();
    if (!isStorageList(config.selected) || (!config.autoRefreshEnabled && !config.changeTrackingActive)) return;

    const interval = config.autoRefreshEnabled ? config.autoRefreshIntervalMs : 700;
    this.intervalId = this.schedule(() => {
      const current = this.getConfig();
      if (!current.loading && isStorageList(current.selected)) this.refreshInBackground();
    }, interval);
  }

  stop(): void {
    if (this.intervalId !== undefined) this.cancel(this.intervalId);
    this.intervalId = undefined;
  }
}
