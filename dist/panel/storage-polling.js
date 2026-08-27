export function isStorageList(id) {
    return id === 'local-storage' || id === 'session-storage';
}
/**
 * Storage一覧を必要な場合に限り更新する。ユーザー指定のAuto Refreshを優先し、
 * Timelineの記録中は一覧を700ms間隔で追従させる。
 */
export class StoragePollingController {
    getConfig;
    refreshInBackground;
    schedule;
    cancel;
    intervalId;
    constructor(getConfig, refreshInBackground, schedule = window.setInterval.bind(window), cancel = window.clearInterval.bind(window)) {
        this.getConfig = getConfig;
        this.refreshInBackground = refreshInBackground;
        this.schedule = schedule;
        this.cancel = cancel;
    }
    sync() {
        this.stop();
        const config = this.getConfig();
        if (!isStorageList(config.selected) || (!config.autoRefreshEnabled && !config.changeTrackingActive))
            return;
        const interval = config.autoRefreshEnabled ? config.autoRefreshIntervalMs : 700;
        this.intervalId = this.schedule(() => {
            const current = this.getConfig();
            if (!current.loading && isStorageList(current.selected))
                this.refreshInBackground();
        }, interval);
    }
    stop() {
        if (this.intervalId !== undefined)
            this.cancel(this.intervalId);
        this.intervalId = undefined;
    }
}
