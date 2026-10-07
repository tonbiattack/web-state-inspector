export class FrameTrackingRegistry {
  private readonly activeTabIds = new Set<number>();

  start(tabId: number): void {
    this.activeTabIds.add(tabId);
  }

  stop(tabId: number): void {
    this.activeTabIds.delete(tabId);
  }

  isActive(tabId: number): boolean {
    return this.activeTabIds.has(tabId);
  }
}
