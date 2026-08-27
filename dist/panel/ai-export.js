const MAX_EXPORT_EVENTS = 200;
const MAX_EXPORT_NETWORK = 100;
const MAX_EXPORT_ERRORS = 50;
const MAX_EXPORT_STORAGE = 100;
function code(value) {
    return `\`\`\`\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n\`\`\``;
}
function truncate(value, length = 4000) {
    return value.length > length ? `${value.slice(0, length)}\n[truncated for AI export]` : value;
}
function eventLine(event) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    if (event.kind === 'storage')
        return `${time} STORAGE ${event.storage.storageArea}.${event.storage.key ?? 'clear'} ${event.storage.oldValue ?? 'null'} → ${event.storage.newValue ?? 'null'}`;
    if (event.kind === 'network-request')
        return `${time} REQUEST ${event.method} ${event.url}`;
    if (event.kind === 'network-response')
        return `${time} RESPONSE ${event.status} ${event.method} ${event.url} (${event.durationMs} ms)`;
    return `${time} ${event.kind.toUpperCase()} ${event.error.message}`;
}
function formatError(error, index) {
    const source = error.sourceUrl ? `${error.sourceUrl}${error.line ? `:${error.line}${error.column ? `:${error.column}` : ''}` : ''}` : 'Not available';
    return `### Error ${index + 1}\n\nKind: ${error.kind}\n\nMessage: ${error.message}\n\nSource: ${source}\n\nStack:\n\n${code(error.stack.join('\n') || 'Not available')}`;
}
function formatNetwork(entry, index) {
    const response = entry.responseBody.available ? code(truncate(entry.responseBody.text ?? '')) : `Not available: ${entry.responseBody.reason ?? 'Unknown reason.'}`;
    return `### ${index + 1}. ${entry.method} ${entry.url}\n\nStatus: ${entry.status || 'Not available'} ${entry.statusText}\n\nDuration: ${entry.durationMs} ms\n\nType: ${entry.resourceType ?? 'Not available'}\n\nRequest headers:\n\n${code(entry.requestHeaders)}\n\nRequest body:\n\n${entry.requestBody.available ? code(truncate(entry.requestBody.text ?? '')) : `Not available: ${entry.requestBody.reason ?? 'Unknown reason.'}`}\n\nResponse headers:\n\n${code(entry.responseHeaders)}\n\nResponse body:\n\n${response}`;
}
function formatStorage(change, index) {
    return `### Storage change ${index + 1}\n\nArea: ${change.storageArea}\n\nOperation: ${change.operation}\n\nKey: ${change.key ?? 'clear'}\n\nBefore:\n\n${code(change.oldValue ?? 'null')}\n\nAfter:\n\n${code(change.newValue ?? 'null')}\n\nWhere:\n\n${code(change.stack.join('\n') || change.externalUrl || 'Not available')}`;
}
export function createAiDebugContext(args) {
    const pageSnapshot = args.after ?? args.before;
    return {
        generatedAt: args.generatedAt ?? new Date().toISOString(),
        page: pageSnapshot?.page,
        environment: pageSnapshot?.environment,
        session: args.session,
        snapshots: { before: args.before, after: args.after, diff: args.diff },
        network: args.network.slice(-MAX_EXPORT_NETWORK),
        errors: args.errors.slice(-MAX_EXPORT_ERRORS),
        storageChanges: args.storageChanges.slice(-MAX_EXPORT_STORAGE),
        timeline: args.timeline.slice(-MAX_EXPORT_EVENTS),
    };
}
export function formatAiContextJson(context) {
    return JSON.stringify(context, null, 2);
}
export function formatAiContextMarkdown(context) {
    const page = context.page;
    const environment = context.environment;
    const failedNetwork = context.network.filter((entry) => Boolean(entry.error) || entry.status >= 400);
    const sections = [
        '# Web Debug Context',
        '> Review this exported context for secrets, tokens, personal data, and customer data before sharing it with any AI service.',
        '## Page',
        `URL: ${page?.url ?? 'Not available'}\n\nTitle: ${page?.title ?? 'Not available'}`,
        '## Environment',
        `Timestamp: ${context.generatedAt}\n\nUser Agent: ${environment?.userAgent ?? 'Not available'}\n\nViewport: ${environment ? `${environment.viewport.width}x${environment.viewport.height} (DPR ${environment.viewport.devicePixelRatio})` : 'Not available'}\n\nDocument readyState: ${environment?.readyState ?? 'Not available'}`,
        '## Recording summary',
        `Active: ${context.session.active}\n\nStarted at: ${context.session.startedAt ?? 'Not available'}\n\nTimeline events: ${context.session.eventCount}\n\nErrors: ${context.session.errorCount}\n\nNetwork entries: ${context.session.networkCount}\n\nStorage changes: ${context.storageChanges.length}`,
        '## JavaScript Errors',
        context.errors.length ? context.errors.map(formatError).join('\n\n') : 'No JavaScript errors recorded.',
        '## Network Errors',
        failedNetwork.length ? failedNetwork.map(formatNetwork).join('\n\n') : 'No failed network requests recorded.',
        '## Storage Changes',
        context.storageChanges.length ? context.storageChanges.map(formatStorage).join('\n\n') : 'No Storage changes recorded.',
    ];
    if (context.snapshots.diff) {
        sections.push('## Snapshot Diff', context.snapshots.diff.entries.length
            ? context.snapshots.diff.entries.map((entry) => `${entry.kind.toUpperCase()} ${entry.path}\n- ${JSON.stringify(entry.before)}\n+ ${JSON.stringify(entry.after)}`).join('\n\n')
            : 'No differences between captured snapshots.');
    }
    sections.push('## Unified Timeline', context.timeline.length ? code(context.timeline.map(eventLine).join('\n')) : 'No debug events recorded.');
    return sections.join('\n\n');
}
