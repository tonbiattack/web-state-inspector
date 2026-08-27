export const MAX_USER_ACTIONS = 200;
export const MAX_ROUTE_CHANGES = 100;
export const INPUT_DEBOUNCE_MS = 350;
const INTERACTION_TRACKER_SYMBOL = 'web-state-inspector.interaction-tracker.v1';
export class InteractionTracker {
    evaluator;
    constructor(evaluator) {
        this.evaluator = evaluator;
    }
    start() {
        return this.evaluator.evaluate(`(() => {
      const symbol = Symbol.for(${JSON.stringify(INTERACTION_TRACKER_SYMBOL)});
      const existing = window[symbol];
      if (existing?.active) return existing.snapshot();
      const state = existing || Object.create(null);
      state.active = true;
      state.actions = [];
      state.routes = [];
      state.nextActionId = 1;
      state.nextRouteId = 1;
      state.inputTimers = new WeakMap();
      state.lastUrl = location.href;
      const shortText = (value, length = 160) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, length);
      const selector = (target) => {
        if (!target || !(target instanceof Element)) return 'unknown';
        if (target.dataset?.testid) return '[data-testid="' + target.dataset.testid + '"]';
        if (target.id) return target.tagName.toLowerCase() + '#' + target.id;
        if (target.getAttribute('name')) return target.tagName.toLowerCase() + '[name="' + target.getAttribute('name') + '"]';
        const classes = Array.from(target.classList || []).slice(0, 3);
        return target.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
      };
      const summarize = (target, includeValue) => {
        const element = target instanceof Element ? target : null;
        if (!element) return { tagName: 'UNKNOWN', selector: 'unknown' };
        const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element : null;
        const type = input && 'type' in input ? String(input.type || '').toLowerCase() : undefined;
        const output = {
          tagName: element.tagName,
          selector: selector(element),
          id: element.id || undefined,
          className: shortText(element.className, 120) || undefined,
          name: element.getAttribute('name') || undefined,
          type,
          text: shortText(element.innerText || element.textContent) || undefined,
          ariaLabel: element.getAttribute('aria-label') || undefined,
          dataTestId: element.getAttribute('data-testid') || undefined,
        };
        if (includeValue && input) output.value = type === 'password' ? '[not captured]' : shortText(input.value, 200);
        return output;
      };
      const append = (list, item, capacity) => {
        list.push(item);
        if (list.length > capacity) list.splice(0, list.length - capacity);
      };
      const recordAction = (actionType, target, key) => {
        if (!state.active) return;
        const timestamp = new Date().toISOString();
        const event = {
          id: 'action-' + state.nextActionId++,
          timestamp,
          performanceMs: Number(performance.now().toFixed(3)),
          kind: 'user-action',
          actionType,
          target: summarize(target, actionType === 'input' || actionType === 'change'),
          key: key || undefined,
        };
        event.summary = actionType.toUpperCase() + ' ' + event.target.selector + (event.key ? ' (' + event.key + ')' : '');
        append(state.actions, event, ${MAX_USER_ACTIONS});
      };
      const recordRoute = (routeType, from, to) => {
        if (!state.active) return;
        const timestamp = new Date().toISOString();
        const event = {
          id: 'route-' + state.nextRouteId++,
          timestamp,
          performanceMs: Number(performance.now().toFixed(3)),
          kind: 'route-change',
          routeType,
          from,
          to,
          summary: routeType + ': ' + from + ' → ' + to,
        };
        append(state.routes, event, ${MAX_ROUTE_CHANGES});
        state.lastUrl = to;
      };
      state.actionListener = (event) => {
        const actionType = event.type === 'focusin' ? 'focus' : event.type === 'focusout' ? 'blur' : event.type;
        if (event.type === 'input') {
          const prior = state.inputTimers.get(event.target);
          if (prior) clearTimeout(prior);
          const timer = setTimeout(() => { state.inputTimers.delete(event.target); recordAction('input', event.target); }, ${INPUT_DEBOUNCE_MS});
          state.inputTimers.set(event.target, timer);
          return;
        }
        if (event.type === 'change') {
          const prior = state.inputTimers.get(event.target);
          if (prior) { clearTimeout(prior); state.inputTimers.delete(event.target); }
        }
        recordAction(actionType, event.target, event.type === 'keydown' ? event.key : undefined);
      };
      for (const type of ['click', 'input', 'change', 'submit', 'focusin', 'focusout', 'keydown']) document.addEventListener(type, state.actionListener, true);
      state.originalPushState = history.pushState;
      state.originalReplaceState = history.replaceState;
      state.pushStateWrapper = function (...args) {
        const from = location.href;
        const result = Reflect.apply(state.originalPushState, history, args);
        recordRoute('pushState', from, location.href);
        return result;
      };
      state.replaceStateWrapper = function (...args) {
        const from = location.href;
        const result = Reflect.apply(state.originalReplaceState, history, args);
        recordRoute('replaceState', from, location.href);
        return result;
      };
      history.pushState = state.pushStateWrapper;
      history.replaceState = state.replaceStateWrapper;
      state.popstateListener = () => recordRoute('popstate', state.lastUrl, location.href);
      state.hashchangeListener = (event) => recordRoute('hashchange', event.oldURL || state.lastUrl, event.newURL || location.href);
      window.addEventListener('popstate', state.popstateListener);
      window.addEventListener('hashchange', state.hashchangeListener);
      state.snapshot = () => ({
        active: Boolean(state.active),
        actionCount: state.actions.length,
        routeCount: state.routes.length,
        actions: state.actions.map((event) => ({ ...event, target: { ...event.target } })),
        routes: state.routes.map((event) => ({ ...event })),
      });
      window[symbol] = state;
      return state.snapshot();
    })()`);
    }
    getSnapshot() {
        return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(INTERACTION_TRACKER_SYMBOL)})];
      return state?.snapshot ? state.snapshot() : { active: false, actionCount: 0, routeCount: 0, actions: [], routes: [] };
    })()`);
    }
    clear() {
        return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(INTERACTION_TRACKER_SYMBOL)})];
      if (!state) return { active: false, actionCount: 0, routeCount: 0, actions: [], routes: [] };
      state.actions = [];
      state.routes = [];
      state.nextActionId = 1;
      state.nextRouteId = 1;
      return state.snapshot();
    })()`);
    }
    stop() {
        return this.evaluator.evaluate(`(() => {
      const state = window[Symbol.for(${JSON.stringify(INTERACTION_TRACKER_SYMBOL)})];
      if (!state) return { active: false, actionCount: 0, routeCount: 0, actions: [], routes: [] };
      if (state.active) {
        for (const type of ['click', 'input', 'change', 'submit', 'focusin', 'focusout', 'keydown']) document.removeEventListener(type, state.actionListener, true);
        window.removeEventListener('popstate', state.popstateListener);
        window.removeEventListener('hashchange', state.hashchangeListener);
        if (history.pushState === state.pushStateWrapper) history.pushState = state.originalPushState;
        if (history.replaceState === state.replaceStateWrapper) history.replaceState = state.originalReplaceState;
        state.active = false;
      }
      return state.snapshot();
    })()`);
    }
}
