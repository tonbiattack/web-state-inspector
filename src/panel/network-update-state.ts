import type { NetworkEntry } from '../shared/types.js';

/** Keeps a stable Network view while recording continues in the background. */
export class NetworkUpdateState {
  private frozenEntries: NetworkEntry[] | undefined;

  get paused(): boolean {
    return this.frozenEntries !== undefined;
  }

  pause(entries: NetworkEntry[]): void {
    this.frozenEntries = [...entries];
  }

  resume(): void {
    this.frozenEntries = undefined;
  }

  entries(liveEntries: NetworkEntry[]): NetworkEntry[] {
    return this.frozenEntries ?? liveEntries;
  }

  pendingCount(liveEntries: NetworkEntry[]): number {
    return Math.max(0, liveEntries.length - (this.frozenEntries?.length ?? liveEntries.length));
  }
}
