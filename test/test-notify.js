import { test } from 'tape-promise/tape';
import { Flow } from '../src/flow/flowcomm';
import { makeResolutionNotifier } from '../src/vat/notifyUponResolution';

function make() {
  let r;
  const v = new Flow().makeVow((res, _rej) => (r = res));
  return { v, r };
}

test('notify unresolved', async t => {
  const resolves = [];
  function opResolve(...args) {
    resolves.push(args);
  }
  const n = makeResolutionNotifier('myVat', opResolve);
  // unresolved Vow: register for notification later
  const v1 = make();
  n(v1.v, 'target1', 'swiss1');
  await Promise.resolve(0);
  t.equal(resolves.length, 0);

  v1.r('result1');
  t.equal(resolves.length, 0);
  await Promise.resolve(0);
  t.deepEqual(resolves, [['target1', 'swiss1', 'result1']]);
  resolves.shift();

  // adding a new follower, after it has resolved, should be notified
  // promptly

  n(v1.v, 'target2', 'swiss1');
  t.equal(resolves.length, 0);
  await Promise.resolve(0);
  t.deepEqual(resolves, [['target2', 'swiss1', 'result1']]);

  t.end();
});

test('notify already resolved', async t => {
  const resolves = [];
  function opResolve(...args) {
    resolves.push(args);
  }
  const n = makeResolutionNotifier('myVat', opResolve);
  // unresolved Vow: register for notification later
  const v1 = make();
  v1.r('result1');
  await Promise.resolve(0);

  n(v1.v, 'target1', 'swiss1');
  t.equal(resolves.length, 0);
  await Promise.resolve(0);
  t.deepEqual(resolves, [['target1', 'swiss1', 'result1']]);
  resolves.shift();

  // adding a new follower, after it has resolved, should be notified
  // promptly

  n(v1.v, 'target2', 'swiss1');
  t.equal(resolves.length, 0);
  await Promise.resolve(0);
  t.deepEqual(resolves, [['target2', 'swiss1', 'result1']]);

  t.end();
});

test('notify two followers', async t => {
  const resolves = [];
  function opResolve(...args) {
    resolves.push(args);
  }
  const n = makeResolutionNotifier('myVat', opResolve);
  // unresolved Vow: register for notification later
  const v1 = make();
  n(v1.v, 'target1', 'swiss1');
  n(v1.v, 'target2', 'swiss1');

  v1.r('result1');
  await Promise.resolve(0);
  t.equal(resolves.length, 2);
  // TODO: notification order depends upon Set iteration, will this cause
  // nondeterminism?

  function cmp(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  resolves.sort((a, b) => cmp(a[0], b[0]));

  t.deepEqual(resolves, [
    ['target1', 'swiss1', 'result1'],
    ['target2', 'swiss1', 'result1'],
  ]);

  t.end();
});
