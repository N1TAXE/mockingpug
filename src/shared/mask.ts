const MIN_MASK_LENGTH = 3;

/**
 * Marks an element's subtree as exempt from `applyMask`. Used on the
 * devtools UI's own root elements (the floating toggle, the settings/list
 * panel, each data window), so toggling "highlight mock data" masks the
 * *app's* rendered content, not the raw record values `<MockDevtools>`
 * itself displays (e.g. the JSON viewer in a data window).
 */
export const MASK_IGNORE_ATTR = 'data-mockingpug-ui';

/** Recursively flattens every string/number leaf value out of a generated record into `out`, skipping short/internal ones. */
export function collectValues(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    if (text.length >= MIN_MASK_LENGTH) out.add(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectValues(item, out);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '_seed' || key === '_index') continue;
      collectValues(item, out);
    }
  }
}

/**
 * DOM-level "highlight mock data" pass: walks every text node under
 * `document.body` and replaces any whose text exactly matches (or contains,
 * as a substring) a known generated value with a `***` string of the *same
 * length as the whole node's text*, so hardcoded strings in the markup are
 * visually untouched, and the mask's length still hints at what was there.
 * `originalText` remembers the pre-mask content per node so unmasking is
 * exact; `maskedNodes` is a plain (non-weak) `Set` scoped to a single mask
 * session so it can be iterated to restore; a `WeakMap` alone can't be
 * enumerated, so it's only used for the "already masked?" lookup.
 */
export function applyMask(values: Set<string>, originalText: WeakMap<Text, string>, maskedNodes: Set<Text>): void {
  if (values.size === 0) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const ancestor = (node as Text).parentElement?.closest(`[${MASK_IGNORE_ATTR}]`);
      return ancestor ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (!originalText.has(node)) {
      const text = node.textContent ?? '';
      const matches = values.has(text) || [...values].some((v) => text.includes(v));
      if (matches && text.length >= MIN_MASK_LENGTH) {
        originalText.set(node, text);
        maskedNodes.add(node);
        node.textContent = '*'.repeat(text.length);
      }
    }
    node = walker.nextNode() as Text | null;
  }
}

export function restoreMask(originalText: WeakMap<Text, string>, maskedNodes: Set<Text>): void {
  for (const node of maskedNodes) {
    const original = originalText.get(node);
    if (original !== undefined) node.textContent = original;
    originalText.delete(node);
  }
  maskedNodes.clear();
}
