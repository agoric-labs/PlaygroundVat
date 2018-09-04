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
                 { type: 'op', seqnum: 0, targetVatID: 'vat2'},
                 { op: 'send',
                   resultSwissbase: 'base-1',
                   targetSwissnum: '0',
                   methodName: 'pleaseRespond',
                   args: ['marco'],
                 });
  v2.commsReceived('vat1', got);

  // that immediately provokes an ack

  q.expectAndDeliverAck(2, 1, v1, 0);

  // the pleaseRespond isn't executed until a turn later
  q.expectEmpty(2, 1);
  t.equal(v2root.getCalled(), false);
  await Promise.resolve(0);
  t.equal(v2root.getCalled(), true);

  got = q.expect(2, 1,
                 { type: 'op', seqnum: 0, targetVatID: 'vat1' },
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
                 { type: 'op', seqnum: 0, targetVatID: 'vat2' },
                 { op: 'send',
                   resultSwissbase: 'base-1',
                   targetSwissnum: '0',
                   methodName: 'pleaseWait',
                   args: [{'@qclass': 'unresolvedVow',
                           vatID: 'vat1',
                           swissnum: 2}],
                 });
  q.expectEmpty(1, 2);
  v2.commsReceived('vat1', got);
  // that immediately provokes an ack

  // deliver the ack, doesn't cause any interesting externally-visible
  // changes, and doesn't provoke any outbound messages
  q.expectAndDeliverAck(2, 1, v1, 0);
  q.expectEmpty(2, 1);
  q.expectEmpty(1, 2);

  // the pleaseRespond isn't executed until a turn later
  t.equal(v2root.getCalled(), false);
  await Promise.resolve(0);
  t.equal(v2root.getCalled(), true);

  got = q.expect(2, 1,
                 { type: 'op', seqnum: 0, targetVatID: 'vat1' },
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
                 { type: 'op', seqnum: 1, targetVatID: 'vat2' },
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

  let got;

  got = q.expect(1, 2,
                 { type: 'op', seqnum: 0, targetVatID: 'vat2' },
                 { op: 'send',
                   resultSwissbase: 'base-1',
                   targetSwissnum: '0',
                   methodName: 'getVow',
                   args: [],
                 });
  v2.commsReceived('vat1', got);

  // that immediately provokes an ack

  q.expectAndDeliverAck(2, 1, v1, 0);

  // the getVow isn't executed until a turn later
  await Promise.resolve(0);

  // because getVow() returned an unresolved Vow, no opResolve is sent yet:
  // nothing is sent until it is resolved by v2root.fire()
  q.expectEmpty(2, 1);

  // we don't currently forward unresolved vows to their most-likely target,
  // so when we send 'two' to three.pleaseWait, we send a vat1 vow, not the
  // original vat2 vow
  got = q.expect(1, 3,
                 { type: 'op', seqnum: 0, targetVatID: 'vat3' },
                 { op: 'send',
                   resultSwissbase: 'base-2',
                   targetSwissnum: '0',
                   methodName: 'pleaseWait',
                   args: [{ '@qclass': 'unresolvedVow',
                            vatID: 'vat1', // owned by vat1
                            swissnum: 3,
                          }],
                 });
  q.expectEmpty(3, 1);
  v3.commsReceived('vat1', got);

  // that returns an immediate ack, and a turn later we send a (for
  // 'undefined') of the answer to pleaseWait()

  q.expectAndDeliverAck(3, 1, v1, 0);
  q.expectEmpty(3, 1);
  await Promise.resolve(0);
  got = q.expect(3, 1,
                 { type: 'op', seqnum: 0, targetVatID: 'vat1' },
                 { op: 'resolve',
                   targetSwissnum: 'hash-of-base-2',
                   value: {'@qclass': 'undefined' },
                 });
  q.expectEmpty(3, 1);

  v1.commsReceived('vat3', got);

  q.expectAndDeliverAck(1, 3, v3, 0);

  t.equal(v3root.getFired(), false);
  // ok, now we tell vat2 to resolve the Vow, and we expect vat3 to
  // eventually be notified
  console.log('FIRE IN THE HOLE');
  v2root.fire('burns');

  // nothing happens for a turn
  q.expectEmpty(2, 1);
  await Promise.resolve(0);

  // first, vat2 should tell vat1 about the resolution
  got = q.expect(2, 1,
                 { type: 'op', seqnum: 0, targetVatID: 'vat1' },
                 { op: 'resolve',
                   targetSwissnum: 'hash-of-base-1',
                   value: 'burns',
                 });

  v1.commsReceived('vat2', got);
  q.expectAndDeliverAck(1, 2, v2, 0);

  // and vat1 now tells vat3 about the resolution, after a turn
  q.expectEmpty(1, 3);
  await Promise.resolve(0);
  got = q.expect(1, 3,
                 { type: 'op', seqnum: 1, targetVatID: 'vat3' },
                 { op: 'resolve',
                   targetSwissnum: 3,
                   value: 'burns',
                 });
  v3.commsReceived('vat1', got);

  t.equal(v3root.getFired(), false);
  await Promise.resolve(0);
  t.equal(v3root.getFired(), 'burns');

  q.expectAndDeliverAck(3, 1, v1, 1);

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

  let got;

  got = q.expect(1, 2,
                 { type: 'op', seqnum: 0, targetVatID: 'vat2' },
                 { op: 'send',
                   resultSwissbase: 'base-1',
                   targetSwissnum: '0',
                   methodName: 'getVow',
                   args: [],
                 });
  v2.commsReceived('vat1', got);

  // that immediately provokes an ack

  q.expectAndDeliverAck(2, 1, v1, 0);

  // the getVow isn't executed until a turn later
  await Promise.resolve(0);

  // because getVow() returned an unresolved Vow, no opResolve is sent yet:
  // nothing is sent until it is resolved by v2root.fire()
  q.expectEmpty(2, 1);

  // we don't currently forward unresolved vows to their most-likely target,
  // so when we send 'two' to three.pleaseWait, we send a vat1 vow, not the
  // original vat2 vow
  got = q.expect(1, 3,
                 { type: 'op', seqnum: 0, targetVatID: 'vat3' },
                 { op: 'send',
                   resultSwissbase: 'base-2',
                   targetSwissnum: '0',
                   methodName: 'pleaseWait',
                   args: [{ '@qclass': 'unresolvedVow',
                            vatID: 'vat1', // owned by vat1
                            swissnum: 3,
                          }],
                 });
  q.expectEmpty(3, 1);
  v3.commsReceived('vat1', got);

  // that returns an immediate ack, and a turn later we send a (for
  // 'undefined') of the answer to pleaseWait()

  q.expectAndDeliverAck(3, 1, v1, 0);
  q.expectEmpty(3, 1);
  await Promise.resolve(0);
  got = q.expect(3, 1,
                 { type: 'op', seqnum: 0, targetVatID: 'vat1' },
                 { op: 'resolve',
                   targetSwissnum: 'hash-of-base-2',
                   value: {'@qclass': 'undefined' },
                 });
  q.expectEmpty(3, 1);

  v1.commsReceived('vat3', got);

  q.expectAndDeliverAck(1, 3, v3, 0);

  t.equal(v3root.getFired(), false);
  // ok, now we tell vat2 to resolve the Vow, and we expect vat3 to
  // eventually be notified
  console.log('FIRE IN THE HOLE');
  v2root.fire(v2root.getPresence());

  // nothing happens for a turn
  q.expectEmpty(2, 1);
  await Promise.resolve(0);

  // first, vat2 should tell vat1 about the resolution
  got = q.expect(2, 1,
                 { type: 'op', seqnum: 0, targetVatID: 'vat1' },
                 { op: 'resolve',
                   targetSwissnum: 'hash-of-base-1',
                   value: {'@qclass': 'presence',
                           vatID: 'vat2', swissnum: 1 },
                 });

  v1.commsReceived('vat2', got);
  q.expectAndDeliverAck(1, 2, v2, 0);

  // and vat1 now tells vat3 about the resolution, after a turn
  q.expectEmpty(1, 3);
  await Promise.resolve(0);
  got = q.expect(1, 3,
                 { type: 'op', seqnum: 1, targetVatID: 'vat3' },
                 { op: 'resolve',
                   targetSwissnum: 3,
                   value: {'@qclass': 'presence',
                           vatID: 'vat2', swissnum: 1 },
                 });
  v3.commsReceived('vat1', got);

  t.equal(v3root.getFired(), false);
  await Promise.resolve(0);
  t.deepEqual(v3root.getFired(), {});

  q.expectAndDeliverAck(3, 1, v1, 1);

  t.end();
});


function t5_driver() {
  exports.default = function(argv) {
    const two_mint = Vow.resolve(argv.mint).e.makeMint();
    const three_purse = two_mint.e.getPurse();
    const aliceP = Vow.resolve(argv.alice);
    aliceP.e.init(three_purse);
    aliceP.e.payBobWell();
  };
}

function t5_mint() {
  exports.default = function(argv) {
    let depositComplete = false;
    const purse = {
      getIssuer() {
        return issuer;
      },
    };
    const emptyPurse = {
      deposit(value, srcP) {
        log('mint deposit started');
        Vow.resolve(srcP).then(src => { // THIS IS NOT RESOLVING
          // src === purse
          log('mint deposit complete');
          depositComplete = true;
        });
        return 'did deposit';
      },
    };
    const issuer = {
      makeEmptyPurse() { return emptyPurse; },
    };
    const mint = {
      getPurse() { return purse; },
    };
    return {
      makeMint() { return mint; },
      getDepositComplete() { return depositComplete; },
    };
  };
}

function t5_alice() {
  exports.default = function(argv) {
    let purseP, issuerP;
    log(`t5_alice argv.mint`, argv.mint);
    const mintP = Vow.resolve(argv.mint);
    log('mintP', mintP);
    let depositComplete = false;
    return {
      init(purse) {
        purseP = Vow.resolve(purse);
        issuerP = purseP.e.getIssuer();
        log('did init');
        return 'did init';
      },
      payBobWell() {
        log('payBobWell', mintP, purseP);
        const paymentP = issuerP.e.makeEmptyPurse();
        log('did mintP.e.makeEmptyPurse');
        paymentP.e.deposit(10, purseP)
          .then(_ => {
            log('alice deposit complete');
            depositComplete = true;
          });
        return 'did payBobWell';
      },
      getDepositComplete() { return depositComplete; },
    };
  };
}

test('breaking something sending third-party Vow back home', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();

  const DRIVER = 'DRIVER';
  const v1src = funcToSource(t5_driver);
  const vatDRIVER = await buildVat(s, 'vatDRIVER', 'vatDRIVER', tr.writeOutput, v1src);
  const v1argv = { mint: vatDRIVER.createPresence('vatMINT/0'),
                   alice: vatDRIVER.createPresence('vatALICE/0'),
                 };
  const v1root = await vatDRIVER.initializeCode('vatDRIVER/0', v1argv);

  const MINT = 'MINT';
  const v2src = funcToSource(t5_mint);
  const vatMINT = await buildVat(s, 'vatMINT', 'vatMINT', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await vatMINT.initializeCode('vatMINT/0', v2argv);

  const ALICE = 'ALICE';
  const v3src = funcToSource(t5_alice);
  const vatALICE = await buildVat(s, 'vatALICE', 'vatALICE', tr.writeOutput, v3src);
  const v3argv = { mint: vatALICE.createPresence('vatMINT/0'),
                 };
  const v3root = await vatALICE.initializeCode('vatALICE/0', v3argv);
  const q = makeQueues(t);//, { [DRIVER]: 'driver', [MINT]: 'mint', [ALICE]: 'alice'});

  vatDRIVER.connectionMade('vatMINT', q.addQueue(DRIVER, MINT));
  vatDRIVER.connectionMade('vatALICE', q.addQueue(DRIVER, ALICE));
  vatMINT.connectionMade('vatDRIVER', q.addQueue(MINT, DRIVER));
  vatMINT.connectionMade('vatALICE', q.addQueue(MINT, ALICE));
  vatALICE.connectionMade('vatDRIVER', q.addQueue(ALICE, DRIVER));
  vatALICE.connectionMade('vatMINT', q.addQueue(ALICE, MINT));

  console.log('initial messages');
  q.dump();

  let got1 = q.expect(DRIVER, MINT,
                      { type: 'op', seqnum: 0, targetVatID: 'vatMINT' },
                      { op: 'send',
                        resultSwissbase: 'base-1',
                        targetSwissnum: '0',
                        methodName: 'makeMint',
                        args: [],
                      });

  let got2 = q.expect(DRIVER, MINT,
                      { type: 'op', seqnum: 1, targetVatID: 'vatMINT' },
                      { op: 'send',
                        resultSwissbase: 'base-2',
                        targetSwissnum: 'hash-of-base-1',
                        methodName: 'getPurse',
                        args: [],
                      });

  let got3 = q.expect(DRIVER, ALICE,
                      { type: 'op', seqnum: 0, targetVatID: 'vatALICE' },
                      { op: 'send',
                        resultSwissbase: 'base-3',
                        targetSwissnum: '0',
                        methodName: 'init',
                        args: [ { '@qclass': 'unresolvedVow',
                                  vatID: 'vatDRIVER',
                                  swissnum: 4,
                                } ],
                      });

  let got4 = q.expect(DRIVER, ALICE,
                      { type: 'op', seqnum: 1, targetVatID: 'vatALICE' },
                      { op: 'send',
                        resultSwissbase: 'base-5',
                        targetSwissnum: '0',
                        methodName: 'payBobWell',
                        args: [],
                      });
  q.expectEmpty(MINT, ALICE);
  q.expectEmpty(MINT, DRIVER);
  q.expectEmpty(ALICE, DRIVER);
  q.expectEmpty(ALICE, MINT);

  // leave the mint hanging for a while: suspend messages to it

  // then driver delivers init/payBobWell to Alice
  vatALICE.commsReceived('vatDRIVER', got3);
  q.expectAndDeliverAck(ALICE, DRIVER, vatDRIVER, 0);
  await Promise.resolve(0);

  // the getIssuer is sent to the driver, as that's where the purse provided
  // to init() came from. The driver is expected to forward this getIssuer to
  // the mint once it resolves.
  let got5 = q.expect(ALICE, DRIVER,
                      { type: 'op', seqnum: 0, targetVatID: 'vatDRIVER' },
                      { op: 'send',
                        resultSwissbase: 'base-1',
                        targetSwissnum: 4,
                        methodName: 'getIssuer',
                        args: [],
                      });
  let got6 = q.expect(ALICE, DRIVER,
                      { type: 'op', seqnum: 1, targetVatID: 'vatDRIVER' },
                      { op: 'resolve',
                        targetSwissnum: 'hash-of-base-3',
                        value: 'did init',
                      });
  vatDRIVER.commsReceived('vatALICE', got5);
  q.expectAndDeliverAck(DRIVER, ALICE, vatALICE, 0);
  await Promise.resolve(0);
  q.expectEmpty(DRIVER, ALICE);
  q.expectEmpty(DRIVER, MINT);

  vatDRIVER.commsReceived('vatALICE', got6);
  q.expectAndDeliverAck(DRIVER, ALICE, vatALICE, 1);
  await Promise.resolve(0);
  q.expectEmpty(DRIVER, ALICE);
  q.expectEmpty(DRIVER, MINT);

  // now deliver the payBobWell message
  vatALICE.commsReceived('vatDRIVER', got4);
  q.expectAndDeliverAck(ALICE, DRIVER, vatDRIVER, 1);
  await Promise.resolve(0);

  // this causes alice to send makeEmptyPurse and deposit. She sends these
  // both to vatDRIVER because that's all she knows about so far
  let got7 = q.expect(ALICE, DRIVER,
                      { type: 'op', seqnum: 2, targetVatID: 'vatDRIVER' },
                      { op: 'send',
                        resultSwissbase: 'base-2',
                        targetSwissnum: 'hash-of-base-1',
                        methodName: 'makeEmptyPurse',
                        args: [],
                      });
  // todo: let the driver resolve the mint messages before this point, to
  // check that forwarded messages which arrive after resolution are
  // correctly forwarded onwards
  let got8 = q.expect(ALICE, DRIVER,
                      { type: 'op', seqnum: 3, targetVatID: 'vatDRIVER' },
                      { op: 'send',
                        resultSwissbase: 'base-3',
                        targetSwissnum: 'hash-of-base-2',
                        methodName: 'deposit',
                        args: [10, { '@qclass': 'unresolvedVow',
                                     vatID: 'vatDRIVER',
                                     swissnum: 4 } ],
                      });
  let got9 = q.expect(ALICE, DRIVER,
                      { type: 'op', seqnum: 4, targetVatID: 'vatDRIVER' },
                      { op: 'resolve',
                        targetSwissnum: 'hash-of-base-5',
                        value: 'did payBobWell',
                      });
  vatDRIVER.commsReceived('vatALICE', got7);
  q.expectAndDeliverAck(DRIVER, ALICE, vatALICE, 2);
  vatDRIVER.commsReceived('vatALICE', got8);
  q.expectAndDeliverAck(DRIVER, ALICE, vatALICE, 3);
  vatDRIVER.commsReceived('vatALICE', got9);
  q.expectAndDeliverAck(DRIVER, ALICE, vatALICE, 4);

  // pending messages: got1, got2

  vatMINT.commsReceived('vatDRIVER', got1);
  q.expectAndDeliverAck(MINT, DRIVER, vatDRIVER, 0);
  q.expectEmpty(MINT, DRIVER);

  await Promise.resolve(0);

  let got10 = q.expect(MINT, DRIVER,
                      { type: 'op', seqnum: 0, targetVatID: 'vatDRIVER' },
                       { op: 'resolve',
                         targetSwissnum: 'hash-of-base-1',
                         value: { '@qclass': 'presence',
                                  vatID: 'vatMINT',
                                  swissnum: 1 }
                       });
  q.expectEmpty(MINT, DRIVER);
  q.expectEmpty(DRIVER, MINT);

  // pending messages: got2, got10

  vatDRIVER.commsReceived('vatMINT', got10); // resolves two_mint=mint.makeMint
  q.expectAndDeliverAck(DRIVER, MINT, vatMINT, 0);
  q.expectEmpty(MINT, DRIVER);
  q.expectEmpty(DRIVER, MINT);
  q.expectEmpty(DRIVER, ALICE);

  await Promise.resolve(0);

  // pending messages: got2

  vatMINT.commsReceived('vatDRIVER', got2); // two_mint.getPurse
  q.expectAndDeliverAck(MINT, DRIVER, vatDRIVER, 1);
  q.expectEmpty(MINT, DRIVER);

  await Promise.resolve(0);

  let got11 = q.expect(MINT, DRIVER,
                      { type: 'op', seqnum: 1, targetVatID: 'vatDRIVER' },
                       { op: 'resolve',
                         targetSwissnum: 'hash-of-base-2',
                         value: { '@qclass': 'presence',
                                  vatID: 'vatMINT',
                                  swissnum: 2 }
                       });

  // at this point, DRIVER wants to send ALICE a resolution for 'three_purse'
  // (sent to init() earlier). And DRIVER has forwarded messages (getIssuer,
  // makeEmptyPurse, and deposit) from ALICE that should be sent to MINT.

  // pending messages: got11
  vatDRIVER.commsReceived('vatMINT', got11); // resolves three_purse=two_mint.getPurse
  // this causes vatDRIVER to send resolutions to Alice for the various
  // promises that we sent earlier. Those resolutions point at presences on
  // vatMINT

  q.expectEmpty(DRIVER, ALICE);
  await Promise.resolve(0);

  let got12 = q.expect(DRIVER, ALICE,
                      { type: 'op', seqnum: 2, targetVatID: 'vatALICE' },
                       { op: 'resolve',
                         targetSwissnum: 4,
                         value: { '@qclass': 'presence',
                                  vatID: 'vatMINT',
                                  swissnum: 2 } // purseP=three_purse
                       });

  q.expectEmpty(DRIVER, ALICE);
  q.expectEmpty(MINT, DRIVER);

  let got13 = q.expect(DRIVER, MINT,
                      { type: 'op', seqnum: 2, targetVatID: 'vatMINT' },
                       { op: 'send',
                        resultSwissbase: 'base-6',
                        targetSwissnum: 2,
                        methodName: 'getIssuer',
                        args: [],
                      });
  q.expectAndDeliverAck(DRIVER, MINT, vatMINT, 1);

  // pending: got12, got13. vatDRIVER has makeEmptyPurse and deposit pending
  vatALICE.commsReceived('vatDRIVER', got12); // purseP=three_purse
  // alice doesn't actually care: she sent three_purse to deposit() and then
  // forgot about it
  q.expectAndDeliverAck(ALICE, DRIVER, vatDRIVER, 2);
  q.expectEmpty(ALICE, DRIVER);

  // pending: got13
  vatMINT.commsReceived('vatDRIVER', got13); // forwarded getIssuer
  q.expectAndDeliverAck(MINT, DRIVER, vatDRIVER, 2);

  await Promise.resolve(0);

  let got14 = q.expect(MINT, DRIVER,
                      { type: 'op', seqnum: 2, targetVatID: 'vatDRIVER' },
                       { op: 'resolve',
                         targetSwissnum: 'hash-of-base-6',
                         value: { '@qclass': 'presence',
                                  vatID: 'vatMINT',
                                  swissnum: 3 } // issuer
                       });
  vatDRIVER.commsReceived('vatMINT', got14);

  await Promise.resolve(0);

  // now that 'issuer' has resolved, vatDRIVER needs to tell Alice (who will
  // ignore it)
  let got15 = q.expect(DRIVER, ALICE,
                      { type: 'op', seqnum: 3, targetVatID: 'vatALICE' },
                       { op: 'resolve',
                         targetSwissnum: 'hash-of-base-1',
                         value: { '@qclass': 'presence',
                                  vatID: 'vatMINT',
                                  swissnum: 3 } // issuer
                       });
  // vatDRIVER also delivers the forwarded issuer.makeEmptyPurse
  let got16 = q.expect(DRIVER, MINT,
                      { type: 'op', seqnum: 3, targetVatID: 'vatMINT' },
                       { op: 'send',
                        resultSwissbase: 'base-7',
                        targetSwissnum: 3,
                        methodName: 'makeEmptyPurse',
                        args: [],
                      });
  q.expectAndDeliverAck(DRIVER, MINT, vatMINT, 2);

  // pending : got15, got16
  vatALICE.commsReceived('vatDRIVER', got15);
  q.expectAndDeliverAck(ALICE, DRIVER, vatDRIVER, 3);

  await Promise.resolve(0);
  q.expectEmpty(ALICE, DRIVER);
  q.expectEmpty(DRIVER, ALICE);

  vatMINT.commsReceived('vatDRIVER', got16); // forwarded makeEmptyPurse
  q.expectAndDeliverAck(MINT, DRIVER, vatDRIVER, 3);

  await Promise.resolve(0);

  let got17 = q.expect(MINT, DRIVER,
                      { type: 'op', seqnum: 3, targetVatID: 'vatDRIVER' },
                       { op: 'resolve',
                         targetSwissnum: 'hash-of-base-7',
                         value: { '@qclass': 'presence',
                                  vatID: 'vatMINT',
                                  swissnum: 4 } // emptyPurse
                       });

  vatDRIVER.commsReceived('vatMINT', got17); // resolved emptyPurse
  // now vatDRIVER can forward the deposit() to vatMINT, resolve the
  // purseP/three_purse argument to vatMINT, and also sends emptyPurse to
  // alice
  await Promise.resolve(0);

  let got18 = q.expect(DRIVER, MINT,
                      { type: 'op', seqnum: 4, targetVatID: 'vatMINT' },
                       { op: 'send',
                        resultSwissbase: 'base-8',
                        targetSwissnum: 4,
                        methodName: 'deposit',
                        args: [10,  { '@qclass': 'unresolvedVow',
                                     vatID: 'vatDRIVER',
                                     swissnum: 4 } ],
                      });
  q.expectAndDeliverAck(DRIVER, MINT, vatMINT, 3);

  // got19 is the same resolution as got12, but to MINT instead of ALICE
  let got19 = q.expect(DRIVER, MINT,
                      { type: 'op', seqnum: 5, targetVatID: 'vatMINT' },
                       { op: 'resolve',
                         targetSwissnum: 4,
                         value: { '@qclass': 'presence',
                                  vatID: 'vatMINT',
                                  swissnum: 2 } // purseP/three_purse
                       });

  // got20 is the same resolution as got17, but DRIVER->ALICE instead of
  // MINT->DRIVER
  let got20 = q.expect(DRIVER, ALICE,
                      { type: 'op', seqnum: 4, targetVatID: 'vatALICE' },
                       { op: 'resolve',
                         targetSwissnum: 'hash-of-base-2',
                         value: { '@qclass': 'presence',
                                  vatID: 'vatMINT',
                                  swissnum: 4 } // paymentP/emptyPurse
                       });

  // pending: got18, got19, got20

  vatMINT.commsReceived('vatDRIVER', got18); // deposit()
  q.expectAndDeliverAck(MINT, DRIVER, vatDRIVER, 4);

  await Promise.resolve(0);

  let got21 = q.expect(MINT, DRIVER,
                      { type: 'op', seqnum: 4, targetVatID: 'vatDRIVER' },
                       { op: 'resolve',
                         targetSwissnum: 'hash-of-base-8',
                         value: 'did deposit',
                       });

  // pending: got19, got20, got21

  t.equal(v2root.getDepositComplete(), false);

  // this allows the MINT's deposit() to finish
  vatMINT.commsReceived('vatDRIVER', got19);
  q.expectAndDeliverAck(MINT, DRIVER, vatDRIVER, 5);

  t.equal(v2root.getDepositComplete(), false);
  await Promise.resolve(0);
  t.equal(v2root.getDepositComplete(), true);

  // pending: got20, got21

  // tell alice that paymentP/emptyPurse has resolved, although she doesn't
  // care
  vatALICE.commsReceived('vatDRIVER', got20);
  q.expectAndDeliverAck(ALICE, DRIVER, vatDRIVER, 4);

  // let the MINT tell DRIVER that deposit has finished. This will prompt
  // DRIVER to forward the resolution to Alice

  vatDRIVER.commsReceived('vatMINT', got21);
  q.expectAndDeliverAck(DRIVER, MINT, vatMINT, 4);

  await Promise.resolve(0);

  let got22 = q.expect(DRIVER, ALICE,
                      { type: 'op', seqnum: 5, targetVatID: 'vatALICE' },
                       { op: 'resolve',
                         targetSwissnum: 'hash-of-base-3',
                         value: 'did deposit',
                       });

  // finally tell alice that the deposit has finished
  t.equal(v3root.getDepositComplete(), false);
  vatALICE.commsReceived('vatDRIVER', got22);
  q.expectAndDeliverAck(ALICE, DRIVER, vatDRIVER, 5);

  await Promise.resolve(0);

  t.equal(v3root.getDepositComplete(), true);

  // now everything is finally quiescent

  //await Promise.resolve(0);
  //q.dump();
  //return t.end();

  t.end();
});
