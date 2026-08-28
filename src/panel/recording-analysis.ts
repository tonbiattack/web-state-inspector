import type { DebugRecording, DiffEntry, NetworkDifference, NetworkEntry, RecordingComparison, RecordingDivergence, RelatedEventChain, StorageChangeEvent, SuspiciousEvent, TimelineEvent } from '../shared/types.js';

const CHAIN_GAP_MS = 1_500;

function time(value: string): number { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY; }
function endpoint(entry: NetworkEntry): string { try { const url = new URL(entry.url); return `${entry.method} ${url.origin}${url.pathname}`; } catch { return `${entry.method} ${entry.url.split('?')[0]}`; } }
function query(url: string): string { try { return new URL(url).search; } catch { return url.includes('?') ? `?${url.split('?').slice(1).join('?')}` : ''; } }
function valueDiff(path: string, before: unknown, after: unknown): DiffEntry[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const keys = new Set([...Object.keys(before as Record<string, unknown>), ...Object.keys(after as Record<string, unknown>)]);
    return [...keys].flatMap((key) => valueDiff(`${path}.${key}`, (before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key]));
  }
  return [{ path, before, after, kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed' }];
}
function headers(entries: { name: string; value: string }[]): Record<string, string> { return Object.fromEntries(entries.map((header) => [header.name.toLowerCase(), header.value])); }
function networkDiff(normal: NetworkEntry, broken: NetworkEntry): DiffEntry[] {
  return [
    ...valueDiff('status', normal.status, broken.status), ...valueDiff('statusText', normal.statusText, broken.statusText),
    ...valueDiff('durationMs', normal.durationMs, broken.durationMs), ...valueDiff('query', query(normal.url), query(broken.url)),
    ...valueDiff('requestHeaders', headers(normal.requestHeaders), headers(broken.requestHeaders)), ...valueDiff('responseHeaders', headers(normal.responseHeaders), headers(broken.responseHeaders)),
    ...valueDiff('requestBody', normal.requestBody.text, broken.requestBody.text), ...valueDiff('responseBody', parseJson(normal.responseBody.text), parseJson(broken.responseBody.text)),
  ];
}
function parseJson(value: string | undefined): unknown { if (!value) return value; try { return JSON.parse(value); } catch { return value; } }
function storageKey(change: StorageChangeEvent): string { return `${change.storageArea}.${change.key ?? 'clear'}`; }

export function findFirstDivergence(normal: DebugRecording, broken: DebugRecording): RecordingDivergence | undefined {
  const normalStorage = new Map(normal.storageChanges.map((change) => [storageKey(change), change]));
  const brokenStorage = new Map(broken.storageChanges.map((change) => [storageKey(change), change]));
  const candidates: RecordingDivergence[] = [];
  for (const key of new Set([...normalStorage.keys(), ...brokenStorage.keys()])) {
    const left = normalStorage.get(key); const right = brokenStorage.get(key);
    if (left?.newValue !== right?.newValue) candidates.push({ timestamp: right?.timestamp ?? left?.timestamp ?? broken.createdAt, category: 'storage', key, normal: left?.newValue ?? null, broken: right?.newValue ?? null });
  }
  // Do not let an extra click in one run shift every later event. Compare like kinds in order.
  for (const kind of new Set([...normal.timeline.map((event) => event.kind), ...broken.timeline.map((event) => event.kind)])) {
    const leftEvents = normal.timeline.filter((event) => event.kind === kind); const rightEvents = broken.timeline.filter((event) => event.kind === kind);
    for (let index = 0; index < Math.max(leftEvents.length, rightEvents.length); index += 1) {
      const left = leftEvents[index]; const right = rightEvents[index];
      if (!left || !right || left.summary !== right.summary) candidates.push({ timestamp: right?.timestamp ?? left?.timestamp ?? broken.createdAt, category: 'event', key: `${kind}[${index}]`, normal: left?.summary ?? null, broken: right?.summary ?? null });
    }
  }
  return candidates.sort((left, right) => time(left.timestamp) - time(right.timestamp))[0];
}

export function compareNetwork(normal: NetworkEntry[], broken: NetworkEntry[]): NetworkDifference[] {
  const available = new Map<string, NetworkEntry[]>();
  for (const entry of normal) { const key = endpoint(entry); available.set(key, [...(available.get(key) ?? []), entry]); }
  const differences: NetworkDifference[] = [];
  for (const entry of broken) {
    const key = endpoint(entry); const match = available.get(key)?.shift(); const changes = match ? networkDiff(match, entry) : [{ path: 'request', before: undefined, after: `${entry.method} ${entry.url}`, kind: 'added' as const }];
    if (changes.length) differences.push({ key, normal: match, broken: entry, differences: changes });
  }
  for (const [key, remaining] of available) for (const entry of remaining) differences.push({ key, normal: entry, differences: [{ path: 'request', before: `${entry.method} ${entry.url}`, after: undefined, kind: 'removed' }] });
  return differences;
}

export function buildRelatedEventChains(timeline: TimelineEvent[]): RelatedEventChain[] {
  const events = timeline.slice().sort((a, b) => time(a.timestamp) - time(b.timestamp)); const chains: RelatedEventChain[] = []; let current: TimelineEvent[] = [];
  for (const event of events) { const prior = current.at(-1); if (prior && time(event.timestamp) - time(prior.timestamp) > CHAIN_GAP_MS) { if (current.length > 1) chains.push({ id: chains.length + 1, events: current }); current = []; } current.push(event); }
  if (current.length > 1) chains.push({ id: chains.length + 1, events: current }); return chains;
}

export function findSuspiciousEvents(recording: DebugRecording, divergence?: RecordingDivergence): SuspiciousEvent[] {
  const events = recording.timeline.slice().sort((a, b) => time(a.timestamp) - time(b.timestamp)); const output: SuspiciousEvent[] = [];
  const add = (event: TimelineEvent | undefined, reason: string) => { if (event && !output.some((item) => item.event.id === event.id)) output.push({ reason, event, previous: events[events.indexOf(event) - 1] }); };
  add(events.find((event) => event.kind === 'network-response' && event.status >= 500), 'First HTTP 5xx');
  add(events.find((event) => event.kind === 'network-response' && event.status >= 400), 'First HTTP 4xx');
  add(events.find((event) => event.kind === 'network-response' && event.status === 0), 'First status 0');
  add(events.find((event) => ['javascript-error', 'promise-rejection', 'console-error'].includes(event.kind)), 'First JavaScript or console error');
  if (divergence) add(events.find((event) => event.timestamp >= divergence.timestamp), 'First difference from normal recording');
  return output;
}

export function compareRecordings(normal: DebugRecording, broken: DebugRecording): RecordingComparison {
  const firstDivergence = findFirstDivergence(normal, broken);
  return { normalRecordingId: normal.id, brokenRecordingId: broken.id, firstDivergence, networkDifferences: compareNetwork(normal.network, broken.network), eventChains: buildRelatedEventChains(broken.timeline), suspiciousEvents: findSuspiciousEvents(broken, firstDivergence) };
}
