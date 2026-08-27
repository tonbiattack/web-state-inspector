import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

class TestErrorEvent {
  constructor(type, options) { Object.assign(this, { type }, options); }
}

async function loadCollector() {
  return import(`${pathToFileURL(resolve(root, 'build/panel/error-collector.js')).href}?test=${Date.now()}-${Math.random()}`);
}

function createEnvironment() {
  const listeners = new Map();
  const originalCalls = [];
  const console = { error: (...args) => { originalCalls.push(args); } };
  const window = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { listeners.delete(type); },
  };
  let clock = 0;
  const context = vm.createContext({ window, console, Error, ErrorEvent: TestErrorEvent, performance: { now: () => ++clock } });
  const evaluator = {
    async evaluate(expression) {
      try { return { ok: true, data: new vm.Script(expression).runInContext(context) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    },
  };
  return { listeners, console, originalCalls, evaluator };
}

test('ErrorCollectorはconsole.error、window error、unhandledrejectionを収集し、重複を集約してStop時に復元する', async () => {
  const { ErrorCollector } = await loadCollector();
  const environment = createEnvironment();
  const originalConsoleError = environment.console.error;
  const collector = new ErrorCollector(environment.evaluator);

  const started = await collector.start();
  assert.equal(started.ok, true);
  environment.console.error('Duplicate error');
  environment.console.error('Duplicate error');
  environment.listeners.get('error')(new TestErrorEvent('error', { message: 'ReferenceError: missing', error: new Error('ReferenceError: missing'), filename: 'https://example.test/app.js', lineno: 10, colno: 4 }));
  environment.listeners.get('unhandledrejection')({ reason: new TypeError('Promise failed') });

  const errors = await collector.getErrors();
  assert.equal(errors.ok, true);
  assert.equal(errors.data.length, 3);
  assert.equal(errors.data[0].kind, 'console-error');
  assert.equal(errors.data[0].duplicateCount, 2);
  assert.equal(errors.data[1].sourceUrl, 'https://example.test/app.js');
  assert.equal(errors.data[1].line, 10);
  assert.equal(errors.data[2].kind, 'promise-rejection');
  assert.ok(environment.originalCalls.length >= 2, 'console.error本来の動作を維持する');

  const stopped = await collector.stop();
  assert.equal(stopped.ok, true);
  assert.equal(environment.console.error, originalConsoleError, 'Stopでconsole.errorを元へ戻す');
  assert.equal(environment.listeners.size, 0);
});
