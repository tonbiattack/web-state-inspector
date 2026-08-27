const ASYNC_SYMBOL = 'web-state-inspector.async-results.v1';
const POLL_INTERVAL_MS = 150;
const POLL_ATTEMPTS = 40;
function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
export class PageEvaluator {
    async evaluate(expression) {
        return new Promise((resolve) => {
            chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
                if (exceptionInfo?.isException) {
                    resolve({ ok: false, error: exceptionInfo.value ?? 'ページ上の評価に失敗しました。' });
                    return;
                }
                resolve({ ok: true, data: result });
            });
        });
    }
    /**
     * inspectedWindow.eval はPromise完了を待たないため、対象ページ上で処理を開始し、
     * JSON化した結果だけを短時間ポーリングして回収する。これは読み取り専用である。
     */
    async evaluateAsync(operation) {
        const taskId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const started = await this.evaluate(`(() => {
      const symbol = Symbol.for(${JSON.stringify(ASYNC_SYMBOL)});
      const registry = window[symbol] ||= Object.create(null);
      const toJson = (value) => {
        const json = JSON.stringify(value, (_key, item) => {
          if (typeof item === 'bigint') return String(item) + 'n';
          if (typeof item === 'undefined') return '[undefined]';
          if (typeof item === 'function') return '[function]';
          if (typeof item === 'symbol') return '[symbol]';
          return item;
        });
        return json === undefined ? null : JSON.parse(json);
      };
      registry[${JSON.stringify(taskId)}] = { status: 'pending' };
      (async () => {
        try {
          const data = await (${operation});
          registry[${JSON.stringify(taskId)}] = { status: 'success', data: toJson(data) };
        } catch (error) {
          registry[${JSON.stringify(taskId)}] = { status: 'error', error: error instanceof Error ? error.message : String(error) };
        }
      })();
      return true;
    })()`);
        if (!started.ok)
            return { ok: false, error: started.error };
        const pollExpression = `(() => {
      const registry = window[Symbol.for(${JSON.stringify(ASYNC_SYMBOL)})];
      return registry && registry[${JSON.stringify(taskId)}] ? registry[${JSON.stringify(taskId)}] : null;
    })()`;
        const cleanupExpression = `(() => {
      const registry = window[Symbol.for(${JSON.stringify(ASYNC_SYMBOL)})];
      if (registry) delete registry[${JSON.stringify(taskId)}];
      return true;
    })()`;
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
            await wait(POLL_INTERVAL_MS);
            const polled = await this.evaluate(pollExpression);
            if (!polled.ok)
                return { ok: false, error: polled.error };
            if (!polled.data || polled.data.status === 'pending')
                continue;
            await this.evaluate(cleanupExpression);
            if (polled.data.status === 'error')
                return { ok: false, error: polled.data.error ?? '非同期処理に失敗しました。' };
            return { ok: true, data: polled.data.data };
        }
        await this.evaluate(cleanupExpression);
        return { ok: false, error: '取得がタイムアウトしました（6秒）。' };
    }
    getPageInfo() {
        return this.evaluate(`(() => ({ url: location.href, origin: location.origin }))()`);
    }
    getPageDetails() {
        return this.evaluate(`(() => ({
      page: { url: location.href, origin: location.origin, title: document.title },
      environment: {
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        readyState: document.readyState,
      },
    }))()`);
    }
    getStorage(kind) {
        return this.evaluate(`(() => {
      const storage = window.${kind};
      const entries = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key === null) continue;
        const value = storage.getItem(key) ?? '';
        let parsedValue;
        let isJson = false;
        try { parsedValue = JSON.parse(value); isJson = true; } catch { /* 文字列はそのまま返す。 */ }
        entries.push({ key, value, parsedValue, isJson });
      }
      return entries.sort((a, b) => a.key.localeCompare(b.key));
    })()`);
    }
    getIndexedDatabases() {
        return this.evaluateAsync(`(async () => {
      if (typeof indexedDB.databases !== 'function') return [];
      const toText = (value) => value === null ? null : Array.isArray(value) ? [...value] : String(value);
      const requestToPromise = (request) => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
      });
      const getSummary = async (info) => {
        if (!info.name) return null;
        try {
          const database = await requestToPromise(indexedDB.open(info.name));
          const stores = [];
          for (const storeName of database.objectStoreNames) {
            const transaction = database.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            let recordCount;
            try { recordCount = await requestToPromise(store.count()); } catch { recordCount = undefined; }
            stores.push({ name: storeName, keyPath: toText(store.keyPath), autoIncrement: store.autoIncrement, recordCount });
          }
          const version = database.version;
          database.close();
          return { name: info.name, version, stores };
        } catch (error) {
          return { name: info.name, version: info.version, stores: [], error: error instanceof Error ? error.message : String(error) };
        }
      };
      const infos = await indexedDB.databases();
      const summaries = await Promise.all(infos.map(getSummary));
      return summaries.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    })()`);
    }
    getIndexedDbRecords(databaseName, storeName, limit = 100) {
        const args = JSON.stringify({ databaseName, storeName, limit: Math.min(Math.max(limit, 1), 100) });
        return this.evaluateAsync(`(async () => {
      const args = ${args};
      const normalize = (value, seen = new WeakSet()) => {
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
        if (typeof value === 'undefined') return '[undefined]';
        if (typeof value === 'bigint') return String(value) + 'n';
        if (value instanceof Date) return value.toISOString();
        if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: value.byteLength };
        if (ArrayBuffer.isView(value)) return { type: value.constructor.name, byteLength: value.byteLength };
        if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
        if (typeof value === 'object') {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
          const output = {};
          for (const key of Object.keys(value)) {
            try { output[key] = normalize(value[key], seen); } catch { output[key] = '[Unreadable]'; }
          }
          return output;
        }
        return String(value);
      };
      const openRequest = indexedDB.open(args.databaseName);
      const database = await new Promise((resolve, reject) => {
        openRequest.onsuccess = () => resolve(openRequest.result);
        openRequest.onerror = () => reject(openRequest.error || new Error('Database open failed'));
      });
      try {
        const transaction = database.transaction(args.storeName, 'readonly');
        const store = transaction.objectStore(args.storeName);
        const records = [];
        await new Promise((resolve, reject) => {
          const cursorRequest = store.openCursor();
          cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Cursor read failed'));
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor || records.length >= args.limit) return resolve();
            records.push({ key: normalize(cursor.key), value: normalize(cursor.value) });
            cursor.continue();
          };
        });
        return records;
      } finally {
        database.close();
      }
    })()`);
    }
    getCacheNames() {
        return this.evaluateAsync(`(async () => (await caches.keys()).sort())()`);
    }
    getCacheEntries(cacheName, limit = 100) {
        const args = JSON.stringify({ cacheName, limit: Math.min(Math.max(limit, 1), 100) });
        return this.evaluateAsync(`(async () => {
      const args = ${args};
      const cache = await caches.open(args.cacheName);
      const requests = await cache.keys();
      const selected = requests.slice(0, args.limit);
      const entries = await Promise.all(selected.map(async (request) => {
        const response = await cache.match(request, { ignoreVary: true });
        return {
          url: request.url,
          method: request.method,
          status: response ? response.status : 0,
          statusText: response ? response.statusText : 'Unavailable',
          responseType: response ? response.type : 'error',
        };
      }));
      return { name: args.cacheName, entries, totalEntries: requests.length, truncated: requests.length > selected.length };
    })()`);
    }
    getFrameworkState(kind) {
        const accessor = kind === 'pinia' ? 'getPinia' : 'getTanStackQuery';
        const label = kind === 'pinia' ? 'Pinia' : 'TanStack Query';
        return this.evaluateAsync(`(async () => {
      const bridge = window.__WEB_STATE_INSPECTOR__;
      if (!bridge || typeof bridge.${accessor} !== 'function') {
        return { detected: false, message: '${label} state is not accessible on this page.' };
      }
      try {
        const data = await bridge.${accessor}();
        return { detected: true, message: 'State supplied by this page through the explicit diagnostic bridge.', data };
      } catch (error) {
        return { detected: false, message: error instanceof Error ? error.message : '${label} bridge failed.' };
      }
    })()`);
    }
}
