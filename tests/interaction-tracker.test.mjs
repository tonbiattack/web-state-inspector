import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');

class TestElement {
  constructor(tagName, options = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id ?? '';
    this.className = options.className ?? '';
    this.innerText = options.text ?? '';
    this.textContent = options.text ?? '';
    this.dataset = options.dataset ?? {};
    this.classList = (options.className ?? '').split(/\s+/).filter(Boolean);
    this.attributes = Object.entries(options.attributes ?? {}).map(([name, value]) => ({ name, value }));
    if (this.id) this.attributes.push({ name: 'id', value: this.id });
    if (options.name) this.attributes.push({ name: 'name', value: options.name });
    if (options.ariaLabel) this.attributes.push({ name: 'aria-label', value: options.ariaLabel });
    if (options.dataTestId) this.attributes.push({ name: 'data-testid', value: options.dataTestId });
  }

  getAttribute(name) {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }
}

class TestInputElement extends TestElement {
  constructor(tagName, options = {}) {
    super(tagName, options);
    this.type = options.type ?? 'text';
    this.value = options.value ?? '';
    this.disabled = Boolean(options.disabled);
  }
}

class TestTextAreaElement extends TestInputElement {}
class TestSelectElement extends TestInputElement {}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEnvironment() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  let timerId = 0;
  let clock = 0;
  const location = { href: 'https://example.test/customers' };
  const history = {
    pushState(_state, _unused, url) { if (url) location.href = new URL(url, location.href).href; },
    replaceState(_state, _unused, url) { if (url) location.href = new URL(url, location.href).href; },
  };
  const document = {
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type, listener) { documentListeners.delete(type); },
  };
  const window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type, listener) { windowListeners.delete(type); },
  };
  const context = vm.createContext({
    window,
    document,
    location,
    history,
    Element: TestElement,
    HTMLInputElement: TestInputElement,
    HTMLTextAreaElement: TestTextAreaElement,
    HTMLSelectElement: TestSelectElement,
    performance: { now: () => ++clock },
    setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    URL,
    Reflect,
  });
  const evaluator = {
    async evaluate(expression) {
      try { return { ok: true, data: new vm.Script(expression).runInContext(context) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    },
  };
  return {
    evaluator,
    documentListeners,
    windowListeners,
    history,
    location,
    dispatchDocument(type, target, extra = {}) { documentListeners.get(type)?.({ type, target, ...extra }); },
    dispatchWindow(type, event = {}) { windowListeners.get(type)?.({ type, ...event }); },
    flushTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    input: (options) => new TestInputElement('input', options),
    element: (tagName, options) => new TestElement(tagName, options),
  };
}

async function loadTracker() {
  return import(`${pathToFileURL(resolve(root, 'build/panel/interaction-tracker.js')).href}?test=${Date.now()}-${Math.random()}`);
}

test('InteractionTrackerはUser Actionの対象要約を記録し、password値を保存せずinputをdebounceする', async () => {
  const { InteractionTracker } = await loadTracker();
  const environment = createEnvironment();
  const tracker = new InteractionTracker(environment.evaluator);
  assert.equal((await tracker.start()).ok, true);

  const button = environment.element('button', { id: 'customer-detail', text: '詳細', dataTestId: 'submit-button', ariaLabel: '顧客詳細' });
  const password = environment.input({ id: 'customer-password', name: 'password', type: 'password', value: 'super-secret' });
  const customerId = environment.input({ id: 'customer-id', name: 'customerId', value: '1' });
  environment.dispatchDocument('click', button);
  environment.dispatchDocument('input', password);
  customerId.value = '12';
  environment.dispatchDocument('input', customerId);
  customerId.value = '123';
  environment.dispatchDocument('input', customerId);
  environment.flushTimers();
  environment.dispatchDocument('change', customerId);
  environment.dispatchDocument('submit', environment.element('form', { id: 'customer-form' }));
  environment.dispatchDocument('keydown', customerId, { key: 'Enter' });

  const snapshot = plain((await tracker.getSnapshot()).data);
  assert.equal(snapshot.actions.length, 6, '連続inputは最終値だけを1件として記録する');
  assert.deepEqual(snapshot.actions[0].target, {
    tagName: 'BUTTON', selector: 'button#customer-detail', id: 'customer-detail', text: '詳細', ariaLabel: '顧客詳細', dataTestId: 'submit-button',
  });
  const passwordAction = snapshot.actions.find((action) => action.target.type === 'password');
  assert.equal(passwordAction.target.value, '[not captured]');
  const inputAction = snapshot.actions.find((action) => action.actionType === 'input' && action.target.name === 'customerId');
  assert.equal(inputAction.target.value, '123');
  assert.equal(snapshot.actions.at(-1).key, 'Enter');
});

test('InteractionTrackerはpushState・replaceState・popstate・hashchangeをRoute Changeとして記録し、Stop時に復元する', async () => {
  const { InteractionTracker } = await loadTracker();
  const environment = createEnvironment();
  const originalPushState = environment.history.pushState;
  const originalReplaceState = environment.history.replaceState;
  const tracker = new InteractionTracker(environment.evaluator);
  await tracker.start();
  environment.history.pushState({ id: 123 }, '', '/customers/123');
  environment.history.replaceState({ id: 456 }, '', '/customers/456');
  const prior = environment.location.href;
  environment.location.href = 'https://example.test/customers/789';
  environment.dispatchWindow('popstate');
  environment.location.href = 'https://example.test/customers/789#contract';
  environment.dispatchWindow('hashchange', { oldURL: prior, newURL: environment.location.href });

  const snapshot = plain((await tracker.getSnapshot()).data);
  assert.deepEqual(snapshot.routes.map((event) => event.routeType), ['pushState', 'replaceState', 'popstate', 'hashchange']);
  assert.equal(snapshot.routes[0].from, 'https://example.test/customers');
  assert.equal(snapshot.routes[0].to, 'https://example.test/customers/123');
  assert.equal(snapshot.routes[3].to, 'https://example.test/customers/789#contract');

  assert.equal((await tracker.stop()).ok, true);
  assert.equal(environment.history.pushState, originalPushState);
  assert.equal(environment.history.replaceState, originalReplaceState);
  assert.equal(environment.documentListeners.size, 0);
  assert.equal(environment.windowListeners.size, 0);
});

test('InteractionTrackerはUser Actionを最大200件まで保持し、古いイベントから破棄する', async () => {
  const { InteractionTracker } = await loadTracker();
  const environment = createEnvironment();
  const tracker = new InteractionTracker(environment.evaluator);
  await tracker.start();
  const button = environment.element('button', { id: 'repeated-action', text: 'repeat' });
  for (let index = 0; index < 205; index += 1) environment.dispatchDocument('click', button);
  const snapshot = plain((await tracker.getSnapshot()).data);
  assert.equal(snapshot.actions.length, 200);
  assert.equal(snapshot.actions[0].id, 'action-6');
  assert.equal(snapshot.actions.at(-1).id, 'action-205');
});
