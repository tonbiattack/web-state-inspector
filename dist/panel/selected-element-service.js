const MAX_TEXT_LENGTH = 2_000;
const MAX_ATTRIBUTE_VALUE_LENGTH = 500;
const MAX_ATTRIBUTES = 40;
export class SelectedElementService {
    evaluator;
    constructor(evaluator) {
        this.evaluator = evaluator;
    }
    captureSelected() {
        return this.evaluator.evaluate(`(() => {
      const element = typeof $0 === 'undefined' ? null : $0;
      if (!(element instanceof Element)) return null;
      const short = (value, max) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, max);
      const selector = () => {
        if (element.dataset?.testid) return '[data-testid="' + element.dataset.testid + '"]';
        if (element.id) return element.tagName.toLowerCase() + '#' + element.id;
        if (element.getAttribute('name')) return element.tagName.toLowerCase() + '[name="' + element.getAttribute('name') + '"]';
        const classes = Array.from(element.classList || []).slice(0, 3);
        return element.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
      };
      const attributes = {};
      const aria = {};
      Array.from(element.attributes).slice(0, ${MAX_ATTRIBUTES}).forEach((attribute) => {
        const value = short(attribute.value, ${MAX_ATTRIBUTE_VALUE_LENGTH});
        attributes[attribute.name] = value;
        if (attribute.name.startsWith('aria-')) aria[attribute.name] = value;
      });
      const data = {};
      Object.entries(element.dataset).forEach(([key, value]) => { data[key] = short(value, ${MAX_ATTRIBUTE_VALUE_LENGTH}); });
      const control = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element : null;
      const type = control && 'type' in control ? String(control.type || '').toLowerCase() : undefined;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const snapshot = {
        id: 'selected-element-' + crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        summary: {
          tagName: element.tagName,
          selector: selector(),
          id: element.id || undefined,
          className: short(element.className, 120) || undefined,
          name: element.getAttribute('name') || undefined,
          type,
          text: short(element.innerText || element.textContent, 160) || undefined,
          ariaLabel: element.getAttribute('aria-label') || undefined,
          dataTestId: element.getAttribute('data-testid') || undefined,
          value: control ? (type === 'password' ? '[not captured]' : short(control.value, 200)) : undefined,
        },
        textContent: short(element.textContent, ${MAX_TEXT_LENGTH}),
        attributes,
        dataset: data,
        disabled: Boolean(control?.disabled || element.getAttribute('aria-disabled') === 'true'),
        hidden: Boolean(element.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'),
        aria,
        boundingClientRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
        computedStyle: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          position: style.position,
          zIndex: style.zIndex,
          width: style.width,
          height: style.height,
          pointerEvents: style.pointerEvents,
          overflow: style.overflow,
        },
      };
      return snapshot;
    })()`);
    }
}
