import type { DebugError } from '../shared/types.js';

export const MAX_DEBUG_ERRORS = 200;
const DEDUP_WINDOW_MS = 100;
const ERROR_COLLECTOR_SYMBOL = 'web-state-inspector.error-collector.v1';

export class ErrorCollector {
  constructor(private readonly evaluator: { evaluate<T>(expression: string): Promise<{ ok: boolean; data?: T; error?: string }> }) {}

  start(): Promise<{ ok: boolean; data?: { active: boolean; errorCount: number }; error?: string }> {
    return this.evaluator.evaluate(`(() => {
      const symbol = Symbol.for(${JSON.stringify(ERROR_COLLECTOR_SYMBOL)});
      const prior = window[symbol];
      if (prior?.active) return { active: true, errorCount: prior.errors.length };
      const state = prior || Object.create(null);
      state.active = true;
      state.errors = [];
      state.nextId = 1;
      state.capacity = ${MAX_DEBUG_ERRORS};
      const safeString = (value) => {
        try {
          if (value instanceof Error) return value.message;
          if (typeof value === 'string') return value;
          const seen = new WeakSet();
          const json = JSON.stringify(value, (_key, item) => {
            if (typeof item === 'bigint') return String(item) + 'n';
            if (typeof item === 'function') return '[function]';
            if (typeof item === 'symbol') return '[symbol]';
            if (typeof Node !== 'undefined' && item instanceof Node) return '[DOM ' + item.nodeName + (item.id ? '#' + item.id : '') + ']';
            if (item && typeof item === 'object') {
              if (seen.has(item)) return '[Circular]';
              seen.add(item);
            }
            return item;
          });
          return json ?? String(value);
        } catch { return String(value); }
      };
      const asStack = (value) => value instanceof Error && value.stack ? String(value.stack).split('\\n').slice(0, 8) : [];
      const record = (kind, details) => {
        if (!state.active) return;
        const timestamp = new Date().toISOString();
        const signature = [kind, details.message, details.sourceUrl ?? '', details.line ?? '', details.column ?? ''].join('|');
        const existing = state.errors.at(-1);
        if (existing && existing.signature === signature && Date.now() - existing.createdAt < ${DEDUP_WINDOW_MS}) {
          existing.duplicateCount += 1;
          return;
        }
        state.errors.push({
          id: 'error-' + state.nextId++,
          timestamp,
          performanceMs: Number(performance.now().toFixed(3)),
          kind,
          message: String(details.message).slice(0, 20_000),
          stack: Array.isArray(details.stack) ? details.stack.slice(0, 8) : [],
          sourceUrl: details.sourceUrl,
          line: details.line,
          column: details.column,
          duplicateCount: 1,
          signature,
          createdAt: Date.now(),
          crossOriginRestricted: details.crossOriginRestricted || undefined,
        });
        if (state.errors.length > state.capacity) state.errors.splice(0, state.errors.length - state.capacity);
      };
      state.errorListener = (event) => {
        if (event instanceof ErrorEvent) {
          // "Script error." with no source/line/column is the browser's sanitised
          // cross-origin error — tag it so consumers know details are unavailable.
          const isCrossOrigin = event.message === 'Script error.' && !event.filename && (!event.lineno || event.lineno === 0);
          const message = isCrossOrigin ? 'Cross-origin error: Details unavailable' : (event.message || safeString(event.error));
          const details = { message, stack: asStack(event.error), sourceUrl: event.filename, line: event.lineno, column: event.colno, crossOriginRestricted: isCrossOrigin || undefined };
          record('javascript-error', details);
        }
      };
      state.rejectionListener = (event) => {
        const reason = event.reason;
        record('promise-rejection', { message: safeString(reason), stack: asStack(reason) });
      };
      state.originalConsoleError = console.error;
      state.originalConsoleWarn = console.warn;
      state.consoleWrapper = function (...args) {
        const candidate = args.find((argument) => argument instanceof Error);
        record('console-error', { message: args.map(safeString).join(' ').slice(0, 20_000), stack: asStack(candidate) });
        return Reflect.apply(state.originalConsoleError, console, args);
      };
      state.consoleWarnWrapper = function (...args) {
        const candidate = args.find((argument) => argument instanceof Error);
        record('console-warn', { message: args.map(safeString).join(' ').slice(0, 20_000), stack: asStack(candidate) });
        return Reflect.apply(state.originalConsoleWarn, console, args);
      };
      window.addEventListener('error', state.errorListener, true);
      window.addEventListener('unhandledrejection', state.rejectionListener);
      console.error = state.consoleWrapper;
      console.warn = state.consoleWarnWrapper;
      window[symbol] = state;
      return { active: true, errorCount: 0 };
    })()`);
  }

  getErrors(): Promise<{ ok: boolean; data?: DebugError[]; error?: string }> {
    return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(ERROR_COLLECTOR_SYMBOL)})];
      if (!state) return [];
      return state.errors.map(({ signature, createdAt, ...error }) => ({ ...error, stack: [...error.stack] }));
    })()`);
  }

  clear(): Promise<{ ok: boolean; data?: { active: boolean; errorCount: number }; error?: string }> {
    return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(ERROR_COLLECTOR_SYMBOL)})];
      if (!state) return { active: false, errorCount: 0 };
      state.errors = [];
      state.nextId = 1;
      return { active: Boolean(state.active), errorCount: 0 };
    })()`);
  }

  stop(): Promise<{ ok: boolean; data?: { active: boolean; errorCount: number }; error?: string }> {
    return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(ERROR_COLLECTOR_SYMBOL)})];
      if (!state) return { active: false, errorCount: 0 };
      if (state.active) {
        window.removeEventListener('error', state.errorListener, true);
        window.removeEventListener('unhandledrejection', state.rejectionListener);
        if (console.error === state.consoleWrapper) console.error = state.originalConsoleError;
        if (console.warn === state.consoleWarnWrapper) console.warn = state.originalConsoleWarn;
        state.active = false;
      }
      return { active: false, errorCount: state.errors.length };
    })()`);
  }
}
