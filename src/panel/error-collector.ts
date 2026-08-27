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
          return JSON.stringify(value) ?? String(value);
        } catch { return String(value); }
      };
      const asStack = (value) => value instanceof Error && value.stack ? String(value.stack).split('\\n').slice(0, 8) : [];
      const record = (kind, details) => {
        if (!state.active) return;
        const timestamp = new Date().toISOString();
        const signature = [details.message, details.sourceUrl ?? '', details.line ?? '', details.column ?? ''].join('|');
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
        });
        if (state.errors.length > state.capacity) state.errors.splice(0, state.errors.length - state.capacity);
      };
      state.errorListener = (event) => {
        if (event instanceof ErrorEvent) {
          record('javascript-error', { message: event.message || safeString(event.error), stack: asStack(event.error), sourceUrl: event.filename, line: event.lineno, column: event.colno });
        }
      };
      state.rejectionListener = (event) => {
        const reason = event.reason;
        record('promise-rejection', { message: safeString(reason), stack: asStack(reason) });
      };
      state.originalConsoleError = console.error;
      state.consoleWrapper = function (...args) {
        const candidate = args.find((argument) => argument instanceof Error);
        record('console-error', { message: args.map(safeString).join(' ').slice(0, 20_000), stack: asStack(candidate) });
        return Reflect.apply(state.originalConsoleError, console, args);
      };
      window.addEventListener('error', state.errorListener, true);
      window.addEventListener('unhandledrejection', state.rejectionListener);
      console.error = state.consoleWrapper;
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
        state.active = false;
      }
      return { active: false, errorCount: state.errors.length };
    })()`);
  }
}
