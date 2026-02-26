/**
 * Fibonacci Priority Limits and Utilities
 */

const FIBONACCI = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];

const PRIORITY_COLORS = [
  { bg: '#dc2626', border: '#991b1b', header: 'P0 — Critical' },
  { bg: '#ea580c', border: '#c2410c', header: 'P1 — Urgent' },
  { bg: '#d97706', border: '#b45309', header: 'P2 — High' },
  { bg: '#ca8a04', border: '#a16207', header: 'P3 — Medium' },
  { bg: '#65a30d', border: '#4d7c0f', header: 'P4 — Normal' },
  { bg: '#0891b2', border: '#0e7490', header: 'P5 — Low' },
  { bg: '#7c3aed', border: '#6d28d9', header: 'P6 — Backlog' },
  { bg: '#6b7280', border: '#4b5563', header: 'P7 — Someday' },
  { bg: '#9ca3af', border: '#6b7280', header: 'P8 — Archive' },
  { bg: '#d1d5db', border: '#9ca3af', header: 'P9 — Ice Box' },
];

export function getFibonacciLimit(priority) {
  if (priority < 0) return 1;
  if (priority >= FIBONACCI.length) return FIBONACCI[FIBONACCI.length - 1];
  return FIBONACCI[priority];
}

export function getPriorityColor(priority) {
  if (priority < 0 || priority >= PRIORITY_COLORS.length) {
    return PRIORITY_COLORS[PRIORITY_COLORS.length - 1];
  }
  return PRIORITY_COLORS[priority];
}

export function getUniquePriorities(items) {
  return [...new Set(items.map(i => i.priority))].sort((a, b) => a - b);
}

export function groupByPriority(items) {
  const groups = {};
  for (const item of items) {
    if (!groups[item.priority]) groups[item.priority] = [];
    groups[item.priority].push(item);
  }
  return groups;
}

export default { getFibonacciLimit, getPriorityColor, getUniquePriorities, groupByPriority };
