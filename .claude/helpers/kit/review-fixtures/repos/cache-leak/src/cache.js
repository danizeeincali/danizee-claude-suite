const entries = new Map();

export function remember(key, value) {
  entries.set(key, value);

  return value;
}

export function recall(key) {
  return entries.get(key);
}

export function size() {
  return entries.size;
}
