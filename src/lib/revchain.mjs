/** Linear chain of revisions for one pixel surface. Each step stores a patch that can be applied forward
 * (to the newer revision) or backward. Undo/redo/jump in the document history only change which revision a
 * layer points at; `path` lists the patches to apply to get there.
 * @template P */
export class RevChain {
  /** @param {number} base */
  constructor(base = 0) {
    /** @type {number[]} */ this.revs = [base];
    /** @type {P[]} */ this.patches = [];
  }
  get head() { return this.revs[this.revs.length - 1]; }
  /** Records a step from `from` to `to`. Steps after `from` (an undone future) are dropped and returned.
   * @param {number} from @param {number} to @param {P} patch @returns {P[]} */
  push(from, to, patch) {
    const index = this.revs.indexOf(from);
    if (index < 0) throw new Error(`Unknown revision ${from}`);
    const dropped = this.patches.splice(index);
    this.revs.length = index + 1;
    this.revs.push(to); this.patches.push(patch);
    return dropped;
  }
  /** @param {number} rev */
  has(rev) { return this.revs.includes(rev); }
  /** Steps that move a surface from revision `from` to `to`.
   * @param {number} from @param {number} to @returns {{ patch: P, forward: boolean }[]} */
  path(from, to) {
    const a = this.revs.indexOf(from), b = this.revs.indexOf(to);
    if (a < 0 || b < 0) throw new Error(`Unknown revision ${a < 0 ? from : to}`);
    const steps = [];
    if (b > a) for (let i = a; i < b; i++) steps.push({ patch: this.patches[i], forward: true });
    else for (let i = a - 1; i >= b; i--) steps.push({ patch: this.patches[i], forward: false });
    return steps;
  }
}

let counter = 0;
/** Revision ids are unique across the session so a dropped future can never be confused with a new edit. */
export function nextRev() { return ++counter; }
