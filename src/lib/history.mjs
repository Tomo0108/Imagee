/** Linear undo history of immutable document states.
 * @template T
 * @typedef {{ past: { state: T, label: string }[], present: T, label: string, future: { state: T, label: string }[] }} History */

export const LIMIT = 500;

/** @template T @param {T} state @param {string} [label] @returns {History<T>} */
export function createHistory(state, label = '開く') { return { past: [], present: state, label, future: [] }; }

/** Records a new state. Consecutive changes with the same `mergeKey` (e.g. dragging one slider) collapse into one step.
 * @template T @param {History<T>} history @param {T} state @param {string} label @param {boolean} [merge] @returns {History<T>} */
export function commit(history, state, label, merge = false) {
  if (state === history.present) return history;
  if (merge && history.label === label && history.past.length) return { ...history, present: state, future: [] };
  const past = [...history.past, { state: history.present, label: history.label }].slice(-LIMIT);
  return { past, present: state, label, future: [] };
}

/** @template T @param {History<T>} history @returns {History<T>} */
export function undo(history) {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous.state, label: previous.label, future: [{ state: history.present, label: history.label }, ...history.future] };
}

/** @template T @param {History<T>} history @returns {History<T>} */
export function redo(history) {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, { state: history.present, label: history.label }], present: next.state, label: next.label, future: history.future.slice(1) };
}

/** Jumps to any entry in the list returned by `entries`. @template T @param {History<T>} history @param {number} index @returns {History<T>} */
export function jump(history, index) {
  let result = history;
  while (result.past.length > index && result.past.length) result = undo(result);
  while (result.past.length < index && result.future.length) result = redo(result);
  return result;
}

/** All steps in order with the current one marked. @template T @param {History<T>} history */
export function entries(history) {
  return [...history.past.map(item => ({ label: item.label, current: false, future: false })), { label: history.label, current: true, future: false }, ...history.future.map(item => ({ label: item.label, current: false, future: true }))];
}
