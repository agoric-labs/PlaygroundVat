import { m2 } from './m2';

/* eslint-disable-next-line no-unused-vars */
const a = 2;

export function foo() {
  // note: if we didn't disable tree-shaking, this whole function body would
  // be dropped, because Rollup is able to tell that we don't return
  // anything, and m2() has no side-effects.
  m2();
}
