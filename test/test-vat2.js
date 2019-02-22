/* global Vow Flow */

import { test } from 'tape-promise/tape';
import Nat from '@agoric/nat';
import { makeRealm, buildVat } from '../src/main';
import { makeTranscript, funcToSource, makeQueues } from './util';
import { hash58 } from '../src/host';

function t1Sender() {
  exports.default = argv => {
    let answer = 'unanswered';
    Vow.resolve(argv.target)
      .e.pleaseRespond('marco')
      .then(res => {
        console.log(`got answer: ${res}`);
        answer = res;
      });
    return {
      getAnswer() {
        return answer;
      },
    };
  };
}

function t1Responder() {
  exports.default = _argv => {
    let called = false;
    return {
      pleaseRespond(arg) {
        called = true;
        console.log(`pleaseRespond called with ${arg}`);
        return `${arg}-polo`;
      },
      getCalled() {
        return called;
      },
    };
  };
}

test('comms, sending a message', async t => {
  const tr = makeTranscript();
  const endow = {
    writeOutput: tr.writeOutput,
    comms: { registerManager() {}, wantConnection() {} },
    hash58,
  };
  const s = makeRealm({ consoleMode: 'allow' });
  const req = s.makeRequire({ '@agoric/nat': Nat, '@agoric/harden': true });
  const v1src = funcToSource(t1Sender);
  const v1 = await buildVat(
    s,
    req,
    'vat1',
    'vat1 secret',
    'vat1',
    endow,
    v1src,
  );
  const v1argv = { target: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t1Responder);
  const v2 = await buildVat(
    s,
    req,
    'vat2',
    'vat2 secret',
    'vat2',
    endow,
    v2src,
  );
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);
  const q = makeQueues(t);
  let got;

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v2.connectionMade('vat1', q.addQueue(2, 1));

  got = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-ScrHVw5LqkhEJMJdeCE17W',
      targetSwissnum: '0',
      methodName: 'pleaseRespond',
      args: ['marco'],
    },
  );
  v2.commsReceived('vat1', got);

  got = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV' },
  );
  v2.commsReceived('vat1', got);
  q.expectEmpty(1, 2);

  // that immediately provokes an ack

  q.expectAndDeliverAck(2, 1, v1, 0);

  // the pleaseRespond isn't executed until a turn later
  q.expectEmpty(2, 1);
  t.equal(v2root.getCalled(), false);
  await Promise.resolve(0);
  t.equal(v2root.getCalled(), true);

  got = q.expect(
    2,
    1,
    { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
    {
      op: 'resolve',
      targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
      value: 'marco-polo',
    },
  );

  q.expectEmpty(1, 2);
  t.equal(v1root.getAnswer(), 'unanswered');

  // deliver the response
  v1.commsReceived('vat2', got);
  // that takes a turn to be processed
  await Promise.resolve(0);

  t.equal(v1root.getAnswer(), 'marco-polo');

  t.end();
});

function t2Sender() {
  exports.default = argv => {
    let r1;
    const v1 = new Flow().makeVow(res => (r1 = res));
    Vow.resolve(argv.target).e.pleaseWait(v1);
    return {
      fire(arg) {
        r1(arg);
      },
    };
  };
}

function t2Responder() {
  exports.default = _argv => {
    let called = false;
    let answer = 'not yet';
    return {
      pleaseWait(arg) {
        console.log(`pleaseWait called with ${arg}`);
        called = true;
        Vow.resolve(arg).then(res => {
          console.log(`resolved`);
          answer = res;
        });
      },
      getCalled() {
        return called;
      },
      getAnswer() {
        return answer;
      },
    };
  };
}

test('sending unresolved local Vow', async t => {
  const tr = makeTranscript();
  const endow = {
    writeOutput: tr.writeOutput,
    comms: { registerManager() {}, wantConnection() {} },
    hash58,
  };
  const s = makeRealm({ consoleMode: 'allow' });
  const req = s.makeRequire({ '@agoric/nat': Nat, '@agoric/harden': true });
  const v1src = funcToSource(t2Sender);
  const v1 = await buildVat(
    s,
    req,
    'vat1',
    'vat1 secret',
    'vat1',
    endow,
    v1src,
  );
  const v1argv = { target: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t2Responder);
  const v2 = await buildVat(
    s,
    req,
    'vat2',
    'vat2 secret',
    'vat2',
    endow,
    v2src,
  );
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);
  const q = makeQueues(t);
  let got;

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v2.connectionMade('vat1', q.addQueue(2, 1));

  got = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-ScrHVw5LqkhEJMJdeCE17W',
      targetSwissnum: '0',
      methodName: 'pleaseWait',
      args: [
        {
          '@qclass': 'vow',
          vatID: 'vat1',
          swissnum: '2-XpvixAJgvUFL8NY6AZkUH9',
        },
      ],
    },
  );
  v2.commsReceived('vat1', got);
  got = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV' },
  );
  q.expectEmpty(1, 2);
  v2.commsReceived('vat1', got);
  // that immediately provokes an ack

  // deliver the ack, doesn't cause any interesting externally-visible
  // changes, and doesn't provoke any outbound messages
  q.expectAndDeliverAck(2, 1, v1, 0);

  // receiving a Vow causes vat2 to subscribe for a resolution
  got = q.expect(
    2,
    1,
    { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
    { op: 'when', targetSwissnum: '2-XpvixAJgvUFL8NY6AZkUH9' },
  );
  v1.commsReceived('vat2', got);
  q.expectEmpty(2, 1);
  q.expectEmpty(1, 2);

  // the pleaseRespond isn't executed until a turn later
  t.equal(v2root.getCalled(), false);
  await Promise.resolve(0);
  t.equal(v2root.getCalled(), true);

  got = q.expect(
    2,
    1,
    { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 1 },
    {
      op: 'resolve',
      targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
      value: { '@qclass': 'undefined' },
    },
  );
  t.equal(v2root.getAnswer(), 'not yet');

  // pleaseWait() returned 'undefined', so now the caller's Vow gets resolved
  // (although nobody cares)
  v1.commsReceived('vat2', got);
  // that takes a turn to be processed
  await Promise.resolve(0);
  t.equal(v2root.getAnswer(), 'not yet');

  // that sends another ack
  q.expectAndDeliverAck(1, 2, v2, 0);

  // now tell the sender to resolve the Vow they sent to the responder
  v1root.fire('pretty');
  q.expectEmpty(1, 2);

  await Promise.resolve(0);

  got = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 2 },
    {
      op: 'resolve',
      targetSwissnum: '2-XpvixAJgvUFL8NY6AZkUH9',
      value: 'pretty',
    },
  );
  v2.commsReceived('vat1', got);
  q.expectAndDeliverAck(2, 1, v1, 1);

  t.equal(v2root.getAnswer(), 'not yet');
  await Promise.resolve(0);
  t.equal(v2root.getAnswer(), 'pretty');

  t.end();
});

function t3One() {
  exports.default = argv => {
    const two = Vow.resolve(argv.target2).e.getVow();
    /* eslint-disable-next-line no-unused-vars */
    const three = Vow.resolve(argv.target3).e.pleaseWait(two);
  };
}

function t3Two() {
  exports.default = _argv => {
    let r;
    const vtwo = new Flow().makeVow(res => (r = res));
    return {
      getVow(_arg) {
        console.log('getVow');
        return vtwo;
      },
      fire(arg) {
        r(arg);
      },
    };
  };
}

function t3Three() {
  exports.default = _argv => {
    let fired = false;
    return {
      pleaseWait(vtwo) {
        Vow.resolve(vtwo).then(res => (fired = res));
      },
      getFired() {
        return fired;
      },
    };
  };
}

test('sending third-party Vow', async t => {
  const tr = makeTranscript();
  const endow = {
    writeOutput: tr.writeOutput,
    comms: { registerManager() {}, wantConnection() {} },
    hash58,
  };
  const s = makeRealm({ consoleMode: 'allow' });
  const req = s.makeRequire({ '@agoric/nat': Nat, '@agoric/harden': true });
  const v1src = funcToSource(t3One);
  const v1 = await buildVat(
    s,
    req,
    'vat1',
    'vat1 secret',
    'vat1',
    endow,
    v1src,
  );
  const v1argv = {
    target2: v1.createPresence('vat2/0'),
    target3: v1.createPresence('vat3/0'),
  };
  /* eslint-disable-next-line no-unused-vars */
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t3Two);
  const v2 = await buildVat(
    s,
    req,
    'vat2',
    'vat2 secret',
    'vat2',
    endow,
    v2src,
  );
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v3src = funcToSource(t3Three);
  const v3 = await buildVat(
    s,
    req,
    'vat3',
    'vat3 secret',
    'vat3',
    endow,
    v3src,
  );
  const v3argv = {};
  const v3root = await v3.initializeCode('vat3/0', v3argv);
  const q = makeQueues(t);

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v1.connectionMade('vat3', q.addQueue(1, 3));
  v2.connectionMade('vat1', q.addQueue(2, 1));
  v3.connectionMade('vat1', q.addQueue(3, 1));

  const got1 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-ScrHVw5LqkhEJMJdeCE17W',
      targetSwissnum: '0',
      methodName: 'getVow',
      args: [],
    },
  );
  const got2 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV' },
  );
  q.expectEmpty(1, 2);

  const got3 = q.expect(
    1,
    3,
    { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b2-XpvixAJgvUFL8NY6AZkUH9',
      targetSwissnum: '0',
      methodName: 'pleaseWait',
      args: [
        {
          '@qclass': 'vow',
          vatID: 'vat1', // owned by vat1
          swissnum: '3-2WmvhqEL1SgSTa9chi8PAr',
        },
      ],
    },
  );
  const got4 = q.expect(
    1,
    3,
    { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ' },
  );
  q.expectEmpty(1, 3);

  v2.commsReceived('vat1', got1); // getVow()
  v2.commsReceived('vat1', got2); // subscribe to result of getVow()

  // the getVow isn't executed until a turn later
  q.expectEmpty(2, 1);
  await Promise.resolve(0);

  // and because getVow() returned an unresolved Vow, no opResolve is sent
  // yet: nothing is sent until it is resolved by v2root.fire()
  q.expectEmpty(2, 1);

  v3.commsReceived('vat1', got3); // pleaseWait(two)
  // that provokes vat3 to subscribe for resolution of 'two'
  const got5 = q.expect(
    3,
    1,
    { fromVatID: 'vat3', toVatID: 'vat1', seqnum: 0 },
    { op: 'when', targetSwissnum: '3-2WmvhqEL1SgSTa9chi8PAr' },
  );
  q.expectEmpty(3, 1);
  v1.commsReceived('vat3', got5);
  q.expectEmpty(1, 3);

  v3.commsReceived('vat1', got4); // subscribe to result of pleaseWait()
  q.expectEmpty(3, 1);

  // a turn later, the resut of pleaseWait() resolves (to undefined)
  await Promise.resolve(0);
  const got6 = q.expect(
    3,
    1,
    { fromVatID: 'vat3', toVatID: 'vat1', seqnum: 1 },
    {
      op: 'resolve',
      targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ',
      value: { '@qclass': 'undefined' },
    },
  );
  q.expectEmpty(3, 1);

  v1.commsReceived('vat3', got6);
  await Promise.resolve(0);
  q.expectEmpty(1, 3);

  // now things are quiet until we tell vat2 to fire()
  t.equal(v3root.getFired(), false);

  // ok, now we tell vat2 to resolve the Vow, and we expect vat3 to
  // eventually be notified
  console.log('FIRE IN THE HOLE');
  v2root.fire('burns');

  // nothing happens for a turn
  q.expectEmpty(2, 1);
  await Promise.resolve(0);

  // first, vat2 should tell vat1 about the resolution
  const got7 = q.expect(
    2,
    1,
    { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
    {
      op: 'resolve',
      targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
      value: 'burns',
    },
  );

  v1.commsReceived('vat2', got7);

  // and vat1 now tells vat3 about the resolution, after a turn
  q.expectEmpty(1, 3);
  await Promise.resolve(0);
  const got8 = q.expect(
    1,
    3,
    { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 2 },
    {
      op: 'resolve',
      targetSwissnum: '3-2WmvhqEL1SgSTa9chi8PAr',
      value: 'burns',
    },
  );
  v3.commsReceived('vat1', got8);

  t.equal(v3root.getFired(), false);
  await Promise.resolve(0);
  t.equal(v3root.getFired(), 'burns');

  t.end();
});

function t4One() {
  exports.default = argv => {
    const two = Vow.resolve(argv.target2).e.getVow();
    /* eslint-disable-next-line no-unused-vars */
    const three = Vow.resolve(argv.target3).e.pleaseWait(two);
  };
}

function t4Two() {
  exports.default = _argv => {
    let r;
    const vtwo = new Flow().makeVow(res => (r = res));
    const presence = {};
    return {
      getVow(_arg) {
        console.log('getVow');
        return vtwo;
      },
      getPresence() {
        return presence;
      },
      fire(arg) {
        r(arg);
      },
    };
  };
}

function t4Three() {
  exports.default = _argv => {
    let fired = false;
    return {
      pleaseWait(vtwo) {
        Vow.resolve(vtwo).then(res => (fired = res));
      },
      getFired() {
        return fired;
      },
    };
  };
}

test('sending third-party Vow that resolves to Presence', async t => {
  const tr = makeTranscript();
  const endow = {
    writeOutput: tr.writeOutput,
    comms: { registerManager() {}, wantConnection() {} },
    hash58,
  };
  const s = makeRealm({ consoleMode: 'allow' });
  const req = s.makeRequire({ '@agoric/nat': Nat, '@agoric/harden': true });
  const v1src = funcToSource(t4One);
  const v1 = await buildVat(
    s,
    req,
    'vat1',
    'vat1 secret',
    'vat1',
    endow,
    v1src,
  );
  const v1argv = {
    target2: v1.createPresence('vat2/0'),
    target3: v1.createPresence('vat3/0'),
  };
  /* eslint-disable-next-line no-unused-vars */
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t4Two);
  const v2 = await buildVat(
    s,
    req,
    'vat2',
    'vat2 secret',
    'vat2',
    endow,
    v2src,
  );
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v3src = funcToSource(t4Three);
  const v3 = await buildVat(
    s,
    req,
    'vat3',
    'vat3 secret',
    'vat3',
    endow,
    v3src,
  );
  const v3argv = {};
  const v3root = await v3.initializeCode('vat3/0', v3argv);
  const q = makeQueues(t);

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v1.connectionMade('vat3', q.addQueue(1, 3));
  v2.connectionMade('vat1', q.addQueue(2, 1));
  v3.connectionMade('vat1', q.addQueue(3, 1));

  const got1 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-ScrHVw5LqkhEJMJdeCE17W',
      targetSwissnum: '0',
      methodName: 'getVow',
      args: [],
    },
  );
  const got2 = q.expect(
    1,
    2,
    { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV' },
  );
  q.expectEmpty(2, 1);
  const got3 = q.expect(
    1,
    3,
    { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b2-XpvixAJgvUFL8NY6AZkUH9',
      targetSwissnum: '0',
      methodName: 'pleaseWait',
      args: [
        {
          '@qclass': 'vow',
          vatID: 'vat1', // owned by vat1
          swissnum: '3-2WmvhqEL1SgSTa9chi8PAr',
        },
      ],
    },
  );
  const got4 = q.expect(
    1,
    3,
    { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ' },
  );
  q.expectEmpty(3, 1);

  v2.commsReceived('vat1', got1); // getVow()
  v2.commsReceived('vat1', got2);

  // the getVow isn't executed until a turn later, but nothing is sent until
  // v2root.fire() resolves 'vtwo'
  await Promise.resolve(0);
  q.expectEmpty(2, 1);

  v3.commsReceived('vat1', got3); // pleaseWait(two)
  // that makes vat3 want to know when 'two' resolves
  const got5 = q.expect(
    3,
    1,
    { fromVatID: 'vat3', toVatID: 'vat1', seqnum: 0 },
    { op: 'when', targetSwissnum: '3-2WmvhqEL1SgSTa9chi8PAr' },
  );
  q.expectEmpty(3, 1);

  v3.commsReceived('vat1', got4); // vat1 wants to know when the pleaseWait resolves
  q.expectEmpty(3, 1);
  await Promise.resolve(0);

  const got6 = q.expect(
    3,
    1,
    { fromVatID: 'vat3', toVatID: 'vat1', seqnum: 1 },
    {
      op: 'resolve',
      targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ',
      value: { '@qclass': 'undefined' },
    },
  );

  q.expectEmpty(3, 1);

  v1.commsReceived('vat3', got5);
  await Promise.resolve(0);
  q.expectEmpty(1, 3);

  v1.commsReceived('vat3', got6); // resolves pleaseWait() to undefined
  await Promise.resolve(0);
  q.expectEmpty(1, 3);

  t.equal(v3root.getFired(), false);
  // ok, now we tell vat2 to resolve the Vow, and we expect vat3 to
  // eventually be notified
  console.log('FIRE IN THE HOLE');
  v2root.fire(v2root.getPresence());

  // nothing happens for a turn
  q.expectEmpty(2, 1);
  await Promise.resolve(0);

  // first, vat2 should tell vat1 about the resolution
  const got7 = q.expect(
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

  v1.commsReceived('vat2', got7); // resolves getVow()

  // and vat1 now tells vat3 about the resolution, after a turn
  q.expectEmpty(1, 3);
  await Promise.resolve(0);

  const got8 = q.expect(
    1,
    3,
    { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 2 },
    {
      op: 'resolve',
      targetSwissnum: '3-2WmvhqEL1SgSTa9chi8PAr',
      value: {
        '@qclass': 'presence',
        vatID: 'vat2',
        swissnum: '1-YAjJjvUTPE9jgFC1USrG5B',
      },
    },
  );
  v3.commsReceived('vat1', got8);

  t.equal(v3root.getFired(), false);
  await Promise.resolve(0);
  t.deepEqual(v3root.getFired(), {});

  t.end();
});

// We create a Vow on Alice, who sends it to Bob. Bob sends it to Carol. Test
// that Carol subscribes (directly to Alice) to hear about its resolution.
function t5Alice() {
  exports.default = argv => {
    const v1 = new Flow().makeVow(_ => null);
    console.log('alice sends to bob');
    Vow.resolve(argv.bob).e.send1(v1); // got1
    console.log('alice sent to bob');
  };
}

function t5Bob() {
  exports.default = argv => {
    let bobStart = false;
    return {
      send1(v1) {
        // invoked by got1, then got2 subscribes to hear about v1
        bobStart = true;
        Vow.resolve(argv.carol).e.send2(v1); // got3
        return 'send1 done';
      },
      getBobStart() {
        return bobStart;
      },
    };
  };
}

function t5Carol() {
  exports.default = _argv => {
    let carolDone = false;
    return {
      send2(_v1) {
        carolDone = true;
      },
      getCarolDone() {
        return carolDone;
      },
    };
  };
}

test('third-party Vow gets resolved', async t => {
  const tr = makeTranscript();
  const endow = {
    writeOutput: tr.writeOutput,
    comms: { registerManager() {}, wantConnection() {} },
    hash58,
  };
  const s = makeRealm({ consoleMode: 'allow' });
  /* eslint-disable-next-line no-unused-vars */
  const req = s.makeRequire({ '@agoric/nat': Nat, '@agoric/harden': true });

  const ALICE = 'ALICE';
  const aliceSrc = funcToSource(t5Alice);
  const vatALICE = await buildVat(
    s,
    'vatALICE',
    'aSecret',
    'vatALICE',
    endow,
    aliceSrc,
  );
  const aliceArgv = { bob: vatALICE.createPresence('vatBOB/0') };
  /* eslint-disable-next-line no-unused-vars */
  const aliceRoot = await vatALICE.initializeCode('vatALICE/0', aliceArgv);

  const BOB = 'BOB';
  const bobSrc = funcToSource(t5Bob);
  const vatBOB = await buildVat(
    s,
    'vatBOB',
    'bSecret',
    'vatBOB',
    endow,
    bobSrc,
  );
  const bobArgv = { carol: vatBOB.createPresence('vatCAROL/0') };
  const bobRoot = await vatBOB.initializeCode('vatBOB/0', bobArgv);

  const CAROL = 'CAROL';
  const carolSrc = funcToSource(t5Carol);
  const vatCAROL = await buildVat(
    s,
    'vatCAROL',
    'cSecret',
    'vatCAROL',
    endow,
    carolSrc,
  );
  const carolArgv = {};
  /* eslint-disable-next-line no-unused-vars */
  const carolRoot = await vatCAROL.initializeCode('vatCAROL/0', carolArgv);
  const q = makeQueues(t); // , { [ALICE]: 'alice', [BOB]: 'bob', [CAROL]: 'carol'});

  vatALICE.connectionMade('vatBOB', q.addQueue(ALICE, BOB));
  vatALICE.connectionMade('vatCAROL', q.addQueue(ALICE, CAROL));
  vatBOB.connectionMade('vatALICE', q.addQueue(BOB, ALICE));
  vatBOB.connectionMade('vatCAROL', q.addQueue(BOB, CAROL));
  vatCAROL.connectionMade('vatALICE', q.addQueue(CAROL, ALICE));
  vatCAROL.connectionMade('vatBOB', q.addQueue(CAROL, BOB));

  const got1 = q.expect(
    ALICE,
    BOB,
    { fromVatID: 'vatALICE', toVatID: 'vatBOB', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-MNQVNFAc7xPRwuiSDCk9G4',
      targetSwissnum: '0',
      methodName: 'send1',
      args: [
        {
          '@qclass': 'vow',
          vatID: 'vatALICE',
          swissnum: '2-AKBLiXq4RBPLe9jVZFKD6o',
        },
      ],
    },
  );
  /* eslint-disable-next-line no-unused-vars */
  const got1a = q.expect(
    ALICE,
    BOB,
    { fromVatID: 'vatALICE', toVatID: 'vatBOB', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-MNQ-DKZopq7QbRY29Fi8JZKi7u' },
  );
  q.expectEmpty(ALICE, BOB);

  t.equal(bobRoot.getBobStart(), false);
  q.expectEmpty(BOB, ALICE);
  q.expectEmpty(BOB, CAROL);

  vatBOB.commsReceived('vatALICE', got1);
  await Promise.resolve(0);
  t.equal(bobRoot.getBobStart(), true);
  /* eslint-disable-next-line no-unused-vars */
  const got2 = q.expect(
    BOB,
    ALICE,
    { fromVatID: 'vatBOB', toVatID: 'vatALICE', seqnum: 0 },
    { op: 'when', targetSwissnum: '2-AKBLiXq4RBPLe9jVZFKD6o' },
  );
  q.expectEmpty(BOB, ALICE);
  const got3 = q.expect(
    BOB,
    CAROL,
    { fromVatID: 'vatBOB', toVatID: 'vatCAROL', seqnum: 0 },
    {
      op: 'send',
      resultSwissbase: 'b1-QJsvncNfsZ1Qt2SaYXuLvF',
      targetSwissnum: '0',
      methodName: 'send2',
      args: [
        {
          '@qclass': 'vow',
          vatID: 'vatALICE',
          swissnum: '2-AKBLiXq4RBPLe9jVZFKD6o',
        },
      ],
    },
  );
  /* eslint-disable-next-line no-unused-vars */
  const got3a = q.expect(
    BOB,
    CAROL,
    { fromVatID: 'vatBOB', toVatID: 'vatCAROL', seqnum: 1 },
    { op: 'when', targetSwissnum: 'hb1-QJs-5XMaJFpEsbnQ5keusqDWQG' },
  );
  q.expectEmpty(BOB, CAROL);

  // this is what we care about: Carol subscribes directly to Alice (not Bob)
  // for the resolution of 'v1'
  vatCAROL.commsReceived('vatBOB', got3);
  /* eslint-disable-next-line no-unused-vars */
  const got4 = q.expect(
    CAROL,
    ALICE,
    { fromVatID: 'vatCAROL', toVatID: 'vatALICE', seqnum: 0 },
    { op: 'when', targetSwissnum: '2-AKBLiXq4RBPLe9jVZFKD6o' },
  );
  return t.end();
});
