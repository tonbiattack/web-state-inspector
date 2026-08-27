const TRACKER_SYMBOL = 'web-state-inspector.storage-change-tracker.v1';
const DEFAULT_CAPACITY = 300;
export class ChangeTracker {
    evaluator;
    constructor(evaluator) {
        this.evaluator = evaluator;
    }
    async start(capacity = DEFAULT_CAPACITY) {
        const safeCapacity = Math.min(Math.max(capacity, 20), 1000);
        return this.evaluator.evaluate(`(() => {
      const symbol = Symbol.for(${JSON.stringify(TRACKER_SYMBOL)});
      const previous = window[symbol];
      if (previous && previous.active) {
        return { active: true, capacity: previous.capacity, eventCount: previous.events.length };
      }

      const state = previous || Object.create(null);
      state.events = [];
      state.nextId = 1;
      state.capacity = ${safeCapacity};
      state.active = true;
      state.originals = Object.create(null);
      state.wrappers = Object.create(null);
      const classify = (storage) => storage === window.localStorage ? 'localStorage' : 'sessionStorage';
      const safeStack = () => {
        const lines = String(new Error().stack || '').split('\\n');
        const internalFrames = ['at safeStack', 'at record', 'Storage.wrapper', 'web-state-inspector.storage-change-tracker'];
        return lines.filter((line) => {
          const trimmed = line.trim();
          return trimmed !== 'Error' && !internalFrames.some((frame) => line.includes(frame));
        }).slice(0, 4);
      };
      const record = (event) => {
        if (!state.active) return;
        const entry = {
          id: state.nextId++,
          timestamp: new Date().toISOString(),
          performanceMs: Number(performance.now().toFixed(3)),
          stack: safeStack(),
          ...event,
        };
        state.events.push(entry);
        if (state.events.length > state.capacity) state.events.splice(0, state.events.length - state.capacity);
      };
      const wrap = (method) => {
        const original = Storage.prototype[method];
        state.originals[method] = original;
        const wrapper = function (...args) {
          const storageArea = classify(this);
          const key = method === 'clear' ? null : String(args[0]);
          const oldValue = key === null ? null : this.getItem(key);
          const clearedEntries = method === 'clear'
            ? Array.from({ length: this.length }, (_, index) => {
                const clearedKey = this.key(index);
                return clearedKey === null ? null : { key: clearedKey, value: this.getItem(clearedKey) ?? '' };
              }).filter(Boolean).slice(0, 100)
            : undefined;
          try {
            const returned = Reflect.apply(original, this, args);
            const newValue = key === null ? null : this.getItem(key);
            const outcome = method === 'clear'
              ? (clearedEntries && clearedEntries.length > 0 ? 'changed' : 'unchanged')
              : oldValue === newValue ? 'unchanged' : 'changed';
            record({ storageArea, operation: method, key, oldValue, newValue, clearedEntries, outcome });
            return returned;
          } catch (error) {
            record({
              storageArea,
              operation: method,
              key,
              oldValue,
              newValue: oldValue,
              clearedEntries,
              outcome: 'error',
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };
        state.wrappers[method] = wrapper;
        Storage.prototype[method] = wrapper;
      };
      wrap('setItem');
      wrap('removeItem');
      wrap('clear');
      state.storageListener = (event) => {
        if (!event.storageArea) return;
        record({
          storageArea: classify(event.storageArea),
          operation: 'external-storage-event',
          key: event.key,
          oldValue: event.oldValue,
          newValue: event.newValue,
          externalUrl: event.url,
          stack: ['StorageEvent from another same-origin document'],
          outcome: event.oldValue === event.newValue ? 'unchanged' : 'changed',
        });
      };
      window.addEventListener('storage', state.storageListener);
      window[symbol] = state;
      return { active: true, capacity: state.capacity, eventCount: 0 };
    })()`);
    }
    getSnapshot() {
        return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(TRACKER_SYMBOL)})];
      if (!state) return { active: false, capacity: ${DEFAULT_CAPACITY}, eventCount: 0, events: [] };
      const events = state.events.map((event) => ({ ...event, stack: [...event.stack], clearedEntries: event.clearedEntries ? event.clearedEntries.map((entry) => ({ ...entry })) : undefined }));
      return { active: Boolean(state.active), capacity: state.capacity, eventCount: events.length, events };
    })()`);
    }
    stop() {
        return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(TRACKER_SYMBOL)})];
      if (!state) return { active: false, capacity: ${DEFAULT_CAPACITY}, eventCount: 0 };
      if (state.active) {
        for (const method of ['setItem', 'removeItem', 'clear']) {
          if (state.originals && state.wrappers && Storage.prototype[method] === state.wrappers[method]) {
            Storage.prototype[method] = state.originals[method];
          }
        }
        if (state.storageListener) window.removeEventListener('storage', state.storageListener);
        state.active = false;
      }
      return { active: false, capacity: state.capacity, eventCount: state.events.length };
    })()`);
    }
    clear() {
        return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(TRACKER_SYMBOL)})];
      if (!state) return { active: false, capacity: ${DEFAULT_CAPACITY}, eventCount: 0 };
      state.events = [];
      state.nextId = 1;
      return { active: Boolean(state.active), capacity: state.capacity, eventCount: 0 };
    })()`);
    }
}
