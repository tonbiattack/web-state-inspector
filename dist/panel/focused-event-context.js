export const DEFAULT_CONTEXT_BEFORE_MS = 5_000;
export const DEFAULT_CONTEXT_AFTER_MS = 2_000;
function timestampMs(timestamp) {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function clampWindowMs(value, fallback) {
    return Number.isFinite(value) ? Math.max(0, Math.min(Math.round(value), 60_000)) : fallback;
}
function sortByTimestamp(entries) {
    return entries.slice().sort((left, right) => left.timestamp.localeCompare(right.timestamp) || String(left.id).localeCompare(String(right.id)));
}
export function isFailureTimelineEvent(event) {
    if (event.kind === 'network-response')
        return event.status === 0 || event.status >= 400;
    return event.kind === 'javascript-error' || event.kind === 'console-error' || event.kind === 'promise-rejection';
}
export function createFocusedEventWindow(anchor, beforeMs = DEFAULT_CONTEXT_BEFORE_MS, afterMs = DEFAULT_CONTEXT_AFTER_MS) {
    if (!isFailureTimelineEvent(anchor))
        return undefined;
    const anchorMs = timestampMs(anchor.timestamp);
    if (anchorMs === undefined)
        return undefined;
    const safeBeforeMs = clampWindowMs(beforeMs, DEFAULT_CONTEXT_BEFORE_MS);
    const safeAfterMs = clampWindowMs(afterMs, DEFAULT_CONTEXT_AFTER_MS);
    return {
        anchor,
        beforeMs: safeBeforeMs,
        afterMs: safeAfterMs,
        startTimestamp: new Date(anchorMs - safeBeforeMs).toISOString(),
        endTimestamp: new Date(anchorMs + safeAfterMs).toISOString(),
    };
}
export function filterTimelineAroundEvent(events, window) {
    const startMs = timestampMs(window.startTimestamp);
    const endMs = timestampMs(window.endTimestamp);
    if (startMs === undefined || endMs === undefined)
        return [window.anchor];
    const selected = events.filter((event) => {
        const eventMs = timestampMs(event.timestamp);
        return eventMs !== undefined && eventMs >= startMs && eventMs <= endMs;
    });
    if (!selected.some((event) => event.id === window.anchor.id))
        selected.push(window.anchor);
    return sortByTimestamp(selected);
}
function filterTimedEntries(entries, window) {
    const startMs = timestampMs(window.startTimestamp);
    const endMs = timestampMs(window.endTimestamp);
    if (startMs === undefined || endMs === undefined)
        return [];
    return sortByTimestamp(entries.filter((entry) => {
        const entryMs = timestampMs(entry.timestamp);
        return entryMs !== undefined && entryMs >= startMs && entryMs <= endMs;
    }));
}
export function filterNetworkAroundEvent(entries, window) {
    const startMs = timestampMs(window.startTimestamp);
    const endMs = timestampMs(window.endTimestamp);
    if (startMs === undefined || endMs === undefined)
        return [];
    return sortByTimestamp(entries.filter((entry) => {
        const entryStartMs = timestampMs(entry.timestamp);
        if (entryStartMs === undefined)
            return false;
        const entryEndMs = entryStartMs + Math.max(0, entry.durationMs);
        return entryStartMs <= endMs && entryEndMs >= startMs;
    }));
}
export function filterErrorsAroundEvent(entries, window) {
    return filterTimedEntries(entries, window);
}
export function filterStorageAroundEvent(entries, window) {
    return filterTimedEntries(entries, window);
}
export function filterActionsAroundEvent(entries, window) {
    return filterTimedEntries(entries, window);
}
export function filterRoutesAroundEvent(entries, window) {
    return filterTimedEntries(entries, window);
}
export function filterSelectedElementsAroundEvent(entries, window) {
    return filterTimedEntries(entries, window);
}
