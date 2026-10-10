const entries = new Map();

export function remember(key, value) {
  entries.set(key, value);
  // planted bug: nothing ever evicts an entry, so the map grows without bound
  return value;
}

export function recall(key) {
  return entries.get(key);
}

export function size() {
  return entries.size;
}
