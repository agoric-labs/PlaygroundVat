import { test } from 'tape-promise/tape';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import { makeTranscript, funcToSource, makeQueues } from './util';

function t1_sender() {
  exports.default = function(argv) {
    let answer = 'unanswered';
    Vow.resolve(argv.target).e.pleaseRespond('marco')
      .then(res => {
        log(`got answer: ${res}`);
        answer = res;
      });
    return {
      getAnswer() { return answer; },
    };
  };
}

function t1_responder() {
  exports.default = function(argv) {
    let called = false;
    return {
      pleaseRespond(arg) {
        called = true;
        log(`pleaseRespond called with ${arg}`);
        return `${arg}-polo`;
      },
      getCalled() { return called; },
    };
  };
}


test('comms, sending a message', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v1src = funcToSource(t1_sender);
  const v1 = await buildVat(s, 'vat1', 'vat1', tr.writeOutput, v1src);
  const v1argv = { target: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t1_responder);
  const v2 = await buildVat(s, 'vat2', 'vat2', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);
  const q = makeQueues(t);
  let got;

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v2.connectionMade('vat1', q.addQueue(2, 1));

  got = q.expect(1, 2,
                 { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0},
                 { op: 'send',
                   resultSwissbase: 'base-1',
                   targetSwissnum: '0',
                   methodName: 'pleaseRespond',
                   args: ['marco'],
                 });
  v2.commsReceived('vat1', got);

  got = q.expect(1, 2,
                 { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1},
                 { op: 'when',
                   targetSwissnum: 'hash-of-base-1',
                 });
  v2.commsReceived('vat1', got);
  q.expectEmpty(1, 2);

  // that immediately provokes an ack

  q.expectAndDeliverAck(2, 1, v1, 0);

  // the pleaseRespond isn't executed until a turn later
  q.expectEmpty(2, 1);
  t.equal(v2root.getCalled(), false);
  await Promise.resolve(0);
  t.equal(v2root.getCalled(), true);

  got = q.expect(2, 1,
                 { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
                 { op: 'resolve',
                   targetSwissnum: 'hash-of-base-1',
                   value: 'marco-polo',
                 });

  q.expectEmpty(1, 2);
  t.equal(v1root.getAnswer(), 'unanswered');

  // deliver the response
  v1.commsReceived('vat2', got);
  // that takes a turn to be processed
  await Promise.resolve(0);

  t.equal(v1root.getAnswer(), 'marco-polo');

  t.end();
});


function t2_sender() {
  exports.default = function(argv) {
    let r1;
    const v1 = new Flow().makeVow(res => r1 = res);
    Vow.resolve(argv.target).e.pleaseWait(v1);
    return {
      fire(arg) { r1(arg); },
    };
  };
}

function t2_responder() {
  exports.default = function(argv) {
    let called = false;
    let answer = 'not yet';
    return {
      pleaseWait(arg) {
        log(`pleaseWait called with ${arg}`);
        called = true;
        Vow.resolve(arg).then(res => {
          log(`resolved`);
          answer = res;
        });
      },
      getCalled() { return called; },
      getAnswer() { return answer; },
    };
  };
}


test('sending unresolved local Vow', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v1src = funcToSource(t2_sender);
  const v1 = await buildVat(s, 'vat1', 'vat1', tr.writeOutput, v1src);
  const v1argv = { target: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t2_responder);
  const v2 = await buildVat(s, 'vat2', 'vat2', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);
  const q = makeQueues(t);
  let got;

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v2.connectionMade('vat1', q.addQueue(2, 1));

  got = q.expect(1, 2,
                 { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
                 { op: 'send',
                   resultSwissbase: 'base-1',
                   targetSwissnum: '0',
                   methodName: 'pleaseWait',
                   args: [{'@qclass': 'vow',
                           vatID: 'vat1',
                           swissnum: 2}],
                 });
  v2.commsReceived('vat1', got);
  got = q.expect(1, 2,
                 { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
                 { op: 'when',
                   targetSwissnum: 'hash-of-base-1',
                 });
  q.expectEmpty(1, 2);
  v2.commsReceived('vat1', got);
  // that immediately provokes an ack

  // deliver the ack, doesn't cause any interesting externally-visible
  // changes, and doesn't provoke any outbound messages
  q.expectAndDeliverAck(2, 1, v1, 0);

  // receiving a Vow causes vat2 to subscribe for a resolution
  got = q.expect(2, 1,
                 { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
                 { op: 'when',
                   targetSwissnum: 2,
                 });
  v1.commsReceived('vat2', got);
  q.expectEmpty(2, 1);
  q.expectEmpty(1, 2);

  // the pleaseRespond isn't executed until a turn later
  t.equal(v2root.getCalled(), false);
  await Promise.resolve(0);
  t.equal(v2root.getCalled(), true);

  got = q.expect(2, 1,
                 { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 1 },
                 { op: 'resolve',
                   targetSwissnum: 'hash-of-base-1',
                   value: {'@qclass': 'undefined' },
                 });
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

  got = q.expect(1, 2,
                 { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 2 },
                 { op: 'resolve',
                   targetSwissnum: 2,
                   value: 'pretty',
                 });
  v2.commsReceived('vat1', got);
  q.expectAndDeliverAck(2, 1, v1, 1);

  t.equal(v2root.getAnswer(), 'not yet');
  await Promise.resolve(0);
  t.equal(v2root.getAnswer(), 'pretty');

  t.end();
});



function t3_one() {
  exports.default = function(argv) {
    const two = Vow.resolve(argv.target2).e.getVow();
    const three = Vow.resolve(argv.target3).e.pleaseWait(two);
  };
}

function t3_two() {
  exports.default = function(argv) {
    let r;
    const vtwo = new Flow().makeVow(res => r = res);
    return {
      getVow(arg) { log('getVow'); return vtwo; },
      fire(arg) { r(arg); },
    };
  };
}

function t3_three() {
  exports.default = function(argv) {
    let fired = false;
    return {
      pleaseWait(vtwo) {
        Vow.resolve(vtwo).then(res => fired = res);
      },
      getFired() { return fired; },
    };
  };
}

test('sending third-party Vow', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v1src = funcToSource(t3_one);
  const v1 = await buildVat(s, 'vat1', 'vat1', tr.writeOutput, v1src);
  const v1argv = { target2: v1.createPresence('vat2/0'),
                   target3: v1.createPresence('vat3/0'),
                 };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t3_two);
  const v2 = await buildVat(s, 'vat2', 'vat2', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v3src = funcToSource(t3_three);
  const v3 = await buildVat(s, 'vat3', 'vat3', tr.writeOutput, v3src);
  const v3argv = {};
  const v3root = await v3.initializeCode('vat3/0', v3argv);
  const q = makeQueues(t);

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v1.connectionMade('vat3', q.addQueue(1, 3));
  v2.connectionMade('vat1', q.addQueue(2, 1));
  v3.connectionMade('vat1', q.addQueue(3, 1));

  const got1 = q.expect(1, 2,
                        { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
                        { op: 'send',
                          resultSwissbase: 'base-1',
                          targetSwissnum: '0',
                          methodName: 'getVow',
                          args: [],
                        });
  const got2 = q.expect(1, 2,
                        { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
                        { op: 'when',
                          targetSwissnum: 'hash-of-base-1',
                        });
  q.expectEmpty(1, 2);

  const got3 = q.expect(1, 3,
                        { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 0 },
                        { op: 'send',
                          resultSwissbase: 'base-2',
                          targetSwissnum: '0',
                          methodName: 'pleaseWait',
                          args: [{ '@qclass': 'vow',
                                   vatID: 'vat1', // owned by vat1
                                   swissnum: 3,
                                 }],
                        });
  const got4 = q.expect(1, 3,
                        { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 1 },
                        { op: 'when',
                          targetSwissnum: 'hash-of-base-2'
                        });
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
  const got5 = q.expect(3, 1,
                        { fromVatID: 'vat3', toVatID: 'vat1', seqnum: 0 },
                        { op: 'when',
                          targetSwissnum: 3,
                        });
  q.expectEmpty(3, 1);
  v1.commsReceived('vat3', got5);
  q.expectEmpty(1, 3);

  v3.commsReceived('vat1', got4); // subscribe to result of pleaseWait()
  q.expectEmpty(3, 1);

  // a turn later, the resut of pleaseWait() resolves (to undefined)
  await Promise.resolve(0);
  const got6 = q.expect(3, 1,
                        { fromVatID: 'vat3', toVatID: 'vat1', seqnum: 1 },
                        { op: 'resolve',
                          targetSwissnum: 'hash-of-base-2',
                          value: {'@qclass': 'undefined' },
                        });
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
  const got7 = q.expect(2, 1,
                        { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
                        { op: 'resolve',
                          targetSwissnum: 'hash-of-base-1',
                          value: 'burns',
                        });

  v1.commsReceived('vat2', got7);

  // and vat1 now tells vat3 about the resolution, after a turn
  q.expectEmpty(1, 3);
  await Promise.resolve(0);
  const got8 = q.expect(1, 3,
                        { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 2 },
                        { op: 'resolve',
                          targetSwissnum: 3,
                          value: 'burns',
                        });
  v3.commsReceived('vat1', got8);

  t.equal(v3root.getFired(), false);
  await Promise.resolve(0);
  t.equal(v3root.getFired(), 'burns');

  t.end();
});




function t4_one() {
  exports.default = function(argv) {
    const two = Vow.resolve(argv.target2).e.getVow();
    const three = Vow.resolve(argv.target3).e.pleaseWait(two);
  };
}

function t4_two() {
  exports.default = function(argv) {
    let r;
    const vtwo = new Flow().makeVow(res => r = res);
    const presence = {};
    return {
      getVow(arg) { log('getVow'); return vtwo; },
      getPresence() { return presence; },
      fire(arg) { r(arg); },
    };
  };
}

function t4_three() {
  exports.default = function(argv) {
    let fired = false;
    return {
      pleaseWait(vtwo) {
        Vow.resolve(vtwo).then(res => fired = res);
      },
      getFired() { return fired; },
    };
  };
}

test('sending third-party Vow that resolves to Presence', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v1src = funcToSource(t4_one);
  const v1 = await buildVat(s, 'vat1', 'vat1', tr.writeOutput, v1src);
  const v1argv = { target2: v1.createPresence('vat2/0'),
                   target3: v1.createPresence('vat3/0'),
                 };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t4_two);
  const v2 = await buildVat(s, 'vat2', 'vat2', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v3src = funcToSource(t4_three);
  const v3 = await buildVat(s, 'vat3', 'vat3', tr.writeOutput, v3src);
  const v3argv = {};
  const v3root = await v3.initializeCode('vat3/0', v3argv);
  const q = makeQueues(t);

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v1.connectionMade('vat3', q.addQueue(1, 3));
  v2.connectionMade('vat1', q.addQueue(2, 1));
  v3.connectionMade('vat1', q.addQueue(3, 1));

  const got1 = q.expect(1, 2,
                        { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0 },
                        { op: 'send',
                          resultSwissbase: 'base-1',
                          targetSwissnum: '0',
                          methodName: 'getVow',
                          args: [],
                 });
  const got2 = q.expect(1, 2,
                        { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1 },
                        { op: 'when',
                          targetSwissnum: 'hash-of-base-1',
                 });
  q.expectEmpty(2, 1);
  const got3 = q.expect(1, 3,
                        { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 0 },
                        { op: 'send',
                          resultSwissbase: 'base-2',
                          targetSwissnum: '0',
                          methodName: 'pleaseWait',
                          args: [{ '@qclass': 'vow',
                                   vatID: 'vat1', // owned by vat1
                                   swissnum: 3,
                                 }],
                        });
  const got4 = q.expect(1, 3,
                        { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 1 },
                        { op: 'when',
                          targetSwissnum: 'hash-of-base-2',
                 });
  q.expectEmpty(3, 1);

  v2.commsReceived('vat1', got1); // getVow()
  v2.commsReceived('vat1', got2);

  // the getVow isn't executed until a turn later, but nothing is sent until
  // v2root.fire() resolves 'vtwo'
  await Promise.resolve(0);
  q.expectEmpty(2, 1);


  v3.commsReceived('vat1', got3); // pleaseWait(two)
  // that makes vat3 want to know when 'two' resolves
  const got5 = q.expect(3, 1,
                        { fromVatID: 'vat3', toVatID: 'vat1', seqnum: 0 },
                        { op: 'when',
                          targetSwissnum: 3,
                        });
  q.expectEmpty(3, 1);

  v3.commsReceived('vat1', got4); // vat1 wants to know when the pleaseWait resolves
  q.expectEmpty(3, 1);
  await Promise.resolve(0);

  const got6 = q.expect(3, 1,
                        { fromVatID: 'vat3', toVatID: 'vat1', seqnum: 1 },
                        { op: 'resolve',
                          targetSwissnum: 'hash-of-base-2',
                          value: {'@qclass': 'undefined' },
                        });

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
  const got7 = q.expect(2, 1,
                        { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
                        { op: 'resolve',
                          targetSwissnum: 'hash-of-base-1',
                          value: {'@qclass': 'presence',
                                  vatID: 'vat2', swissnum: 1 },
                        });

  v1.commsReceived('vat2', got7); // resolves getVow()

  // and vat1 now tells vat3 about the resolution, after a turn
  q.expectEmpty(1, 3);
  await Promise.resolve(0);

  const got8 = q.expect(1, 3,
                        { fromVatID: 'vat1', toVatID: 'vat3', seqnum: 2 },
                        { op: 'resolve',
                          targetSwissnum: 3,
                          value: {'@qclass': 'presence',
                                  vatID: 'vat2', swissnum: 1 },
                        });
  v3.commsReceived('vat1', got8);

  t.equal(v3root.getFired(), false);
  await Promise.resolve(0);
  t.deepEqual(v3root.getFired(), {});

  t.end();
});


// We create a Vow on Alice, who sends it to Bob. Bob sends it to Carol. Test
// that Carol subscribes (directly to Alice) to hear about its resolution.
function t5_alice() {
  exports.default = function(argv) {
    let aliceDone = false;
    const v1 = new Flow().makeVow(_ => null);
    log('alice sends to bob');
    Vow.resolve(argv.bob).e.send1(v1); // got1
    log('alice sent to bob');
  };
}

function t5_bob() {
  exports.default = function(argv) {
    let bobStart = false;
    return {
      send1(v1) { // invoked by got1, then got2 subscribes to hear about v1
        bobStart = true;
        Vow.resolve(argv.carol).e.send2(v1); // got3
        return 'send1 done';
      },
      getBobStart() { return bobStart; },
    };
  };
}

function t5_carol() {
  exports.default = function(argv) {
    let carolDone = false;
    return {
      send2(v1) {
        carolDone = true;
      },
      getCarolDone() { return carolDone; },
    };
  };
}

test('third-party Vow gets resolved', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();

  const ALICE = 'ALICE';
  const alice_src = funcToSource(t5_alice);
  const vatALICE = await buildVat(s, 'vatALICE', 'vatALICE', tr.writeOutput, alice_src);
  const alice_argv = { bob: vatALICE.createPresence('vatBOB/0'),
                     };
  const alice_root = await vatALICE.initializeCode('vatALICE/0', alice_argv);

  const BOB = 'BOB';
  const bob_src = funcToSource(t5_bob);
  const vatBOB = await buildVat(s, 'vatBOB', 'vatBOB', tr.writeOutput, bob_src);
  const bob_argv = { carol: vatBOB.createPresence('vatCAROL/0'),
                   };
  const bob_root = await vatBOB.initializeCode('vatBOB/0', bob_argv);

  const CAROL = 'CAROL';
  const carol_src = funcToSource(t5_carol);
  const vatCAROL = await buildVat(s, 'vatCAROL', 'vatCAROL', tr.writeOutput, carol_src);
  const carol_argv = {};
  const carol_root = await vatCAROL.initializeCode('vatCAROL/0', carol_argv);
  const q = makeQueues(t);//, { [ALICE]: 'alice', [BOB]: 'bob', [CAROL]: 'carol'});

  vatALICE.connectionMade('vatBOB', q.addQueue(ALICE, BOB));
  vatALICE.connectionMade('vatCAROL', q.addQueue(ALICE, CAROL));
  vatBOB.connectionMade('vatALICE', q.addQueue(BOB, ALICE));
  vatBOB.connectionMade('vatCAROL', q.addQueue(BOB, CAROL));
  vatCAROL.connectionMade('vatALICE', q.addQueue(CAROL, ALICE));
  vatCAROL.connectionMade('vatBOB', q.addQueue(CAROL, BOB));

  let got1 = q.expect(ALICE, BOB,
                      { fromVatID: 'vatALICE', toVatID: 'vatBOB', seqnum: 0 },
                      { op: 'send',
                        resultSwissbase: 'base-1',
                        targetSwissnum: '0',
                        methodName: 'send1',
                        args: [ { '@qclass': 'vow',
                                  vatID: 'vatALICE',
                                  swissnum: 2 } ],
                      });
  let got1a = q.expect(ALICE, BOB,
                      { fromVatID: 'vatALICE', toVatID: 'vatBOB', seqnum: 1 },
                      { op: 'when',
                        targetSwissnum: 'hash-of-base-1',
                      });
  q.expectEmpty(ALICE, BOB);

  t.equal(bob_root.getBobStart(), false);
  q.expectEmpty(BOB, ALICE);
  q.expectEmpty(BOB, CAROL);

  vatBOB.commsReceived('vatALICE', got1);
  await Promise.resolve(0);
  t.equal(bob_root.getBobStart(), true);
  let got2 = q.expect(BOB, ALICE,
                      { fromVatID: 'vatBOB', toVatID: 'vatALICE', seqnum: 0 },
                      { op: 'when',
                        targetSwissnum: 2,
                      });
  q.expectEmpty(BOB, ALICE);
  let got3 = q.expect(BOB, CAROL,
                      { fromVatID: 'vatBOB', toVatID: 'vatCAROL', seqnum: 0 },
                      { op: 'send',
                        resultSwissbase: 'base-1',
                        targetSwissnum: '0',
                        methodName: 'send2',
                        args: [ { '@qclass': 'vow',
                                  vatID: 'vatALICE',
                                  swissnum: 2 } ],
                      });
  let got3a = q.expect(BOB, CAROL,
                       { fromVatID: 'vatBOB', toVatID: 'vatCAROL', seqnum: 1 },
                       { op: 'when',
                         targetSwissnum: 'hash-of-base-1',
                       });
  q.expectEmpty(BOB, CAROL);

  // this is what we care about: Carol subscribes directly to Alice (not Bob)
  // for the resolution of 'v1'
  vatCAROL.commsReceived('vatBOB', got3);
  let got4 = q.expect(CAROL, ALICE,
                      { fromVatID: 'vatCAROL', toVatID: 'vatALICE', seqnum: 0 },
                      { op: 'when',
                        targetSwissnum: 2,
                      });
  return t.end();
});
