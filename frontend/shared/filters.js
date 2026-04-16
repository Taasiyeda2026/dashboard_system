// ============================================================
// filters.js — Reusable filter bar builder
// ============================================================

/**
 * Build a filter bar HTML string.
 * @param {Array} fields - [{ id, label, type: "select"|"text", options: [{value, label}] }]
 * @param {Object} current - current filter values
 * @returns {string} HTML string
 */
export function buildFilterBar(fields, current = {}) {
  const parts = fields.map((f) => {
    if (f.type === "select") {
      const opts = [{ value: "", label: `כל ${f.label}` }, ...f.options]
        .map((o) => `<option value="${o.value}" ${current[f.id] === o.value ? "selected" : ""}>${o.label}</option>`)
        .join("");
      return `<select class="filter-select" data-filter="${f.id}">${opts}</select>`;
    }
    if (f.type === "text") {
      return `<input class="filter-input" type="text" placeholder="${f.label}" data-filter="${f.id}" value="${current[f.id] ?? ""}">`;
    }
    return "";
  });

  return `<div class="filter-bar">${parts.join("")}</div>`;
}

/**
 * Read current filter values from a container element.
 */
export function readFilters(container) {
  const result = {};
  container.querySelectorAll("[data-filter]").forEach((el) => {
    result[el.dataset.filter] = el.value;
  });
  return result;
}

/**
 * Attach change/input listeners to a filter bar.
 * Calls onChange(filters) on any change.
 */
export function attachFilterListeners(container, onChange) {
  container.querySelectorAll("[data-filter]").forEach((el) => {
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, () => onChange(readFilters(container)));
  });
}
