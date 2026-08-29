const MAX_EXPORT_EVENTS = 200;
const MAX_EXPORT_NETWORK = 100;
const MAX_EXPORT_ERRORS = 50;
const MAX_EXPORT_STORAGE = 100;
const MAX_EXPORT_ACTIONS = 200;
const MAX_EXPORT_ROUTES = 100;
const CORRELATION_WINDOW_MS = 1_500;
function code(value) {
    return `\`\`\`\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n\`\`\``;
}
function truncate(value, length = 4_000) {
    return value.length > length ? `${value.slice(0, length)}\n[truncated for AI export]` : value;
}
function frameLabelForExport(event) {
    const frame = event.frame;
    if (!frame)
        return '[Main]';
    if (frame.isMainFrame)
        return '[Main]';
    try {
        const parsed = new URL(frame.url);
        const path = parsed.pathname === '/' ? parsed.hostname : parsed.pathname;
        return `[iframe ${path.slice(0, 30)}]`;
    }
    catch {
        return '[iframe]';
    }
}
function eventLine(event) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const framePrefix = `${frameLabelForExport(event)} `;
    if (event.kind === 'storage')
        return `${time} ${framePrefix}STORAGE ${event.storage.storageArea}.${event.storage.key ?? 'clear'} ${event.storage.oldValue ?? 'null'} → ${event.storage.newValue ?? 'null'}`;
    if (event.kind === 'network-request')
        return `${time} ${framePrefix}REQUEST ${event.method} ${event.url}`;
    if (event.kind === 'network-response')
        return `${time} ${framePrefix}RESPONSE ${event.status} ${event.method} ${event.url} (${event.durationMs} ms)`;
    if (event.kind === 'user-action')
        return `${time} ${framePrefix}USER_ACTION ${event.actionType.toUpperCase()} ${event.target.selector}${event.key ? ` (${event.key})` : ''}`;
    if (event.kind === 'route-change')
        return `${time} ${framePrefix}ROUTE_CHANGE ${event.routeType} ${event.from} → ${event.to}`;
    if (event.kind === 'frame-added' || event.kind === 'frame-navigated' || event.kind === 'frame-removed')
        return `${time} ${framePrefix}${event.kind.toUpperCase()} ${event.frame.url}${event.fromUrl ? ` (from: ${event.fromUrl})` : ''}`;
    // Remaining cases are ErrorTimelineEvent kinds; summary === error.message for these events.
    return `${time} ${framePrefix}${event.kind.toUpperCase()} ${event.summary}`;
}
function possiblyRelated(event, actions) {
    if (event.kind === 'user-action')
        return '';
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isFinite(eventMs))
        return '';
    let preceding;
    let precedingMs = Number.NEGATIVE_INFINITY;
    for (const action of actions) {
        const actionMs = Date.parse(action.timestamp);
        if (Number.isFinite(actionMs) && actionMs <= eventMs && eventMs - actionMs <= CORRELATION_WINDOW_MS && actionMs > precedingMs) {
            preceding = action;
            precedingMs = actionMs;
        }
    }
    return preceding ? ` [possibly related to ${preceding.actionType} ${preceding.target.selector}]` : '';
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
function formatAction(action) {
    const value = action.target.value === undefined ? '' : `\n\nValue: ${action.target.value}`;
    return `${new Date(action.timestamp).toLocaleTimeString()} ${action.actionType.toUpperCase()} ${action.target.selector}${action.key ? ` (${action.key})` : ''}${action.target.text ? `\n\nText: ${action.target.text}` : ''}${value}`;
}
function formatRoute(route) {
    return `${new Date(route.timestamp).toLocaleTimeString()} ${route.routeType}\n\n${route.from}\n→\n${route.to}`;
}
function formatFocusedEvent(focusedEvent, context) {
    const anchor = focusedEvent.anchor;
    return `Selected event: ${anchor.kind}\n\nTime: ${anchor.timestamp}\n\nSummary: ${anchor.summary}\n\nWindow: ${focusedEvent.beforeMs / 1000}s before (${focusedEvent.startTimestamp}) → ${focusedEvent.afterMs / 1000}s after (${focusedEvent.endTimestamp})\n\nIncluded: ${context.timeline.length} timeline event(s), ${context.errors.length} error(s), ${context.network.length} network request(s), ${context.storageChanges.length} storage change(s), ${context.userActions.length} user action(s), ${context.routeChanges.length} route change(s)`;
}
export function createAiDebugContext(args) {
    const pageSnapshot = args.after ?? args.before;
    return {
        generatedAt: args.generatedAt ?? new Date().toISOString(),
        page: args.page ?? pageSnapshot?.page,
        environment: args.environment ?? pageSnapshot?.environment,
        session: args.session,
        snapshots: { before: args.before, after: args.after, diff: args.diff },
        network: args.network.slice(-MAX_EXPORT_NETWORK),
        errors: args.errors.slice(-MAX_EXPORT_ERRORS),
        storageChanges: args.storageChanges.slice(-MAX_EXPORT_STORAGE),
        timeline: args.timeline.slice(-MAX_EXPORT_EVENTS),
        userActions: (args.userActions ?? []).slice(-MAX_EXPORT_ACTIONS),
        routeChanges: (args.routeChanges ?? []).slice(-MAX_EXPORT_ROUTES),
        selectedElements: args.selectedElements ?? [],
        reproductionNotes: args.reproductionNotes ?? { expectedResult: '', actualResult: '', reproductionSteps: '', additionalNotes: '' },
        focusedEvent: args.focusedEvent,
        eventContext: args.eventContext,
        comparison: args.comparison,
    };
}
export function formatAiContextJson(context) {
    return JSON.stringify(context, null, 2);
}
export function formatAiContextMarkdown(context) {
    const page = context.page;
    const environment = context.environment;
    const currentSnapshot = context.snapshots.after ?? context.snapshots.before;
    const notes = context.reproductionNotes;
    const failedNetwork = context.network.filter((entry) => Boolean(entry.error) || entry.status === 0 || entry.status >= 400);
    const timeline = context.timeline.map((event) => `${eventLine(event)}${possiblyRelated(event, context.userActions)}`);
    const comparison = context.comparison;
    const divergence = comparison?.firstDivergence;
    const debugSummary = comparison?.suspiciousEvents.map((item) => `${item.reason}: ${eventLine(item.event)}${item.previous ? `\nPrevious: ${eventLine(item.previous)}` : ''}`).join('\n\n');
    const sections = [
        '# Web Debug Context',
        '> Review this exported context for secrets, tokens, personal data, and customer data before sharing it with any AI service. “Possibly related” means temporal proximity only; it does not prove causality.',
        '## Reproduction Notes',
        `Expected Result:\n\n${notes.expectedResult || 'Not provided'}\n\nActual Result:\n\n${notes.actualResult || 'Not provided'}\n\nReproduction Steps:\n\n${notes.reproductionSteps || 'Not provided'}\n\nAdditional Notes:\n\n${notes.additionalNotes || 'Not provided'}`,
        ...(debugSummary ? ['## Debug Summary', debugSummary] : []),
        ...(divergence ? ['## First Divergence', `Time: ${divergence.timestamp}\n\nKey: ${divergence.key}\n\nNormal:\n\n${code(divergence.normal)}\n\nBroken:\n\n${code(divergence.broken)}`] : []),
        ...(comparison?.eventChains.length ? ['## Possibly Related Event Chains', comparison.eventChains.map((chain) => `### Event Chain #${chain.id}\n\n${chain.events.map((event) => eventLine(event)).join('\n\n↓\n\n')}`).join('\n\n')] : []),
        ...(context.focusedEvent ? ['## Focused Failure Window', formatFocusedEvent(context.focusedEvent, context)] : []),
        ...(context.eventContext ? ['## Selected Event Context', formatFocusedEvent(context.eventContext, context)] : []),
        '## JavaScript and Console Events',
        context.errors.length ? context.errors.map(formatError).join('\n\n') : 'No JavaScript or console events recorded.',
        '## Network Errors',
        failedNetwork.length ? failedNetwork.map(formatNetwork).join('\n\n') : 'No failed network requests recorded.',
        ...(comparison?.networkDifferences.length ? ['## Network Differences', comparison.networkDifferences.map((item) => `### ${item.key}\n\n${item.differences.map((diff) => `${diff.path}\n- ${JSON.stringify(diff.before)}\n+ ${JSON.stringify(diff.after)}`).join('\n\n')}`).join('\n\n')] : []),
        '## User Actions',
        context.userActions.length ? context.userActions.map(formatAction).join('\n\n') : 'No user actions recorded.',
        '## Route Changes',
        context.routeChanges.length ? context.routeChanges.map(formatRoute).join('\n\n') : 'No route changes recorded.',
        '## Storage Changes',
        context.storageChanges.length ? context.storageChanges.map(formatStorage).join('\n\n') : 'No Storage changes recorded.',
    ];
    sections.push('## Unified Timeline', timeline.length ? code(timeline.join('\n')) : 'No debug events recorded.');
    // Frames section: list all distinct frames seen in the timeline.
    const seenFrames = new Map();
    for (const event of context.timeline) {
        if (!event.frame)
            continue;
        const key = `${String(event.frame.frameId)}:${event.frame.url}`;
        if (!seenFrames.has(key))
            seenFrames.set(key, { url: event.frame.url, isMainFrame: event.frame.isMainFrame, isCrossOrigin: event.frame.isCrossOrigin });
    }
    if (seenFrames.size > 0) {
        const frameLines = [...seenFrames.values()].map((f) => `- ${f.isMainFrame ? 'Main Frame' : 'iframe'}${f.isCrossOrigin ? ' (cross-origin)' : ''}: ${f.url}`);
        sections.push('## Frames', frameLines.join('\n'));
    }
    if (context.snapshots.diff) {
        const beforeLabel = context.snapshots.before?.label ?? 'Before';
        const afterLabel = context.snapshots.after?.label ?? 'After';
        sections.push(`## Snapshot Diff: ${beforeLabel} vs ${afterLabel}`, context.snapshots.diff.entries.length
            ? context.snapshots.diff.entries.map((entry) => `${entry.kind.toUpperCase()} ${entry.path}\n- ${JSON.stringify(entry.before)}\n+ ${JSON.stringify(entry.after)}`).join('\n\n')
            : 'No differences between captured snapshots.');
    }
    const currentState = [
        `URL: ${page?.url ?? 'Not available'}`,
        `Title: ${page?.title ?? 'Not available'}`,
        `Captured snapshot: ${currentSnapshot ? `${currentSnapshot.label} (${currentSnapshot.timestamp})` : context.focusedEvent ? 'Omitted from focused export' : 'Not available'}`,
        `Generated at: ${context.generatedAt}`,
        `User Agent: ${environment?.userAgent ?? 'Not available'}`,
        `Viewport: ${environment ? `${environment.viewport.width}x${environment.viewport.height} (DPR ${environment.viewport.devicePixelRatio})` : 'Not available'}`,
        `Document readyState: ${environment?.readyState ?? 'Not available'}`,
        `Recording active: ${context.session.active}`,
        `Started at: ${context.session.startedAt ?? 'Not available'}`,
        `Timeline events: ${context.session.eventCount}`,
        `Errors: ${context.session.errorCount}`,
        `Network entries: ${context.session.networkCount}`,
        `User actions: ${context.session.userActionCount}`,
        `Route changes: ${context.session.routeChangeCount}`,
        `Storage changes: ${context.storageChanges.length}`,
    ];
    if (context.selectedElements.length) {
        currentState.push('', '### Selected DOM Snapshots', context.selectedElements.map((snapshot, index) => `#### Element ${index + 1}: ${snapshot.summary.selector}\n\n${code(snapshot)}`).join('\n\n'));
    }
    sections.push('## Current State', currentState.join('\n\n'));
    return sections.join('\n\n');
}
