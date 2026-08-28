import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this.className = '';
    this.innerText = '';
    this.textContent = '';
    this.dataset = {};
    this.classList = [];
    this.attributes = [];
  }
  getAttribute() { return null; }
}
class Input extends Element {
  constructor() {
    super('input');
    this.type = 'text';
    this.value = 'queued value';
  }
}

const documentListeners = new Map();
const windowListeners = new Map();
const timers = new Map();
let timerId = 0;
const location = { href: 'https://example.test/' };
const history = {
  pushState() {},
  replaceState() {},
};
const document = {
  addEventListener(type, listener) { documentListeners.set(type, listener); },
  removeEventListener(type) { documentListeners.delete(type); },
};
const window = {
  addEventListener(type, listener) { windowListeners.set(type, listener); },
  removeEventListener(type) { windowListeners.delete(type); },
};
const context = vm.createContext({
  window,
  document,
  location,
  history,
  Element,
  HTMLInputElement: Input,
  HTMLTextAreaElement: Input,
  HTMLSelectElement: Input,
  performance: { now: () => 1 },
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

const root = resolve(import.meta.dirname, '..');
const { InteractionTracker } = await import(`${pathToFileURL(resolve(root, 'build/panel/interaction-tracker.js')).href}?repro=${Date.now()}`);
const tracker = new InteractionTracker(evaluator);
assert.equal((await tracker.start()).ok, true);
documentListeners.get('input')?.({ type: 'input', target: new Input() });
assert.equal((await tracker.clear()).ok, true);
assert.equal((await tracker.getSnapshot()).data.actions.length, 0, 'Clear直後は空');
for (const [id, callback] of [...timers]) {
  timers.delete(id);
  callback();
}
const afterFlush = (await tracker.getSnapshot()).data.actions;
console.log(JSON.stringify({ actionsAfterClearAndTimerFlush: afterFlush }, null, 2));
assert.equal(afterFlush.length, 0, 'Clearより前に発生したinputの遅延記録が、Clear後に追加されてはならない');
