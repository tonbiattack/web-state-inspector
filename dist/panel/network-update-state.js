/** Keeps a stable Network view while recording continues in the background. */
export class NetworkUpdateState {
    frozenEntries;
    get paused() {
        return this.frozenEntries !== undefined;
    }
    pause(entries) {
        this.frozenEntries = [...entries];
    }
    resume() {
        this.frozenEntries = undefined;
    }
    entries(liveEntries) {
        return this.frozenEntries ?? liveEntries;
    }
    pendingCount(liveEntries) {
        return Math.max(0, liveEntries.length - (this.frozenEntries?.length ?? liveEntries.length));
    }
}
