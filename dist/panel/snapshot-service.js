const MAX_CACHE_METADATA = 20;
const MAX_DIFF_ENTRIES = 500;
const MAX_DIFF_DEPTH = 12;
function fallbackFramework(label) {
    return { detected: false, message: `${label} state is not accessible on this page.` };
}
function entriesAsObject(entries) {
    return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}
function comparableSnapshot(snapshot) {
    return {
        localStorage: entriesAsObject(snapshot.localStorage),
        sessionStorage: entriesAsObject(snapshot.sessionStorage),
        pinia: snapshot.pinia.detected ? snapshot.pinia.data ?? null : null,
        tanstackQuery: snapshot.tanstackQuery.detected ? snapshot.tanstackQuery.data ?? null : null,
        indexedDb: snapshot.indexedDb,
        cacheStorage: snapshot.cacheStorage,
    };
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function addDiff(entries, entry) {
    if (entries.length < MAX_DIFF_ENTRIES)
        entries.push(entry);
}
function diffValues(before, after, path, entries, depth = 0) {
    if (entries.length >= MAX_DIFF_ENTRIES || Object.is(before, after))
        return;
    if (depth >= MAX_DIFF_DEPTH || typeof before !== 'object' || typeof after !== 'object' || before === null || after === null) {
        addDiff(entries, { path, before, after, kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed' });
        return;
    }
    if (Array.isArray(before) || Array.isArray(after)) {
        const left = Array.isArray(before) ? before : undefined;
        const right = Array.isArray(after) ? after : undefined;
        if (!left || !right) {
            addDiff(entries, { path, before, after, kind: left ? 'removed' : 'added' });
            return;
        }
        const maxLength = Math.max(left.length, right.length);
        for (let index = 0; index < maxLength; index += 1)
            diffValues(left[index], right[index], `${path}[${index}]`, entries, depth + 1);
        return;
    }
    if (isObject(before) && isObject(after)) {
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
        for (const key of keys)
            diffValues(before[key], after[key], path ? `${path}.${key}` : key, entries, depth + 1);
        return;
    }
    addDiff(entries, { path, before, after, kind: 'changed' });
}
export function diffSnapshots(before, after) {
    const entries = [];
    diffValues(comparableSnapshot(before), comparableSnapshot(after), '', entries);
    return { beforeId: before.id, afterId: after.id, entries };
}
export class SnapshotService {
    evaluator;
    readCookies;
    constructor(evaluator, readCookies) {
        this.evaluator = evaluator;
        this.readCookies = readCookies;
    }
    async capture(label = 'Snapshot') {
        const pageDetails = await this.evaluator.getPageDetails();
        if (!pageDetails.ok || !pageDetails.data)
            return { ok: false, error: pageDetails.error ?? 'Page details could not be read.' };
        const pageUrl = pageDetails.data.page.url;
        const [localStorage, sessionStorage, cookies, indexedDb, cacheNames, pinia, tanstackQuery] = await Promise.all([
            this.evaluator.getStorage('localStorage'),
            this.evaluator.getStorage('sessionStorage'),
            this.readCookies(pageUrl),
            this.evaluator.getIndexedDatabases(),
            this.evaluator.getCacheNames(),
            this.evaluator.getFrameworkState('pinia'),
            this.evaluator.getFrameworkState('tanstackQuery'),
        ]);
        const names = cacheNames.ok && cacheNames.data ? cacheNames.data.slice(0, MAX_CACHE_METADATA) : [];
        const cacheResults = await Promise.all(names.map((name) => this.evaluator.getCacheEntries(name, 1)));
        return {
            ok: true,
            data: {
                id: `snapshot-${crypto.randomUUID()}`,
                label: label.trim() || 'Snapshot',
                timestamp: new Date().toISOString(),
                page: pageDetails.data.page,
                environment: pageDetails.data.environment,
                localStorage: localStorage.ok && localStorage.data ? localStorage.data : [],
                sessionStorage: sessionStorage.ok && sessionStorage.data ? sessionStorage.data : [],
                cookies: cookies.ok && cookies.data ? cookies.data : [],
                indexedDb: indexedDb.ok && indexedDb.data ? indexedDb.data : [],
                cacheStorage: cacheResults.map((result, index) => result.ok && result.data
                    ? { name: result.data.name, totalEntries: result.data.totalEntries, truncated: result.data.truncated, error: result.data.error }
                    : { name: names[index], totalEntries: 0, truncated: false, error: result.error ?? 'Cache metadata unavailable.' }),
                pinia: pinia.ok && pinia.data ? pinia.data : fallbackFramework('Pinia'),
                tanstackQuery: tanstackQuery.ok && tanstackQuery.data ? tanstackQuery.data : fallbackFramework('TanStack Query'),
            },
        };
    }
}
