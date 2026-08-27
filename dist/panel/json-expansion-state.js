export class JsonExpansionState {
    expandedKeys = new Set();
    isExpanded(key) {
        return this.expandedKeys.has(key);
    }
    setExpanded(key, expanded) {
        if (expanded)
            this.expandedKeys.add(key);
        else
            this.expandedKeys.delete(key);
    }
}
