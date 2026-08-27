import { ChangeTracker } from './change-tracker.js';
import { PageEvaluator } from './page-evaluator.js';
import { StoragePollingController } from './storage-polling.js';
const evaluator = new PageEvaluator();
const changeTracker = new ChangeTracker(evaluator);
let trackingPollId;
let changeTrackingActive = false;
const root = document.querySelector('#app');
if (!root)
    throw new Error('Panel root was not found.');
const appRoot = root;
const state = {
    selected: 'local-storage',
    query: '',
    pageUrl: '',
    loadedData: [],
    loading: false,
    autoRefreshEnabled: false,
    autoRefreshIntervalMs: 1000,
};
const storagePolling = new StoragePollingController(() => ({ ...state, changeTrackingActive }), () => { void refreshPanel({ background: true }); });
const navItems = [
    { id: 'local-storage', label: 'Local Storage', group: 'Storage' },
    { id: 'session-storage', label: 'Session Storage', group: 'Storage' },
    { id: 'cookies', label: 'Cookies', group: 'Storage' },
    { id: 'indexeddb', label: 'IndexedDB', group: 'Storage' },
    { id: 'cache-storage', label: 'Cache Storage', group: 'Storage' },
    { id: 'change-timeline', label: 'State Change Timeline', group: 'Storage' },
    { id: 'pinia', label: 'Pinia', group: 'Framework', experimental: true },
    { id: 'tanstack-query', label: 'TanStack Query', group: 'Framework', experimental: true },
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
function copyButton(text) {
    const button = element('button', 'action-button inline-copy', 'Copy');
    button.type = 'button';
    button.addEventListener('click', () => { void copyText(text, button); });
    return button;
}
function jsonView(value, collapsed = true) {
    const wrapper = element('div', 'json');
    const output = formatJson(value);
    if (!collapsed) {
        wrapper.append(copyButton(output));
        wrapper.append(element('pre', 'value-text', output));
        return wrapper;
    }
    const details = element('details');
    const summary = element('summary', undefined, 'JSON を表示');
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
function renderStorage(entries) {
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
            valueCell.append(jsonView(entry.parsedValue));
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
    return ['local-storage', 'session-storage', 'cookies', 'indexeddb', 'change-timeline'].includes(id);
}
function renderShell() {
    clear(appRoot);
    const shell = element('main', 'app-shell');
    const sidebar = element('aside', 'sidebar');
    const brand = element('div', 'brand');
    brand.append(element('h1', undefined, 'Web State Inspector'), element('p', undefined, 'Read-only browser state inspection'));
    sidebar.append(brand);
    for (const group of ['Storage', 'Framework']) {
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
                if (state.selected === 'change-timeline' && item.id !== 'change-timeline')
                    stopTrackingPolling();
                state.selected = item.id;
                syncStoragePolling();
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
    if (state.selected === 'local-storage' || state.selected === 'session-storage') {
        setBody(renderStorage(state.loadedData));
        return;
    }
    if (state.selected === 'cookies') {
        setBody(renderCookies(state.loadedData));
        return;
    }
    if (state.selected === 'indexeddb') {
        setBody(renderIndexedDatabases(state.loadedData));
        return;
    }
    if (state.selected === 'cache-storage') {
        setBody(renderCacheNames(state.loadedData));
        return;
    }
    if (state.selected === 'change-timeline') {
        setBody(renderChangeTimeline(state.loadedData || emptyTimeline()));
        return;
    }
    if (state.selected === 'pinia' || state.selected === 'tanstack-query') {
        setBody(renderFrameworkState(state.loadedData));
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
    if (target === 'local-storage' || target === 'session-storage') {
        const kind = target === 'local-storage' ? 'localStorage' : 'sessionStorage';
        const result = await evaluator.getStorage(kind);
        if (!isCurrent())
            return;
        if (!result.ok || !result.data) {
            fail(result.error ?? `${labels[target]}を取得できません。`);
            return;
        }
        state.loadedData = result.data;
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
    if (target === 'indexeddb') {
        const result = await evaluator.getIndexedDatabases();
        if (!isCurrent())
            return;
        if (!result.ok || !result.data) {
            fail(result.error ?? 'IndexedDBを取得できません。');
            return;
        }
        state.loadedData = result.data;
        finish();
        return;
    }
    if (target === 'change-timeline') {
        const result = await changeTracker.getSnapshot();
        if (!isCurrent())
            return;
        if (!result.ok || !result.data) {
            fail(result.error ?? '変更記録を取得できません。');
            return;
        }
        state.loadedData = result.data;
        changeTrackingActive = result.data.active;
        if (result.data.active)
            startTrackingPolling();
        else
            stopTrackingPolling();
        syncStoragePolling();
        finish();
        return;
    }
    if (target === 'cache-storage') {
        const result = await evaluator.getCacheNames();
        if (!isCurrent())
            return;
        if (!result.ok || !result.data) {
            fail(result.error ?? 'Cache Storageを取得できません。');
            return;
        }
        state.loadedData = result.data;
        finish();
        return;
    }
    if (target === 'pinia' || target === 'tanstack-query') {
        const kind = target === 'pinia' ? 'pinia' : 'tanstackQuery';
        const result = await evaluator.getFrameworkState(kind);
        if (!isCurrent())
            return;
        if (!result.ok || !result.data) {
            fail(result.error ?? `${labels[target]}の状態を取得できません。`);
            return;
        }
        state.loadedData = result.data;
        finish();
    }
}
renderShell();
void refreshPanel();
