export function pageCount(total, perPage) {
  return Math.floor(total / perPage);
}

export function slicePage(items, page, perPage) {
  const start = page * perPage;
  return items.slice(start, start + perPage);
}

export function label(page, count) {
  return `page ${page + 1} of ${count}`;
}
