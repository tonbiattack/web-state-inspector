export class FrameTrackingRegistry {
    activeTabIds = new Set();
    start(tabId) {
        this.activeTabIds.add(tabId);
    }
    stop(tabId) {
        this.activeTabIds.delete(tabId);
    }
    isActive(tabId) {
        return this.activeTabIds.has(tabId);
    }
}
