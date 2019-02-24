/* global Vow */

import { test } from 'tape-promise/tape';
import Nat from '@agoric/nat';
import { makeRealm, buildVat } from '../src/main';
import { makeTranscript, funcToSource, makeQueues } from './util';
import { hash58 } from '../src/host';

function t1Left() {
  exports.default = argv => {
    let done;
    const p2 = Vow.resolve(argv.p1).e.foo('foo');
    const p3 = p2.e.bar('bar');
    p3.then(res => {
      done = res;
    });
    return {
      getDone() {
        return done;
      },
    };
  };
}

function t1Right() {
  exports.default = _argv => {
    let fooCalled;
    let barCalled;
    const obj2 = {
      bar(arg) {
        barCalled = arg;
        return 'done';
      },
    };
    return {
      foo(arg) {
        fooCalled = arg;
        return obj2;
      },
      getFooCalled() {
        return fooCalled;
      },
      getBarCalled() {
        return barCalled;
      },
    };
  };
}

test('promise pipelining', async t => {
  const tr = makeTranscript();
  const endow = {
    writeOutput: tr.writeOutput,
    comms: { registerManager() {}, wantConnection() {} },
    hash58,
  };
  const s = makeRealm();
  const req = s.makeRequire({ '@agoric/nat': Nat, '@agoric/harden': true });
  const v1 = await buildVat(
    s,
    req,
    'vat1',
    'vat1 secret',
    'vat1',
    endow,
    funcToSource(t1Left),
  );
  const v1argv = { p1: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2 = await buildVat(
    s,
    req,
    'vat2',
    'vat2 secret',
    'vat2',
    endow,
    funcToSource(t1Right),
  );
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);
  const q = makeQueues(t);

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v2.connectionMade('vat1', q.addQueue(2, 1));

  // foo() is transmitted immediately, and bar() is pipelined right behind it

  const got1 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-ScrHVw5LqkhEJMJdeCE17W',
      targetSwissnum: '0',
      methodName: 'foo',
      args: ['foo'],
    },
  );

  const got2 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV' },
  );

  const got3 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 2 },
    {
      op: 'send',
      resultSwissbase: 'b2-XpvixAJgvUFL8NY6AZkUH9',
      targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
      methodName: 'bar',
      args: ['bar'],
    },
  );

  const got4 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 3 },
    { op: 'when', targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ' },
  );

  q.expectEmpty(1, 2);

  // delivering foo() causes p2 to be resolved, then bar() can be delivered immediately
  v2.commsReceived('vat1', got1); // foo()
  v2.commsReceived('vat1', got2); // 'when' to resolve p2
  await Promise.resolve(0);
  t.equal(v2root.getFooCalled(), 'foo');

  v2.commsReceived('vat1', got3); // bar()
  v2.commsReceived('vat1', got4); // 'when' to resolve p3
  await Promise.resolve(0);
  t.equal(v2root.getBarCalled(), 'bar');

  const got5 = q.expect(
    2,
    1,
    { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
    {
      op: 'resolve',
      targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
      value: {
        '@qclass': 'presence',
        vatID: 'vat2',
        swissnum: '1-YAjJjvUTPE9jgFC1USrG5B',
      },
    },
  );

  const got6 = q.expect(
    2,
    1,
    { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 1 },
    {
      op: 'resolve',
      targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ',
      value: 'done',
    },
  );

  q.expectEmpty(2, 1);
  v1.commsReceived('vat2', got5); // resolves p2
  v1.commsReceived('vat2', got6); // resolves p3
  await Promise.resolve(0);
  t.equal(v1root.getDone(), 'done');

  t.end();
});

function t2Alice() {
  exports.default = argv => {
    const p1 = Vow.resolve(argv.bob).e.getTarget1();
    /* eslint-disable-next-line no-unused-vars */
    const p2 = p1.e.call('foo');
    return {
      // send bar manually after we see it get shortened
      sendBar() {
        p1.e.call('bar');
      },
    };
  };
}

function t2Bob() {
  exports.default = argv => {
    const carolP = Vow.resolve(argv.carol);
    return {
      getTarget1() {
        const targetP = carolP.e.getTarget2();
        targetP.e.call('baz');
        return targetP;
      },
    };
  };
}

function t2Carol() {
  exports.default = _argv => {
    const calls = [];
    const target = {
      call(arg) {
        calls.push(arg);
        return arg;
      },
    };
    return {
      getTarget2() {
        return target;
      },
    };
  };
}

test('promise pipelining to third party', async t => {
  const tr = makeTranscript();
  const endow = {
    writeOutput: tr.writeOutput,
    comms: { registerManager() {}, wantConnection() {} },
    hash58,
  };
  const s = makeRealm();
  const req = s.makeRequire({ '@agoric/nat': Nat, '@agoric/harden': true });
  const v1 = await buildVat(
    s,
    req,
    'vat1',
    'vat1 secret',
    'vat1',
    endow,
    funcToSource(t2Alice),
  );
  const v1argv = { bob: v1.createPresence('vat2/0') };
  /* eslint-disable-next-line no-unused-vars */
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2 = await buildVat(
    s,
    req,
    'vat2',
    'vat2 secret',
    'vat2',
    endow,
    funcToSource(t2Bob),
  );
  const v2argv = { carol: v2.createPresence('vat3/0') };
  /* eslint-disable-next-line no-unused-vars */
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v3 = await buildVat(
    s,
    req,
    'vat3',
    'vat3 secret',
    'vat3',
    endow,
    funcToSource(t2Carol),
  );
  const v3argv = {};
  /* eslint-disable-next-line no-unused-vars */
  const v3root = await v3.initializeCode('vat3/0', v3argv);

  const q = makeQueues(t);

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v1.connectionMade('vat3', q.addQueue(1, 3));
  v2.connectionMade('vat1', q.addQueue(2, 1));
  v2.connectionMade('vat3', q.addQueue(2, 3));
  v3.connectionMade('vat1', q.addQueue(3, 1));
  v3.connectionMade('vat2', q.addQueue(3, 2));

  // getTarget1 is sent immediately, causing p1 to point at Bob, and
  // call(foo) is pipelined right behind it

  const got1 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-ScrHVw5LqkhEJMJdeCE17W',
      targetSwissnum: '0',
      methodName: 'getTarget1',
      args: [],
    },
  );

  const got2 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV' },
  );

  const got3 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 2 },
    {
      op: 'send',
      resultSwissbase: 'b2-XpvixAJgvUFL8NY6AZkUH9',
      targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
      methodName: 'call',
      args: ['foo'],
    },
  );

  const got4 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 3 },
    { op: 'when', targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ' },
  );

  q.expectEmpty(1, 2);

  // delivering getTarget1 can shorten p1 to point at Carol
  v2.commsReceived('vat1', got1); // getTarget1()
  v2.commsReceived('vat1', got2); // 'when' to resolve p2
  await Promise.resolve(0);

  // this sends getTarget2 to Carol, with baz right behind it

  /* eslint-disable-next-line no-unused-vars */
  const got5 = q.expect(
    2,
    3,
    { fromVatID: 'vat2', toVatID: 'vat3', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-YAjJjvUTPE9jgFC1USrG5B',
      targetSwissnum: '0',
      methodName: 'getTarget2',
      args: [],
    },
  );

  /* eslint-disable-next-line no-unused-vars */
  const got6 = q.expect(
    2,
    3,
    { fromVatID: 'vat2', toVatID: 'vat3', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-YAj-Vv5XMJYHSunn14Xhp12q4V' },
  );

  /* eslint-disable-next-line no-unused-vars */
  const got7 = q.expect(
    2,
    3,
    { fromVatID: 'vat2', toVatID: 'vat3', seqnum: 2 },
    {
      op: 'send',
      resultSwissbase: 'b2-FjSN9V1NRpjdk6mWpF4dJV',
      targetSwissnum: 'hb1-YAj-Vv5XMJYHSunn14Xhp12q4V',
      methodName: 'call',
      args: ['baz'],
    },
  );

  /* eslint-disable-next-line no-unused-vars */
  const got8 = q.expect(
    2,
    3,
    { fromVatID: 'vat2', toVatID: 'vat3', seqnum: 3 },
    { op: 'when', targetSwissnum: 'hb2-FjS-7T1oQyBfNxTdFHzv34sA7P' },
  );

  q.expectEmpty(2, 3);

  // TODO: delivering call(foo) to Bob should cause it to be forwarded to
  // Carol, but for now it just gets queued at Bob until targetP resolves.
  // When we implement forwarding/shortening, this will change.
  v2.commsReceived('vat1', got3);
  v2.commsReceived('vat1', got4);
  await Promise.resolve(0);

  q.expectEmpty(2, 3);
  q.expectEmpty(2, 1);

  // todo: after implementing forwarding, look at the 2->3 messages and make
  // sure both call(foo) and call(baz) are sent. And trigger v1root.sendBar()
  // to see how call(bar) is interleaved.

  t.end();
});
