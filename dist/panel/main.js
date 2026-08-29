import { formatAiContextJson, formatAiContextMarkdown, createAiDebugContext } from './ai-export.js';
import { ChangeTracker } from './change-tracker.js';
import { DebugSession } from './debug-session.js';
import { ErrorCollector } from './error-collector.js';
import { createEventContextWindow, createFocusedEventWindow, DEFAULT_CONTEXT_AFTER_MS, DEFAULT_CONTEXT_BEFORE_MS, filterActionsAroundEvent, filterErrorsAroundEvent, filterNetworkAroundEvent, filterRoutesAroundEvent, filterSelectedElementsAroundEvent, filterStorageAroundEvent, filterTimelineAroundEvent, isFailureTimelineEvent, isImportantTimelineEvent } from './focused-event-context.js';
import { InteractionTracker } from './interaction-tracker.js';
import { JsonExpansionState } from './json-expansion-state.js';
import { matchesNetworkFilter } from './network-collector.js';
import { formatNetworkExchange, networkBodyText } from './network-copy.js';
import { NetworkUpdateState } from './network-update-state.js';
import { compareRecordings } from './recording-analysis.js';
import { handleBridgeRequest } from '../bridge/bridge-handler.js';
import { PageEvaluator } from './page-evaluator.js';
import { emptyReproductionNotes, normalizeReproductionNotes } from './reproduction-notes.js';
import { SelectedElementService } from './selected-element-service.js';
import { diffSnapshots, SnapshotService } from './snapshot-service.js';
import { StoragePollingController } from './storage-polling.js';
const evaluator = new PageEvaluator();
const changeTracker = new ChangeTracker(evaluator);
const errorCollector = new ErrorCollector(evaluator);
const interactionTracker = new InteractionTracker(evaluator);
const debugSession = new DebugSession(changeTracker, errorCollector, () => performance.now(), interactionTracker);
const snapshotService = new SnapshotService(evaluator, requestCookies);
const selectedElementService = new SelectedElementService(evaluator);
let trackingPollId;
let debugPollId;
let networkFilter = 'all';
const networkUpdateState = new NetworkUpdateState();
let beforeSnapshot;
let afterSnapshot;
let currentDiff;
let exportFormat = 'markdown';
let beforeSnapshotLabel = 'Snapshot 1';
let afterSnapshotLabel = 'Snapshot 2';
let selectedElementSnapshots = [];
let reproductionNotes = emptyReproductionNotes();
let changeTrackingActive = false;
let focusedEventId;
let focusedBeforeMs = DEFAULT_CONTEXT_BEFORE_MS;
let focusedAfterMs = DEFAULT_CONTEXT_AFTER_MS;
let selectedTimelineEventId;
let timelineView = 'all';
/** 'all' = no frame filter, 'main' = main frame only, any other string = specific frame URL */
let timelineFrameFilter = 'all';
let recordings = [];
let normalRecordingId;
let brokenRecordingId;
let recordingComparison;
const jsonExpansionState = new JsonExpansionState();
const root = document.querySelector('#app');
if (!root)
    throw new Error('Panel root was not found.');
const appRoot = root;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const envelope = message;
    // Handle frame lifecycle events forwarded from the background service worker.
    if (envelope?.type === 'FRAME_LIFECYCLE_EVENT' && envelope.tabId === chrome.devtools.inspectedWindow.tabId && envelope.event) {
        debugSession.addExternalEvents([envelope.event]);
        if (['debug-timeline', 'network', 'errors', 'ai-export'].includes(state.selected))
            renderCurrentData();
        return;
    }
    if (envelope?.type !== 'WEB_STATE_INSPECTOR_BRIDGE_REQUEST' || !envelope.request || sender.tab?.id !== chrome.devtools.inspectedWindow.tabId)
        return;
    void handleBridgeRequest(envelope.request, {
        getStatus: () => debugSession.getStatus(),
        getUrl: () => state.pageUrl,
        getErrors: () => debugSession.getErrors(),
        getNetwork: () => debugSession.getNetwork(),
        getTimeline: () => debugSession.getTimeline(),
        getStorageChanges: () => debugSession.getStorageChanges(),
        getSnapshotCount: () => Number(Boolean(beforeSnapshot)) + Number(Boolean(afterSnapshot)),
    }).then(sendResponse).catch(() => sendResponse({ source: 'web-state-inspector-extension', type: 'response', requestId: envelope.request.requestId, success: false, error: { code: 'INVALID_REQUEST', message: 'Bridge request could not be processed.' } }));
    return true;
});
const state = {
    selected: 'debug-timeline',
    query: '',
    pageUrl: '',
    loadedData: [],
    loading: false,
    autoRefreshEnabled: false,
    autoRefreshIntervalMs: 1000,
};
const storagePolling = new StoragePollingController(() => ({ ...state, changeTrackingActive }), () => { void refreshPanel({ background: true }); });
const navItems = [
    { id: 'debug-timeline', label: 'Timeline', group: 'Debug' },
    { id: 'network', label: 'Network', group: 'Debug' },
    { id: 'snapshots', label: 'Snapshots', group: 'Debug' },
    { id: 'ai-export', label: 'AI Export', group: 'Debug' },
    { id: 'storage', label: 'Storage', group: 'Inspect' },
    { id: 'cookies', label: 'Cookies', group: 'Inspect' },
    { id: 'framework-state', label: 'Framework State', group: 'Experimental', experimental: true },
];
const labels = Object.fromEntries(navItems.map((item) => [item.id, item.label]));
function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function clear(node) {
    node.replaceChildren();
}
function formatJson(value) {
    return JSON.stringify(value, null, 2);
}
async function copyText(text, button) {
    try {
        await navigator.clipboard.writeText(text);
        if (button) {
            const previous = button.textContent;
            button.textContent = 'Copied';
            window.setTimeout(() => { button.textContent = previous; }, 1200);
        }
    }
    catch {
        if (button)
            button.textContent = 'Copy failed';
    }
}
function copyButton(text, label = 'Copy') {
    const button = element('button', 'action-button inline-copy', label);
    button.type = 'button';
    button.addEventListener('click', () => { void copyText(text, button); });
    return button;
}
function jsonView(value, collapsed = true, expansionKey) {
    const wrapper = element('div', 'json');
    const output = formatJson(value);
    if (!collapsed) {
        wrapper.append(copyButton(output));
        wrapper.append(element('pre', 'value-text', output));
        return wrapper;
    }
    const details = element('details');
    const summary = element('summary', undefined, 'JSON を表示');
    if (expansionKey) {
        details.open = jsonExpansionState.isExpanded(expansionKey);
        // toggleは非同期に配送されるため、1秒未満の更新でも状態を失わないよう、操作時に先行して保存する。
        summary.addEventListener('click', () => {
            jsonExpansionState.setExpanded(expansionKey, !details.open);
        });
        details.addEventListener('toggle', () => {
            jsonExpansionState.setExpanded(expansionKey, details.open);
        });
    }
    details.append(summary, copyButton(output), element('pre', 'value-text', output));
    wrapper.append(details);
    return wrapper;
}
function createTable(headers) {
    const wrap = element('div', 'table-wrap');
    const table = element('table');
    const thead = element('thead');
    const headRow = element('tr');
    for (const header of headers)
        headRow.append(element('th', undefined, header));
    thead.append(headRow);
    const body = element('tbody');
    table.append(thead, body);
    wrap.append(table);
    return { table: wrap.querySelector('table'), body };
}
function matchesQuery(values) {
    if (!state.query)
        return true;
    return values.some((value) => String(value).toLowerCase().includes(state.query));
}
function stopStoragePolling() {
    storagePolling.stop();
}
function syncStoragePolling() {
    storagePolling.sync();
}
function renderAutoRefreshControls() {
    const controls = element('div', 'auto-refresh-controls');
    const label = element('label', 'toggle-label');
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.checked = state.autoRefreshEnabled;
    toggle.addEventListener('change', () => {
        state.autoRefreshEnabled = toggle.checked;
        syncStoragePolling();
        if (toggle.checked)
            void refreshPanel({ background: true });
        renderCurrentData();
    });
    label.append(toggle, document.createTextNode('Auto Refresh'));
    const intervalLabel = element('label', 'interval-label', 'Interval');
    const interval = element('select', 'interval-select');
    for (const milliseconds of [500, 1000, 2000, 5000]) {
        const option = element('option');
        option.value = String(milliseconds);
        option.textContent = milliseconds < 1000 ? `${milliseconds} ms` : `${milliseconds / 1000} s`;
        option.selected = milliseconds === state.autoRefreshIntervalMs;
        interval.append(option);
    }
    interval.disabled = !state.autoRefreshEnabled;
    interval.addEventListener('change', () => {
        state.autoRefreshIntervalMs = Number(interval.value);
        syncStoragePolling();
    });
    intervalLabel.append(interval);
    const implied = !state.autoRefreshEnabled && changeTrackingActive;
    const status = element('span', `status${state.autoRefreshEnabled || implied ? ' detected' : ''}`, state.autoRefreshEnabled ? `On · ${interval.options[interval.selectedIndex].text}` : implied ? 'On · Timeline recording' : 'Off');
    controls.append(label, intervalLabel, status);
    return controls;
}
function renderStorage(entries, expansionPrefix = state.selected) {
    const section = element('section');
    const filtered = entries.filter((entry) => matchesQuery([entry.key, entry.value]));
    section.append(renderAutoRefreshControls(), element('p', 'summary', `${filtered.length} 件${state.query ? ` / ${entries.length} 件中` : ''}`));
    if (filtered.length === 0) {
        section.append(element('div', 'empty', state.query ? '検索条件に一致する項目はありません。' : 'このStorageには項目がありません。'));
        return section;
    }
    const { table, body } = createTable(['Key', 'Value']);
    for (const entry of filtered) {
        const row = element('tr');
        row.append(element('td', 'key-cell', entry.key));
        const valueCell = element('td', 'value-cell');
        if (entry.isJson) {
            valueCell.append(jsonView(entry.parsedValue, true, `storage-json:${expansionPrefix}:${entry.key}`));
        }
        else {
            valueCell.append(copyButton(entry.value), element('pre', 'value-text', entry.value));
        }
        row.append(valueCell);
        body.append(row);
    }
    section.append(table);
    return section;
}
function renderInspectStorage(data) {
    const section = element('section');
    section.append(renderAutoRefreshControls(), element('p', 'summary', '現在のLocal StorageとSession Storageを確認します。変更の時系列はDebug / Timelineに統合されています。'));
    for (const [label, entries] of [['Local Storage', data.local], ['Session Storage', data.session]]) {
        const details = element('details');
        details.open = true;
        details.append(element('summary', undefined, `${label} · ${entries.length} entries`));
        const body = renderStorage(entries, `storage:${label}`);
        body.querySelector('.auto-refresh-controls')?.remove();
        details.append(body);
        section.append(details);
    }
    return section;
}
function renderCookies(cookies) {
    const section = element('section');
    const filtered = cookies.filter((cookie) => matchesQuery([cookie.name, cookie.value, cookie.domain, cookie.path]));
    section.append(element('p', 'summary', `${filtered.length} 件${state.query ? ` / ${cookies.length} 件中` : ''}。HttpOnly Cookie は権限上取得できる場合に含まれます。`));
    if (filtered.length === 0) {
        section.append(element('div', 'empty', state.query ? '検索条件に一致するCookieはありません。' : 'このURLで利用できるCookieはありません。'));
        return section;
    }
    const { table, body } = createTable(['Name', 'Value', 'Domain', 'Path', 'Expires', 'Secure', 'HttpOnly', 'SameSite']);
    for (const cookie of filtered) {
        const row = element('tr');
        const value = element('td', 'value-cell');
        value.append(copyButton(cookie.value), element('pre', 'value-text', cookie.value));
        row.append(element('td', 'key-cell', cookie.name), value, element('td', undefined, cookie.domain), element('td', undefined, cookie.path), element('td', undefined, cookie.expires), element('td', undefined, String(cookie.secure)), element('td', undefined, String(cookie.httpOnly)), element('td', undefined, cookie.sameSite));
        body.append(row);
    }
    section.append(table);
    return section;
}
function renderUnavailable(message, isError = false) {
    const section = element('section');
    section.append(element('div', `notice ${isError ? 'error' : 'warning'}`, message));
    return section;
}
function requestCookies(url) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_COOKIES', url }, (response) => {
            if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            resolve(response ?? { ok: false, error: 'Cookie取得の応答がありません。' });
        });
    });
}
function isSearchable(id) {
    return ['storage', 'local-storage', 'session-storage', 'cookies', 'debug-timeline', 'network'].includes(id);
}
function renderShell() {
    clear(appRoot);
    const shell = element('main', 'app-shell');
    const sidebar = element('aside', 'sidebar');
    const brand = element('div', 'brand');
    brand.append(element('h1', undefined, 'Web State Inspector'), element('p', undefined, `v${chrome.runtime.getManifest().version} · Record events, copy context`));
    sidebar.append(brand);
    for (const group of ['Debug', 'Inspect', 'Experimental']) {
        const groupNode = element('nav', 'nav-group');
        groupNode.setAttribute('aria-label', group);
        groupNode.append(element('div', 'nav-group-title', group));
        navItems.filter((item) => item.group === group).forEach((item) => {
            const button = element('button', 'nav-button', item.label);
            button.type = 'button';
            button.dataset.nav = item.id;
            if (item.experimental)
                button.append(element('span', 'experimental-badge', 'Experimental'));
            button.addEventListener('click', () => {
                if (state.selected === item.id)
                    return;
                if (['debug-timeline', 'network', 'snapshots', 'ai-export'].includes(state.selected) && !['debug-timeline', 'network', 'snapshots', 'ai-export'].includes(item.id))
                    stopDebugPolling();
                state.selected = item.id;
                syncStoragePolling();
                if (['debug-timeline', 'network', 'snapshots', 'ai-export'].includes(item.id) && debugSession.getStatus().active)
                    startDebugPolling();
                state.query = '';
                refreshPanel();
            });
            groupNode.append(button);
        });
        sidebar.append(groupNode);
    }
    const content = element('section', 'content');
    const toolbar = element('header', 'toolbar');
    const title = element('span', 'page-title');
    title.id = 'page-title';
    const origin = element('span', 'origin');
    origin.id = 'origin';
    origin.title = '検査中のページ';
    const search = element('input', 'search');
    search.id = 'search';
    search.placeholder = 'Search key / value';
    search.setAttribute('aria-label', '表示中の項目を検索');
    search.addEventListener('input', () => {
        state.query = search.value.trim().toLowerCase();
        renderCurrentData();
    });
    const refresh = element('button', 'action-button', 'Refresh');
    refresh.id = 'refresh';
    refresh.type = 'button';
    refresh.addEventListener('click', () => { void refreshPanel(); });
    toolbar.append(title, origin, search, refresh);
    const contentBody = element('div', 'content-body');
    contentBody.id = 'content-body';
    content.append(toolbar, contentBody);
    shell.append(sidebar, content);
    appRoot.append(shell);
}
function updateHeader() {
    document.querySelectorAll('[data-nav]').forEach((button) => {
        button.setAttribute('aria-current', button.dataset.nav === state.selected ? 'page' : 'false');
    });
    const title = document.querySelector('#page-title');
    const origin = document.querySelector('#origin');
    const search = document.querySelector('#search');
    if (title)
        title.textContent = labels[state.selected];
    if (origin)
        origin.textContent = state.pageUrl || 'ページ情報を取得中…';
    if (search) {
        search.value = state.query;
        search.hidden = !isSearchable(state.selected);
        search.placeholder = state.selected === 'cookies' ? 'Search name / value' : 'Search key / value';
    }
}
function setBody(content) {
    const body = document.querySelector('#content-body');
    if (!body)
        return;
    clear(body);
    body.append(content);
}
function renderIndexedDatabases(databases) {
    const section = element('section');
    const filtered = databases.filter((database) => matchesQuery([database.name, ...database.stores.map((store) => store.name)]));
    section.append(element('p', 'summary', `${filtered.length} database(s)。Object Storeを選択すると最大100件のレコードを読み取り表示します。`));
    if (filtered.length === 0) {
        section.append(element('div', 'empty', state.query ? '検索条件に一致するデータベースまたはObject Storeはありません。' : 'このoriginにはIndexedDBデータベースがありません。'));
        return section;
    }
    const tree = element('div', 'tree');
    for (const database of filtered) {
        const details = element('details', 'tree-item');
        details.open = true;
        const summary = element('summary', undefined, `${database.name}  (v${database.version ?? '?'})`);
        details.append(summary);
        const inner = element('div', 'tree-inner');
        if (database.error) {
            inner.append(element('div', 'notice error', database.error));
        }
        else if (database.stores.length === 0) {
            inner.append(element('div', 'metadata', 'Object Storeはありません。'));
        }
        else {
            for (const store of database.stores) {
                const button = element('button', 'store-button', store.name);
                button.type = 'button';
                button.append(element('div', 'metadata', `keyPath: ${store.keyPath === null ? 'none' : Array.isArray(store.keyPath) ? store.keyPath.join(', ') : store.keyPath} · records: ${store.recordCount ?? 'unknown'}`));
                button.addEventListener('click', () => { void loadIndexedDbRecords(database.name, store.name); });
                inner.append(button);
            }
        }
        details.append(inner);
        tree.append(details);
    }
    section.append(tree);
    return section;
}
function renderIndexedDbRecords(databaseName, storeName, records) {
    const section = element('section');
    const back = element('button', 'action-button', '← Databases');
    back.type = 'button';
    back.addEventListener('click', () => { void refreshPanel(); });
    section.append(back, element('h2', 'section-heading', `${databaseName} / ${storeName}`), element('p', 'summary', `${records.length} 件を表示（上限100件）。`));
    if (records.length === 0) {
        section.append(element('div', 'empty', 'このObject Storeにはレコードがありません。'));
        return section;
    }
    const { table, body } = createTable(['Key', 'Value']);
    for (const record of records) {
        const row = element('tr');
        const key = element('td', 'key-cell');
        key.append(jsonView(record.key));
        const value = element('td', 'value-cell');
        value.append(jsonView(record.value));
        row.append(key, value);
        body.append(row);
    }
    section.append(table);
    return section;
}
async function loadIndexedDbRecords(databaseName, storeName) {
    setBody(renderUnavailable(`${databaseName} / ${storeName} を読み込んでいます。`));
    const result = await evaluator.getIndexedDbRecords(databaseName, storeName);
    if (!result.ok || !result.data) {
        setBody(renderUnavailable(result.error ?? 'IndexedDBレコードを取得できません。', true));
        return;
    }
    setBody(renderIndexedDbRecords(databaseName, storeName, result.data));
}
function renderCacheNames(names) {
    const section = element('section');
    section.append(element('p', 'summary', `${names.length} cache(s)。Cacheを選択すると最大100件のRequestを読み取り表示します。`));
    if (names.length === 0) {
        section.append(element('div', 'empty', 'このoriginにはCache Storageがありません。'));
        return section;
    }
    const tree = element('div', 'tree');
    for (const name of names) {
        const button = element('button', 'cache-button', name);
        button.type = 'button';
        button.addEventListener('click', () => { void loadCacheEntries(name); });
        tree.append(button);
    }
    section.append(tree);
    return section;
}
function renderCacheEntries(summary) {
    const section = element('section');
    const back = element('button', 'action-button', '← Cache list');
    back.type = 'button';
    back.addEventListener('click', () => { void refreshPanel(); });
    section.append(back, element('h2', 'section-heading', summary.name));
    const message = `${summary.totalEntries} 件中 ${summary.entries.length} 件を表示しています。${summary.truncated ? ' 大量データ保護のため100件で打ち切りました。' : ''}`;
    section.append(element('p', 'summary', message));
    if (summary.entries.length === 0) {
        section.append(element('div', 'empty', 'このCacheにはRequestがありません。'));
        return section;
    }
    const { table, body } = createTable(['Request URL', 'Method', 'Status', 'Response Type']);
    for (const entry of summary.entries) {
        const row = element('tr');
        row.append(element('td', 'value-cell', entry.url), element('td', undefined, entry.method), element('td', undefined, `${entry.status} ${entry.statusText}`), element('td', undefined, entry.responseType));
        body.append(row);
    }
    section.append(table);
    return section;
}
async function loadCacheEntries(cacheName) {
    setBody(renderUnavailable(`${cacheName} を読み込んでいます。`));
    const result = await evaluator.getCacheEntries(cacheName);
    if (!result.ok || !result.data) {
        setBody(renderUnavailable(result.error ?? 'Cache Storageを取得できません。', true));
        return;
    }
    setBody(renderCacheEntries(result.data));
}
function renderFrameworkState(result) {
    const section = element('section');
    const warning = element('div', 'notice warning', 'Experimental: JavaScriptオブジェクトの総当たりや他拡張の内部プロトコルには依存しません。対象アプリが読み取り専用の診断ブリッジを明示的に公開した場合だけ表示します。');
    section.append(warning);
    const status = element('span', `status${result.detected ? ' detected' : ''}`, result.detected ? 'Detected' : 'Not detected');
    const message = element('p', 'summary', result.message);
    section.append(status, message);
    if (result.detected) {
        const data = element('div', 'framework-data');
        data.append(jsonView(result.data, false));
        section.append(data);
    }
    return section;
}
function renderFrameworkStates(states) {
    const section = element('section');
    section.append(element('div', 'notice warning', 'Experimental: 明示的な読み取り専用diagnostic bridgeがある場合だけ表示します。'));
    for (const [label, result] of [['Pinia', states.pinia], ['TanStack Query', states.tanstackQuery]]) {
        const details = element('details');
        details.append(element('summary', undefined, `${label} · ${result.detected ? 'Detected' : 'Not detected'}`), element('p', 'summary', result.message));
        if (result.detected)
            details.append(jsonView(result.data, true, `framework:${label}`));
        section.append(details);
    }
    return section;
}
function truncate(value, length = 120) {
    if (value === null)
        return '—';
    return value.length > length ? `${value.slice(0, length)}…` : value;
}
function emptyTimeline() {
    return { active: false, capacity: 300, eventCount: 0, events: [] };
}
function renderChangeTimeline(snapshot) {
    const section = element('section');
    section.append(element('div', 'notice warning', 'Recordを押した後のlocalStorage / sessionStorageの標準API操作を記録します。記録はこのページ内だけに保持され、Refreshや画面遷移をまたいで保存されません。'));
    const controls = element('div', 'timeline-controls');
    const recordButton = element('button', 'action-button', snapshot.active ? 'Recording…' : 'Record');
    recordButton.type = 'button';
    recordButton.disabled = snapshot.active;
    recordButton.addEventListener('click', () => { void startChangeTracking(); });
    const stopButton = element('button', 'action-button', 'Stop');
    stopButton.type = 'button';
    stopButton.disabled = !snapshot.active;
    stopButton.addEventListener('click', () => { void stopChangeTracking(); });
    const clearButton = element('button', 'action-button', 'Clear');
    clearButton.type = 'button';
    clearButton.disabled = snapshot.eventCount === 0;
    clearButton.addEventListener('click', () => { void clearChangeTracking(); });
    const status = element('span', `status${snapshot.active ? ' detected' : ''}`, snapshot.active ? `Recording · ${snapshot.eventCount}/${snapshot.capacity}` : `Stopped · ${snapshot.eventCount} event(s)`);
    controls.append(recordButton, stopButton, clearButton, status);
    section.append(controls);
    if (!snapshot.active) {
        section.append(element('p', 'summary', snapshot.eventCount ? '記録は停止中です。保存済みイベントを確認するか、Recordで新しい記録を開始できます。' : 'まだ記録されていません。Recordを押してから対象アプリを操作してください。'));
    }
    else {
        section.append(element('p', 'summary', '記録中です。対象アプリを操作すると、イベントが約0.7秒ごとに表示されます。'));
    }
    const events = snapshot.events.filter((event) => matchesQuery([
        event.storageArea,
        event.operation,
        event.key ?? '',
        event.oldValue ?? '',
        event.newValue ?? '',
        ...(event.stack ?? []),
    ])).slice().reverse();
    if (events.length === 0) {
        section.append(element('div', 'empty', state.query ? '検索条件に一致する変更イベントはありません。' : '表示する変更イベントはありません。'));
        return section;
    }
    const { table, body } = createTable(['When', 'Storage', 'Operation', 'Key', 'Before → After', 'Where']);
    for (const event of events) {
        const row = element('tr');
        const values = element('td', 'value-cell');
        const details = element('details');
        const summary = element('summary', undefined, `${truncate(event.oldValue)}  →  ${truncate(event.newValue)}`);
        details.append(summary);
        const detailText = [
            `before: ${event.oldValue ?? 'null'}`,
            `after: ${event.newValue ?? 'null'}`,
            event.clearedEntries ? `cleared: ${JSON.stringify(event.clearedEntries)}` : '',
            event.error ? `error: ${event.error}` : '',
        ].filter(Boolean).join('\\n');
        details.append(jsonView(detailText, false));
        values.append(details);
        const stackCell = element('td', 'value-cell');
        stackCell.append(element('pre', 'value-text', event.stack?.[0] ?? event.externalUrl ?? 'Unknown'));
        row.append(element('td', undefined, new Date(event.timestamp).toLocaleTimeString()), element('td', undefined, event.storageArea), element('td', undefined, event.operation), element('td', 'key-cell', event.key ?? (event.clearedEntries ? `clear (${event.clearedEntries.length} keys)` : '—')), values, stackCell);
        body.append(row);
    }
    section.append(table);
    return section;
}
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
}
function currentFocusedEvent(timeline = debugSession.getTimeline()) {
    if (!focusedEventId)
        return undefined;
    const event = timeline.find((candidate) => candidate.id === focusedEventId);
    return event && isFailureTimelineEvent(event) ? event : undefined;
}
function focusExportOnEvent(eventId) {
    focusedEventId = eventId;
    state.selected = 'ai-export';
    state.query = '';
    syncStoragePolling();
    if (debugSession.getStatus().active)
        startDebugPolling();
    void refreshPanel();
}
function renderDebugControls() {
    const controls = element('div', 'timeline-controls');
    const status = debugSession.getStatus();
    const start = element('button', 'action-button', 'Start Recording');
    start.type = 'button';
    start.disabled = status.active;
    start.addEventListener('click', () => { void startDebugRecording(); });
    const stop = element('button', 'action-button', 'Stop');
    stop.type = 'button';
    stop.disabled = !status.active;
    stop.addEventListener('click', () => { void stopDebugRecording(); });
    const clearButton = element('button', 'action-button', 'Clear');
    clearButton.type = 'button';
    clearButton.disabled = !status.active && status.eventCount === 0 && status.networkCount === 0 && status.errorCount === 0 && status.userActionCount === 0 && status.routeChangeCount === 0;
    clearButton.addEventListener('click', () => { void clearDebugRecording(); });
    const indicator = element('span', `status${status.active ? ' detected' : ''}`, status.active ? `Recording · ${status.eventCount} events · ${status.userActionCount} actions` : `Stopped · ${status.eventCount} events`);
    controls.append(start, stop, clearButton, indicator);
    return controls;
}
async function saveRecording(name) {
    await debugSession.refresh();
    const recording = {
        id: crypto.randomUUID(), name: name.trim() || `Recording ${recordings.length + 1}`, createdAt: new Date().toISOString(), session: debugSession.getStatus(),
        timeline: debugSession.getTimeline(), network: debugSession.getNetwork(), errors: debugSession.getErrors(), storageChanges: await debugSession.getStorageChanges(), userActions: await debugSession.getUserActions(), routeChanges: await debugSession.getRouteChanges(),
        snapshots: [beforeSnapshot, afterSnapshot].filter((snapshot) => Boolean(snapshot)), selectedElements: selectedElementSnapshots.map((snapshot) => ({ ...snapshot, summary: { ...snapshot.summary } })),
    };
    recordings.push(recording);
    if (recordings.length > 2)
        recordings.splice(0, recordings.length - 2);
    normalRecordingId ??= recording.id;
    brokenRecordingId = recording.id;
    recordingComparison = undefined;
    renderCurrentData();
}
function renderRecordings() {
    const section = element('section');
    section.append(element('p', 'summary', '停止したDebug Recordingをローカルに最大2件保持します。正常系と異常系を保存してCompareへ進みます。新しい記録を開始する前に保存してください。'));
    const form = element('div', 'timeline-controls');
    const name = element('input', 'compact-input');
    name.placeholder = 'Recording name (Normal / Broken)';
    name.maxLength = 80;
    const save = element('button', 'action-button', 'Save current recording');
    save.type = 'button';
    save.disabled = debugSession.getStatus().active || debugSession.getStatus().eventCount === 0;
    save.addEventListener('click', () => { void saveRecording(name.value); });
    form.append(name, save);
    section.append(form);
    if (!recordings.length) {
        section.append(element('div', 'empty', '保存済みRecordingはありません。'));
        return section;
    }
    const { table, body } = createTable(['Name', 'Created', 'Events', 'Network', 'Errors']);
    for (const item of recordings) {
        const row = element('tr');
        row.append(element('td', 'key-cell', item.name), element('td', undefined, formatTime(item.createdAt)), element('td', undefined, String(item.timeline.length)), element('td', undefined, String(item.network.length)), element('td', undefined, String(item.errors.length)));
        body.append(row);
    }
    section.append(table);
    return section;
}
function recordingSelect(value, label, onChange) {
    const field = element('label', 'field-label', label);
    const select = element('select', 'interval-select');
    for (const recording of recordings) {
        const option = element('option');
        option.value = recording.id;
        option.textContent = recording.name;
        option.selected = recording.id === value;
        select.append(option);
    }
    select.addEventListener('change', () => { onChange(select.value || undefined); recordingComparison = undefined; renderCurrentData(); });
    field.append(select);
    return field;
}
function renderCompare() {
    const section = element('section');
    section.append(element('p', 'summary', '時間・イベント種別・Storageキー・API endpointをbest effortで対応付けます。表示は因果関係を証明しません。'));
    if (recordings.length < 2) {
        section.append(element('div', 'empty', 'Compareには2つの保存済みRecordingが必要です。'));
        return section;
    }
    const controls = element('div', 'focused-export-fields');
    controls.append(recordingSelect(normalRecordingId, 'Normal recording', (id) => { normalRecordingId = id; }), recordingSelect(brokenRecordingId, 'Broken recording', (id) => { brokenRecordingId = id; }));
    const compare = element('button', 'action-button', 'Compare Recordings');
    compare.type = 'button';
    compare.addEventListener('click', () => { const normal = recordings.find((item) => item.id === normalRecordingId); const broken = recordings.find((item) => item.id === brokenRecordingId); if (normal && broken && normal !== broken)
        recordingComparison = compareRecordings(normal, broken); renderCurrentData(); });
    controls.append(compare);
    section.append(controls);
    if (!recordingComparison)
        return section;
    const divergence = recordingComparison.firstDivergence;
    section.append(element('h3', undefined, 'First Divergence'), element('pre', 'value-text', divergence ? `${formatTime(divergence.timestamp)}\n${divergence.key}\nNormal: ${JSON.stringify(divergence.normal)}\nBroken: ${JSON.stringify(divergence.broken)}` : 'No comparable divergence found.'));
    section.append(element('h3', undefined, 'Debug Summary'));
    section.append(element('pre', 'value-text', recordingComparison.suspiciousEvents.length ? recordingComparison.suspiciousEvents.map((item) => `${formatTime(item.event.timestamp)} ${item.reason}: ${item.event.summary}${item.previous ? `\nPrevious: ${item.previous.summary}` : ''}`).join('\n\n') : 'No suspicious events identified.'));
    section.append(element('h3', undefined, 'Network Differences'));
    section.append(element('pre', 'value-text', recordingComparison.networkDifferences.length ? recordingComparison.networkDifferences.map((item) => `${item.key}\n${item.differences.map((diff) => `${diff.path}\n- ${JSON.stringify(diff.before)}\n+ ${JSON.stringify(diff.after)}`).join('\n')}`).join('\n\n') : 'No network differences found.'));
    section.append(element('h3', undefined, 'Possibly Related Event Chains'));
    section.append(element('pre', 'value-text', recordingComparison.eventChains.length ? recordingComparison.eventChains.map((chain) => `Event Chain #${chain.id}\n${chain.events.map((event) => `${formatTime(event.timestamp)} ${event.kind} ${event.summary}`).join('\n↓\n')}`).join('\n\n') : 'No related event chains found.'));
    return section;
}
function timelineDetails(event) {
    if (event.kind === 'user-action')
        return [event.summary, event.target.text ? `text: ${event.target.text}` : '', event.target.value !== undefined ? `value: ${event.target.value}` : '', event.target.ariaLabel ? `aria-label: ${event.target.ariaLabel}` : ''].filter(Boolean).join('\n');
    if (event.kind === 'route-change')
        return `${event.routeType}\nfrom: ${event.from}\nto: ${event.to}`;
    if (event.kind === 'frame-added' || event.kind === 'frame-navigated' || event.kind === 'frame-removed') {
        const parts = [event.summary];
        if (event.fromUrl)
            parts.push(`from: ${event.fromUrl}`);
        if (event.frame.parentFrameId !== undefined)
            parts.push(`parent: ${String(event.frame.parentFrameId)}`);
        return parts.join('\n');
    }
    return event.summary;
}
function timelineIcon(event) {
    if (event.kind === 'user-action')
        return '●';
    if (event.kind === 'route-change')
        return '↗';
    if (event.kind === 'storage')
        return '◆';
    if (event.kind.startsWith('network-'))
        return isFailureTimelineEvent(event) ? '⚠' : '⇄';
    if (event.kind === 'frame-added')
        return '⊕';
    if (event.kind === 'frame-navigated')
        return '⇉';
    if (event.kind === 'frame-removed')
        return '⊖';
    return isFailureTimelineEvent(event) ? '✕' : '!';
}
/** Short label for a frame, used in UI badges and AI export. */
function frameLabel(event) {
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
function renderSelectedTimelineContext(timeline) {
    const selected = selectedTimelineEventId ? timeline.find((event) => event.id === selectedTimelineEventId) : undefined;
    if (!selected)
        return undefined;
    const window = createEventContextWindow(selected);
    if (!window)
        return undefined;
    const related = filterTimelineAroundEvent(timeline, window);
    const section = element('section', 'event-context');
    section.append(element('h3', undefined, 'Selected Event'), element('pre', 'value-text', `${formatTime(selected.timestamp)} ${selected.kind}\n${timelineDetails(selected)}`));
    section.append(element('h3', undefined, 'Related Events'));
    section.append(element('pre', 'value-text', related.map((event) => {
        const offset = Date.parse(event.timestamp) - Date.parse(selected.timestamp);
        const when = offset === 0 ? 'Selected' : `${offset > 0 ? '+' : ''}${(offset / 1000).toFixed(1)} sec`;
        return `${when}  ${timelineIcon(event)} ${event.kind}  ${timelineDetails(event).replace(/\n/g, ' ')}`;
    }).join('\n')));
    const copy = element('button', 'action-button', 'Copy event context');
    copy.type = 'button';
    copy.addEventListener('click', () => { void copyEventContext(selected, copy); });
    section.append(copy);
    return section;
}
function renderDebugTimeline() {
    const section = element('section');
    section.append(renderDebugControls(), element('p', 'summary', 'User Action、Route Change、Storage変更、Network、JavaScript Error、console.error / warnを表示します。行を選ぶと前後のRelated Eventsを確認し、Copy event contextで前5秒・後2秒の関連データをコピーできます。時刻の近接は因果関係を保証しません。'));
    const allTimeline = debugSession.getTimeline();
    const filters = element('div', 'filter-controls');
    for (const [value, label] of [['all', 'All'], ['important', 'Important']]) {
        const button = element('button', `filter-button${timelineView === value ? ' active' : ''}`, label);
        button.type = 'button';
        button.addEventListener('click', () => { timelineView = value; renderCurrentData(); });
        filters.append(button);
    }
    section.append(filters);
    // ── Frame filter dropdown ──────────────────────────────────────────────────
    // Collect distinct frames from timeline events that carry a frame field.
    const frameOptions = new Map(); // key → display label
    frameOptions.set('all', 'All Frames');
    frameOptions.set('main', 'Main Frame');
    for (const event of allTimeline) {
        if (event.frame && !event.frame.isMainFrame) {
            const key = event.frame.url;
            if (!frameOptions.has(key)) {
                try {
                    const parsed = new URL(key);
                    const display = parsed.pathname === '/' ? parsed.hostname : parsed.pathname.slice(0, 40);
                    frameOptions.set(key, `iframe: ${display}`);
                }
                catch {
                    frameOptions.set(key, `iframe: ${key.slice(0, 40)}`);
                }
            }
        }
    }
    if (frameOptions.size > 2) {
        const frameFilterRow = element('div', 'filter-controls');
        const label = element('label', 'field-label', 'Frame: ');
        const select = element('select', 'interval-select');
        for (const [key, displayLabel] of frameOptions.entries()) {
            const option = element('option');
            option.value = key;
            option.textContent = displayLabel;
            option.selected = key === timelineFrameFilter;
            select.append(option);
        }
        select.addEventListener('change', () => { timelineFrameFilter = select.value; renderCurrentData(); });
        label.append(select);
        frameFilterRow.append(label);
        section.append(frameFilterRow);
    }
    const events = allTimeline
        .filter((event) => timelineView === 'all' || isImportantTimelineEvent(event, allTimeline))
        .filter((event) => {
        if (timelineFrameFilter === 'all')
            return true;
        if (timelineFrameFilter === 'main')
            return !event.frame || event.frame.isMainFrame;
        return event.frame?.url === timelineFrameFilter;
    })
        .filter((event) => matchesQuery([event.kind, event.summary, timelineDetails(event)]))
        .slice().reverse();
    if (events.length === 0) {
        section.append(element('div', 'empty', 'Start Recordingを押してから対象アプリを操作してください。'));
        return section;
    }
    const { table, body } = createTable(['When', 'Frame', 'Type', 'Summary', 'Context']);
    for (const event of events) {
        const row = element('tr', `${isImportantTimelineEvent(event, allTimeline) ? 'important-event' : ''}${event.id === selectedTimelineEventId ? ' selected-event' : ''}`);
        row.tabIndex = 0;
        row.addEventListener('click', () => { selectedTimelineEventId = event.id; renderCurrentData(); });
        row.addEventListener('keydown', (key) => { if (key.key === 'Enter' || key.key === ' ') {
            key.preventDefault();
            selectedTimelineEventId = event.id;
            renderCurrentData();
        } });
        const contextCell = element('td');
        const copy = element('button', 'action-button', 'Copy event context');
        copy.type = 'button';
        copy.addEventListener('click', (click) => { click.stopPropagation(); void copyEventContext(event, copy); });
        contextCell.append(copy);
        const frameBadge = element('td', 'key-cell frame-badge', frameLabel(event));
        if (event.frame?.isCrossOrigin)
            frameBadge.title = 'Cross-origin frame';
        row.append(element('td', undefined, formatTime(event.timestamp)), frameBadge, element('td', 'key-cell', `${timelineIcon(event)} ${event.kind}`), element('td', 'value-cell', timelineDetails(event)), contextCell);
        body.append(row);
    }
    section.append(table);
    const context = renderSelectedTimelineContext(allTimeline);
    if (context)
        section.append(context);
    return section;
}
function renderNetwork() {
    const section = element('section');
    section.append(renderDebugControls());
    const currentNetwork = debugSession.getNetwork();
    const displayedNetwork = networkUpdateState.entries(currentNetwork);
    const pendingCount = networkUpdateState.pendingCount(currentNetwork);
    const updates = element('div', 'timeline-controls');
    const pause = element('button', 'action-button', networkUpdateState.paused ? `Resume updates${pendingCount ? ` (${pendingCount} new)` : ''}` : 'Pause updates');
    pause.type = 'button';
    pause.addEventListener('click', () => {
        if (networkUpdateState.paused) {
            networkUpdateState.resume();
        }
        else {
            networkUpdateState.pause(currentNetwork);
        }
        renderCurrentData();
    });
    updates.append(pause, element('span', 'status', networkUpdateState.paused ? `${pendingCount} new requests` : 'Live updates'));
    section.append(updates);
    const filters = element('div', 'filter-controls');
    for (const [id, label] of [['all', 'All'], ['fetch-xhr', 'Fetch/XHR'], ['error-only', 'Error only'], ['http-error', '4xx / 5xx']]) {
        const button = element('button', `filter-button${networkFilter === id ? ' active' : ''}`, label);
        button.type = 'button';
        button.addEventListener('click', () => { networkFilter = id; renderCurrentData(); });
        filters.append(button);
    }
    section.append(filters);
    const entries = displayedNetwork.filter((entry) => matchesNetworkFilter(entry, networkFilter)).filter((entry) => matchesQuery([entry.method, entry.url, entry.status, entry.statusText, entry.resourceType ?? ''])).slice().reverse();
    section.append(element('p', 'summary', `${entries.length} 件${networkFilter !== 'all' ? '（フィルタ適用）' : ''}。response bodyは取得できた場合のみ最大100KiBまで表示します。`));
    if (entries.length === 0) {
        section.append(element('div', 'empty', '該当するNetwork記録はありません。Start Recording以降の完了リクエストが対象です。'));
        return section;
    }
    const { table, body } = createTable(['When', 'Method', 'URL', 'Status', 'Duration', 'Details', 'Related events', 'Focused export']);
    for (const entry of entries) {
        const detailCell = element('td', 'value-cell');
        const details = element('details');
        const expansionKey = `network-details:${entry.id}`;
        details.open = jsonExpansionState.isExpanded(expansionKey);
        const summary = element('summary', undefined, 'Headers / body');
        // Recording refreshes this table every 500ms. Remember the state before the
        // old DOM is replaced so a user can read and copy a body while recording.
        summary.addEventListener('click', () => { jsonExpansionState.setExpanded(expansionKey, !details.open); });
        details.addEventListener('toggle', () => { jsonExpansionState.setExpanded(expansionKey, details.open); });
        details.append(summary, copyButton(formatNetworkExchange(entry), 'Copy request / response'));
        details.append(element('h4', undefined, 'Request headers'), jsonView(entry.requestHeaders, false));
        details.append(element('h4', undefined, 'Request body'), element('pre', 'value-text', networkBodyText(entry.requestBody)));
        details.append(element('h4', undefined, 'Response headers'), jsonView(entry.responseHeaders, false));
        const responseBodyHeading = element('h4', undefined, 'Response body');
        if (entry.responseBody.available)
            responseBodyHeading.append(copyButton(entry.responseBody.text ?? '', 'Copy response body'));
        details.append(responseBodyHeading, element('pre', 'value-text', networkBodyText(entry.responseBody)));
        detailCell.append(details);
        const row = element('tr');
        const relatedCell = element('td');
        const related = element('button', 'action-button', 'Show related events');
        related.type = 'button';
        related.addEventListener('click', () => {
            selectedTimelineEventId = `${entry.id}-response`;
            state.selected = 'debug-timeline';
            state.query = '';
            renderCurrentData();
        });
        relatedCell.append(related);
        const exportCell = element('td');
        if (entry.status === 0 || entry.status >= 400 || entry.error) {
            const exportButton = element('button', 'action-button', 'Export around event');
            exportButton.type = 'button';
            exportButton.addEventListener('click', () => { focusExportOnEvent(`${entry.id}-response`); });
            exportCell.append(exportButton);
        }
        else {
            exportCell.textContent = '—';
        }
        row.append(element('td', undefined, formatTime(entry.timestamp)), element('td', 'key-cell', entry.method), element('td', 'value-cell', entry.url), element('td', undefined, `${entry.status || '—'} ${entry.statusText}`), element('td', undefined, `${entry.durationMs} ms`), detailCell, relatedCell, exportCell);
        body.append(row);
    }
    section.append(table);
    return section;
}
function renderErrors() {
    const section = element('section');
    section.append(renderDebugControls());
    const errors = debugSession.getErrors().filter((error) => matchesQuery([error.kind, error.message, error.sourceUrl ?? '', ...error.stack])).slice().reverse();
    section.append(element('p', 'summary', `${errors.length} 件。error、unhandledrejection、console.error、console.warnを重複を抑えて記録します。`));
    if (errors.length === 0) {
        section.append(element('div', 'empty', 'JavaScript Errorは記録されていません。'));
        return section;
    }
    const { table, body } = createTable(['When', 'Kind', 'Message', 'Source', 'Stack', 'Focused export']);
    for (const error of errors) {
        const row = element('tr');
        const exportCell = element('td');
        if (error.kind !== 'console-warn') {
            const exportButton = element('button', 'action-button', 'Export around event');
            exportButton.type = 'button';
            exportButton.addEventListener('click', () => { focusExportOnEvent(`error-${error.id}`); });
            exportCell.append(exportButton);
        }
        else {
            exportCell.textContent = '—';
        }
        row.append(element('td', undefined, formatTime(error.timestamp)), element('td', 'key-cell', error.kind), element('td', 'value-cell', error.duplicateCount > 1 ? `${error.message} (×${error.duplicateCount})` : error.message), element('td', 'value-cell', error.sourceUrl ? `${error.sourceUrl}:${error.line ?? '?'}:${error.column ?? '?'}` : 'Not available'), element('td', 'value-cell', error.stack.join('\n') || 'Not available'), exportCell);
        body.append(row);
    }
    section.append(table);
    return section;
}
function renderSnapshotSummary(slot, snapshot) {
    if (!snapshot)
        return element('div', 'empty', `${slot} Snapshotは未取得です。`);
    return element('div', 'snapshot-summary', `${slot}: ${snapshot.label} · ${snapshot.timestamp} · ${snapshot.page.title || 'Untitled'} · ${snapshot.page.url}`);
}
function snapshotLabelInput(slot) {
    const input = element('input', 'compact-input');
    input.type = 'text';
    input.maxLength = 80;
    input.value = slot === 'before' ? beforeSnapshotLabel : afterSnapshotLabel;
    input.placeholder = slot === 'before' ? 'Snapshot 1' : 'Snapshot 2';
    input.setAttribute('aria-label', `${slot} snapshot label`);
    input.addEventListener('input', () => {
        if (slot === 'before')
            beforeSnapshotLabel = input.value;
        else
            afterSnapshotLabel = input.value;
    });
    return input;
}
function renderSelectedElementSnapshots() {
    const section = element('section', 'selected-element-section');
    section.append(element('h3', undefined, 'Selected DOM Snapshot'));
    if (selectedElementSnapshots.length === 0) {
        section.append(element('p', 'summary', 'Elementsパネルで選択した要素だけを取得します。ページ全体のDOMは取得しません。'));
        return section;
    }
    for (const snapshot of selectedElementSnapshots.slice().reverse()) {
        const details = element('details');
        details.append(element('summary', undefined, `${snapshot.summary.selector} · ${formatTime(snapshot.timestamp)}`), jsonView(snapshot, false));
        section.append(details);
    }
    return section;
}
function renderSnapshots() {
    const section = element('section');
    const labels = element('div', 'snapshot-label-controls');
    const beforeLabel = element('label', 'field-label', 'Before label');
    beforeLabel.append(snapshotLabelInput('before'));
    const afterLabel = element('label', 'field-label', 'After label');
    afterLabel.append(snapshotLabelInput('after'));
    labels.append(beforeLabel, afterLabel);
    const controls = element('div', 'timeline-controls');
    const before = element('button', 'action-button', 'Capture Snapshot 1');
    before.type = 'button';
    before.addEventListener('click', () => { void captureSnapshot('before'); });
    const after = element('button', 'action-button', 'Capture Snapshot 2');
    after.type = 'button';
    after.addEventListener('click', () => { void captureSnapshot('after'); });
    const selected = element('button', 'action-button', 'Capture Selected Element');
    selected.type = 'button';
    selected.addEventListener('click', () => { void captureSelectedElement(); });
    const diff = element('button', 'action-button', 'Diff');
    diff.type = 'button';
    diff.disabled = !beforeSnapshot || !afterSnapshot;
    diff.addEventListener('click', () => { if (beforeSnapshot && afterSnapshot) {
        currentDiff = diffSnapshots(beforeSnapshot, afterSnapshot).entries;
        renderCurrentData();
    } });
    controls.append(before, after, selected, diff);
    section.append(labels, controls, renderSnapshotSummary('Snapshot 1', beforeSnapshot), renderSnapshotSummary('Snapshot 2', afterSnapshot));
    for (const [label, snapshot] of [['Raw Snapshot 1', beforeSnapshot], ['Raw Snapshot 2', afterSnapshot]]) {
        if (!snapshot)
            continue;
        const raw = element('details');
        raw.append(element('summary', undefined, label), jsonView(snapshot, true, `snapshot-raw:${label}`));
        section.append(raw);
    }
    const collectionErrors = [...(beforeSnapshot?.collectionErrors ?? []), ...(afterSnapshot?.collectionErrors ?? [])];
    if (collectionErrors.length) {
        section.append(renderUnavailable(`Snapshotの一部を取得できませんでした。${collectionErrors.join(' / ')}`, true));
    }
    section.append(renderSelectedElementSnapshots());
    if (!currentDiff) {
        section.append(element('p', 'summary', 'Snapshot 1を取得して対象アプリを操作し、Snapshot 2を取得してからDiffを選択してください。URL、Storage、Cookie、明示的診断ブリッジのFramework Stateを比較します。'));
        return section;
    }
    section.append(element('p', 'summary', `${beforeSnapshot?.label ?? 'Snapshot 1'} vs ${afterSnapshot?.label ?? 'Snapshot 2'}: ${currentDiff.length} 件の差分。Storage、Cookie、明示的診断ブリッジのFramework Stateを比較します。`));
    if (currentDiff.length === 0) {
        section.append(element('div', 'empty', 'Before / Afterの差分はありません。'));
        return section;
    }
    const { table, body } = createTable(['Kind', 'Path', 'Before', 'After']);
    for (const entry of currentDiff) {
        const row = element('tr');
        row.append(element('td', undefined, entry.kind), element('td', 'key-cell', entry.path), element('td', 'value-cell', JSON.stringify(entry.before)), element('td', 'value-cell', JSON.stringify(entry.after)));
        body.append(row);
    }
    section.append(table);
    return section;
}
function renderFocusedExportControls(timeline) {
    const section = element('section', 'focused-export-controls');
    section.append(element('h3', undefined, 'Export context around a failure'));
    const failures = timeline.filter(isFailureTimelineEvent);
    if (focusedEventId && !currentFocusedEvent(timeline))
        focusedEventId = undefined;
    if (failures.length === 0) {
        section.append(element('p', 'summary', '選択できる失敗イベントはありません。4xx / 5xx・通信失敗・JavaScript / Console Errorを記録すると、前後時間だけの限定Exportを作成できます。'));
        return section;
    }
    const eventLabel = element('label', 'field-label', 'Failure event');
    const eventSelect = element('select', 'interval-select');
    const fullOption = element('option');
    fullOption.value = '';
    fullOption.textContent = 'Full recording (no focused event)';
    eventSelect.append(fullOption);
    for (const failure of failures) {
        const option = element('option');
        option.value = failure.id;
        option.textContent = `${formatTime(failure.timestamp)} · ${failure.kind} · ${truncate(failure.summary, 110)}`;
        option.selected = failure.id === focusedEventId;
        eventSelect.append(option);
    }
    eventSelect.addEventListener('change', () => {
        focusedEventId = eventSelect.value || undefined;
        renderCurrentData();
    });
    eventLabel.append(eventSelect);
    const beforeLabel = element('label', 'field-label', 'Seconds before');
    const beforeInput = element('input', 'compact-input');
    beforeInput.type = 'number';
    beforeInput.min = '0';
    beforeInput.max = '60';
    beforeInput.step = '1';
    beforeInput.value = String(focusedBeforeMs / 1000);
    beforeInput.addEventListener('input', () => { focusedBeforeMs = Math.max(0, Math.min(60_000, Number(beforeInput.value || 0) * 1000)); });
    beforeLabel.append(beforeInput);
    const afterLabel = element('label', 'field-label', 'Seconds after');
    const afterInput = element('input', 'compact-input');
    afterInput.type = 'number';
    afterInput.min = '0';
    afterInput.max = '60';
    afterInput.step = '1';
    afterInput.value = String(focusedAfterMs / 1000);
    afterInput.addEventListener('input', () => { focusedAfterMs = Math.max(0, Math.min(60_000, Number(afterInput.value || 0) * 1000)); });
    afterLabel.append(afterInput);
    const fields = element('div', 'focused-export-fields');
    fields.append(eventLabel, beforeLabel, afterLabel);
    section.append(fields);
    const focused = currentFocusedEvent(timeline);
    if (focused) {
        const window = createFocusedEventWindow(focused, focusedBeforeMs, focusedAfterMs);
        section.append(element('p', 'summary', window ? `${formatTime(window.startTimestamp)} から ${formatTime(window.endTimestamp)} までを出力します。選択イベントと同時刻または近接時刻は因果関係を意味しません。` : '選択イベントの時刻を解釈できないため、限定Exportを生成できません。'));
        const clearButton = element('button', 'action-button', 'Clear focused event');
        clearButton.type = 'button';
        clearButton.addEventListener('click', () => { focusedEventId = undefined; renderCurrentData(); });
        section.append(clearButton);
    }
    return section;
}
function renderAiExport() {
    const section = element('section');
    const status = debugSession.getStatus();
    const timeline = debugSession.getTimeline();
    section.append(element('div', 'notice warning', 'Copy for AIは外部送信を行いません。貼り付け前にCookie、Authorization、token、個人情報、顧客情報などの機密情報を必ず確認してください。'));
    section.append(element('p', 'summary', `Events: ${status.eventCount} · Actions: ${status.userActionCount} · Routes: ${status.routeChangeCount} · Errors: ${status.errorCount} · Network: ${status.networkCount} · Snapshots: ${Number(Boolean(beforeSnapshot)) + Number(Boolean(afterSnapshot))} · Selected DOM: ${selectedElementSnapshots.length}`));
    const notesSection = element('div', 'reproduction-notes');
    notesSection.append(element('h3', undefined, 'Reproduction Notes'));
    const noteFields = [
        ['expectedResult', 'Expected Result', '期待する結果を入力'],
        ['actualResult', 'Actual Result', '実際の結果を入力'],
        ['reproductionSteps', 'Reproduction Steps', '1. 操作\n2. 操作\n3. 操作'],
        ['additionalNotes', 'Additional Notes', '再現条件、頻度、補足を入力'],
    ];
    for (const [key, labelText, placeholder] of noteFields) {
        const labelNode = element('label', 'field-label', labelText);
        const input = element('textarea', 'notes-input');
        input.value = reproductionNotes[key];
        input.placeholder = placeholder;
        input.rows = key === 'reproductionSteps' ? 4 : 2;
        input.addEventListener('input', () => { reproductionNotes = { ...reproductionNotes, [key]: input.value }; });
        labelNode.append(input);
        notesSection.append(labelNode);
    }
    const formatControls = element('div', 'format-controls');
    for (const [value, label] of [['markdown', 'Markdown'], ['json', 'JSON']]) {
        const labelNode = element('label', 'toggle-label');
        const input = element('input');
        input.type = 'radio';
        input.name = 'export-format';
        input.value = value;
        input.checked = exportFormat === value;
        input.addEventListener('change', () => { exportFormat = value; renderCurrentData(); });
        labelNode.append(input, document.createTextNode(label));
        formatControls.append(labelNode);
    }
    const copy = element('button', 'action-button', 'Copy for AI');
    copy.type = 'button';
    copy.addEventListener('click', () => { void copyForAi(copy); });
    const focused = currentFocusedEvent(timeline);
    copy.textContent = focused ? 'Copy focused context' : 'Copy for AI';
    section.append(notesSection, renderFocusedExportControls(timeline), formatControls, copy, element('p', 'summary', focused ? '選択した失敗イベントの前後時間内にある操作・Route・Storage・Network・Errorだけを優先して出力します。' : '再現メモ、JavaScript / Console Error、失敗したNetwork、User Action、Route Change、Storage変更、Unified Timeline、Snapshot Diffの順に優先して出力します。'));
    return section;
}
async function buildAiContext(eventContextAnchor) {
    await debugSession.refresh();
    let selectedSnapshot = afterSnapshot ?? beforeSnapshot;
    if (!selectedSnapshot) {
        const captured = await snapshotService.capture('Current state');
        if (captured.ok && captured.data) {
            afterSnapshot = captured.data;
            selectedSnapshot = captured.data;
        }
    }
    const allTimeline = debugSession.getTimeline();
    const focusedEvent = eventContextAnchor ? undefined : currentFocusedEvent(allTimeline);
    const focusedWindow = focusedEvent ? createFocusedEventWindow(focusedEvent, focusedBeforeMs, focusedAfterMs) : undefined;
    const eventContext = eventContextAnchor ? createEventContextWindow(eventContextAnchor) : undefined;
    const activeWindow = eventContext ?? focusedWindow;
    const [allStorageChanges, allUserActions, allRouteChanges] = await Promise.all([
        debugSession.getStorageChanges(),
        debugSession.getUserActions(),
        debugSession.getRouteChanges(),
    ]);
    const allNetwork = debugSession.getNetwork();
    const allErrors = debugSession.getErrors();
    const timeline = activeWindow ? filterTimelineAroundEvent(allTimeline, activeWindow) : allTimeline;
    const network = activeWindow ? filterNetworkAroundEvent(allNetwork, activeWindow) : allNetwork;
    const errors = activeWindow ? filterErrorsAroundEvent(allErrors, activeWindow) : allErrors;
    const storageChanges = activeWindow ? filterStorageAroundEvent(allStorageChanges, activeWindow) : allStorageChanges;
    const userActions = activeWindow ? filterActionsAroundEvent(allUserActions, activeWindow) : allUserActions;
    const routeChanges = activeWindow ? filterRoutesAroundEvent(allRouteChanges, activeWindow) : allRouteChanges;
    const selectedElements = activeWindow ? filterSelectedElementsAroundEvent(selectedElementSnapshots, activeWindow) : selectedElementSnapshots;
    const fullSession = debugSession.getStatus();
    const session = activeWindow ? {
        ...fullSession,
        eventCount: timeline.length,
        networkCount: network.length,
        errorCount: errors.length,
        userActionCount: userActions.length,
        routeChangeCount: routeChanges.length,
    } : fullSession;
    const diff = !activeWindow && beforeSnapshot && afterSnapshot ? diffSnapshots(beforeSnapshot, afterSnapshot) : undefined;
    return createAiDebugContext({
        page: activeWindow ? selectedSnapshot?.page : undefined,
        environment: activeWindow ? selectedSnapshot?.environment : undefined,
        before: activeWindow ? undefined : beforeSnapshot,
        after: activeWindow ? undefined : selectedSnapshot,
        diff,
        network,
        errors,
        storageChanges,
        timeline,
        session,
        userActions,
        routeChanges,
        selectedElements,
        reproductionNotes: normalizeReproductionNotes(reproductionNotes),
        focusedEvent: focusedWindow,
        eventContext,
        comparison: recordingComparison,
    });
}
async function copyForAi(button) {
    button.disabled = true;
    button.textContent = 'Preparing…';
    const context = await buildAiContext();
    await copyText(exportFormat === 'markdown' ? formatAiContextMarkdown(context) : formatAiContextJson(context), button);
    button.disabled = false;
}
async function copyEventContext(event, button) {
    button.disabled = true;
    button.textContent = 'Preparing…';
    const context = await buildAiContext(event);
    await copyText(formatAiContextMarkdown(context), button);
    button.disabled = false;
}
async function captureSnapshot(target) {
    setBody(renderUnavailable(`${target === 'before' ? 'Before' : 'After'} Snapshotを取得しています。`));
    const label = target === 'before' ? beforeSnapshotLabel : afterSnapshotLabel;
    const result = await snapshotService.capture(label || (target === 'before' ? 'Snapshot 1' : 'Snapshot 2'));
    if (!result.ok || !result.data) {
        setBody(renderUnavailable(result.error ?? 'Snapshotを取得できません。', true));
        return;
    }
    if (target === 'before')
        beforeSnapshot = result.data;
    else
        afterSnapshot = result.data;
    currentDiff = undefined;
    renderCurrentData();
}
async function captureSelectedElement() {
    setBody(renderUnavailable('Elementsパネルで選択された要素を取得しています。'));
    const result = await selectedElementService.captureSelected();
    if (!result.ok) {
        setBody(renderUnavailable(result.error ?? '選択要素を取得できません。', true));
        return;
    }
    if (!result.data) {
        setBody(renderUnavailable('Elementsパネルで要素を選択してから、もう一度実行してください。'));
        return;
    }
    selectedElementSnapshots.push(result.data);
    if (selectedElementSnapshots.length > 3)
        selectedElementSnapshots.splice(0, selectedElementSnapshots.length - 3);
    renderCurrentData();
}
function stopDebugPolling() {
    if (debugPollId !== undefined)
        window.clearInterval(debugPollId);
    debugPollId = undefined;
}
function startDebugPolling() {
    stopDebugPolling();
    debugPollId = window.setInterval(() => {
        void debugSession.refresh().then(() => {
            if (['debug-timeline', 'network', 'errors', 'snapshots', 'ai-export'].includes(state.selected))
                renderCurrentData();
        });
    }, 500);
}
async function startDebugRecording() {
    setBody(renderUnavailable('User Action、Route Change、Storage、Network、Errorの記録を開始しています。'));
    const result = await debugSession.start();
    if (!result.ok) {
        setBody(renderUnavailable(result.error ?? 'Debug Recordingを開始できません。', true));
        return;
    }
    changeTrackingActive = true;
    syncStoragePolling();
    startDebugPolling();
    renderCurrentData();
}
async function stopDebugRecording() {
    const result = await debugSession.stop();
    if (!result.ok) {
        setBody(renderUnavailable(result.error ?? 'Debug Recordingを停止できません。', true));
        return;
    }
    changeTrackingActive = false;
    syncStoragePolling();
    stopDebugPolling();
    renderCurrentData();
}
async function clearDebugRecording() {
    const result = await debugSession.clear();
    if (!result.ok) {
        setBody(renderUnavailable(result.error ?? 'Debug Recordingを消去できません。', true));
        return;
    }
    renderCurrentData();
}
function stopTrackingPolling() {
    if (trackingPollId !== undefined)
        window.clearInterval(trackingPollId);
    trackingPollId = undefined;
}
async function updateTimelineFromPage(render = true) {
    const snapshot = await changeTracker.getSnapshot();
    if (!snapshot.ok || !snapshot.data) {
        stopTrackingPolling();
        if (render)
            setBody(renderUnavailable(snapshot.error ?? '変更記録を取得できません。', true));
        return;
    }
    state.loadedData = snapshot.data;
    changeTrackingActive = snapshot.data.active;
    syncStoragePolling();
    if (render && state.selected === 'change-timeline')
        renderCurrentData();
}
function startTrackingPolling() {
    stopTrackingPolling();
    trackingPollId = window.setInterval(() => {
        if (state.selected === 'change-timeline')
            void updateTimelineFromPage();
    }, 700);
}
async function startChangeTracking() {
    setBody(renderUnavailable('ページへStorage変更の記録フックを設定しています。'));
    const result = await changeTracker.start();
    if (!result.ok) {
        setBody(renderUnavailable(result.error ?? '変更記録を開始できません。', true));
        return;
    }
    await updateTimelineFromPage();
    startTrackingPolling();
    syncStoragePolling();
}
async function stopChangeTracking() {
    stopTrackingPolling();
    const result = await changeTracker.stop();
    if (!result.ok) {
        setBody(renderUnavailable(result.error ?? '変更記録を停止できません。', true));
        return;
    }
    await updateTimelineFromPage();
    syncStoragePolling();
}
async function clearChangeTracking() {
    const result = await changeTracker.clear();
    if (!result.ok) {
        setBody(renderUnavailable(result.error ?? '変更記録を消去できません。', true));
        return;
    }
    await updateTimelineFromPage();
}
function renderCurrentData() {
    updateHeader();
    if (state.loading) {
        setBody(renderUnavailable('検査対象ページから情報を取得しています。'));
        return;
    }
    if (state.selected === 'storage') {
        setBody(renderInspectStorage(state.loadedData));
        return;
    }
    if (state.selected === 'cookies') {
        setBody(renderCookies(state.loadedData));
        return;
    }
    if (state.selected === 'debug-timeline') {
        setBody(renderDebugTimeline());
        return;
    }
    if (state.selected === 'network') {
        setBody(renderNetwork());
        return;
    }
    if (state.selected === 'snapshots') {
        setBody(renderSnapshots());
        return;
    }
    if (state.selected === 'ai-export') {
        setBody(renderAiExport());
        return;
    }
    if (state.selected === 'framework-state') {
        setBody(renderFrameworkStates(state.loadedData));
        return;
    }
}
async function refreshPanel(options = {}) {
    const target = state.selected;
    const background = options.background ?? false;
    const isCurrent = () => state.selected === target;
    const finish = () => {
        if (!isCurrent())
            return;
        state.loading = false;
        renderCurrentData();
    };
    const fail = (message) => {
        if (!isCurrent())
            return;
        state.loading = false;
        updateHeader();
        setBody(renderUnavailable(message, true));
    };
    if (!background) {
        state.loading = true;
        renderCurrentData();
    }
    const info = await evaluator.getPageInfo();
    if (!isCurrent())
        return;
    state.pageUrl = info.ok && info.data ? info.data.url : '';
    if (!info.ok || !info.data) {
        fail(info.error ?? 'ページ情報の取得に失敗しました。');
        return;
    }
    if (['debug-timeline', 'network', 'snapshots', 'ai-export'].includes(target)) {
        await debugSession.refresh();
        if (!isCurrent())
            return;
        finish();
        return;
    }
    if (target === 'storage') {
        const [local, session] = await Promise.all([evaluator.getStorage('localStorage'), evaluator.getStorage('sessionStorage')]);
        if (!isCurrent())
            return;
        if (!local.ok || !local.data || !session.ok || !session.data) {
            fail(local.error ?? session.error ?? 'Storageを取得できません。');
            return;
        }
        state.loadedData = { local: local.data, session: session.data };
        finish();
        return;
    }
    if (target === 'cookies') {
        const result = await requestCookies(info.data.url);
        if (!isCurrent())
            return;
        if (!result.ok || !result.data) {
            fail(result.error ?? 'Cookieを取得できません。');
            return;
        }
        state.loadedData = result.data;
        finish();
        return;
    }
    if (target === 'framework-state') {
        const [pinia, tanstackQuery] = await Promise.all([evaluator.getFrameworkState('pinia'), evaluator.getFrameworkState('tanstackQuery')]);
        if (!isCurrent())
            return;
        if (!pinia.ok || !pinia.data || !tanstackQuery.ok || !tanstackQuery.data) {
            fail(pinia.error ?? tanstackQuery.error ?? 'Framework Stateを取得できません。');
            return;
        }
        state.loadedData = { pinia: pinia.data, tanstackQuery: tanstackQuery.data };
        finish();
    }
}
renderShell();
void refreshPanel();
