export class JsonExpansionState {
  private readonly expandedKeys = new Set<string>();

  isExpanded(key: string): boolean {
    return this.expandedKeys.has(key);
  }

  setExpanded(key: string, expanded: boolean): void {
    if (expanded) this.expandedKeys.add(key);
    else this.expandedKeys.delete(key);
  }
}
