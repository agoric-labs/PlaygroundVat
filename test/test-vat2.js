import { test } from 'tape-promise/tape';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import { makeTranscript, funcToSource } from './util';

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
  const v1 = await buildVat(s, 'vat1', tr.writeOutput, v1src);
  const v1argv = { target: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t1_responder);
  const v2 = await buildVat(s, 'vat2', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v1_to_v2 = [];
  const c12 = {
    send(msg) { //console.log('SEND12', msg);
                v1_to_v2.push(msg);
              },
  };
  v1.connectionMade('vat2', c12);

  t.equal(v1_to_v2.length, 1);
  t.deepEqual(JSON.parse(v1_to_v2[0]),
              { seqnum: 0, op: 'send',
                resultSwissbase: 'base-1',
                targetSwissnum: '0',
                methodName: 'pleaseRespond',
                args: ['marco'],
              });

  v2.commsReceived('vat1', v1_to_v2[0]);

  const v2_to_v1 = [];
  const c21 = {
    send(msg) { //console.log('SEND21', msg);
                v2_to_v1.push(msg);
              },
  };
  v2.connectionMade('vat1', c21);
  // that immediately provokes an ack

  t.equal(v2_to_v1.length, 1);
  t.deepEqual(JSON.parse(v2_to_v1[0]),
              { ackSeqnum: 0, op: 'ack',
              });

  // the pleaseRespond isn't executed until a turn later
  t.equal(v2root.getCalled(), false);
  await Promise.resolve(0);
  t.equal(v2root.getCalled(), true);

  t.equal(v2_to_v1.length, 2);
  t.deepEqual(JSON.parse(v2_to_v1[1]),
              { seqnum: 0, op: 'resolve',
                targetSwissnum: 'hash-of-base-1',
                value: 'marco-polo',
              });

  // deliver the ack, doesn't cause any interesting externally-visible
  // changes, and doesn't provoke any outbound messages
  v1.commsReceived('vat2', v2_to_v1[0]);
  t.equal(v1_to_v2.length, 1);

  t.equal(v1root.getAnswer(), 'unanswered');

  // deliver the response
  v1.commsReceived('vat2', v2_to_v1[1]);
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
  const v1 = await buildVat(s, 'vat1', tr.writeOutput, v1src);
  const v1argv = { target: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t2_responder);
  const v2 = await buildVat(s, 'vat2', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v1_to_v2 = [];
  const c12 = {
    send(msg) { console.log('SEND12', msg);
                v1_to_v2.push(msg);
              },
  };
  v1.connectionMade('vat2', c12);

  t.equal(v1_to_v2.length, 1);
  t.deepEqual(JSON.parse(v1_to_v2[0]),
              { seqnum: 0, op: 'send',
                resultSwissbase: 'base-1',
                targetSwissnum: '0',
                methodName: 'pleaseWait',
                args: [{'@qclass': 'unresolvedVow',
                        vatID: 'vat1',
                        swissnum: 2}],
              });

  v2.commsReceived('vat1', v1_to_v2[0]);

  const v2_to_v1 = [];
  const c21 = {
    send(msg) { console.log('SEND21', msg);
                v2_to_v1.push(msg);
              },
  };
  v2.connectionMade('vat1', c21);
  // that immediately provokes an ack

  t.equal(v2_to_v1.length, 1);
  t.deepEqual(JSON.parse(v2_to_v1[0]),
              { ackSeqnum: 0, op: 'ack',
              });

  // the pleaseRespond isn't executed until a turn later
  t.equal(v2root.getCalled(), false);
  await Promise.resolve(0);
  t.equal(v2root.getCalled(), true);

  t.equal(v2_to_v1.length, 2);
  t.deepEqual(JSON.parse(v2_to_v1[1]),
              { seqnum: 0, op: 'resolve',
                targetSwissnum: 'hash-of-base-1',
                value: {'@qclass': 'undefined' },
              });

  // deliver the ack, doesn't cause any interesting externally-visible
  // changes, and doesn't provoke any outbound messages
  v1.commsReceived('vat2', v2_to_v1[0]);
  t.equal(v1_to_v2.length, 1);

  t.equal(v2root.getAnswer(), 'not yet');

  // pleaseWait() returned 'undefined', so now the caller's Vow gets resolved
  // (although nobody cares)
  v1.commsReceived('vat2', v2_to_v1[1]);
  // that takes a turn to be processed
  await Promise.resolve(0);
  t.equal(v2root.getAnswer(), 'not yet');

  // that sends another ack
  t.equal(v1_to_v2.length, 2);
  t.deepEqual(JSON.parse(v1_to_v2[1]),
              { ackSeqnum: 0, op: 'ack',
              });
  v2.commsReceived('vat1', v2_to_v1[1]);

  // now tell the sender to resolve the Vow they sent to the responder
  v1root.fire('pretty');
  t.equal(v1_to_v2.length, 2);

  await Promise.resolve(0);

  t.equal(v1_to_v2.length, 3);
  t.deepEqual(JSON.parse(v1_to_v2[2]),
              { seqnum: 1, op: 'resolve',
                targetSwissnum: 2,
                value: 'pretty',
              });

  v2.commsReceived('vat1', v1_to_v2[2]);
  t.equal(v2_to_v1.length, 3);
  t.deepEqual(JSON.parse(v2_to_v1[2]),
              { ackSeqnum: 1, op: 'ack',
              });

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

test.only('sending third-party Vow', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v1src = funcToSource(t3_one);
  const v1 = await buildVat(s, 'vat1', tr.writeOutput, v1src);
  const v1argv = { target2: v1.createPresence('vat2/0'),
                   target3: v1.createPresence('vat3/0'),
                 };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(t3_two);
  const v2 = await buildVat(s, 'vat2', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v3src = funcToSource(t3_three);
  const v3 = await buildVat(s, 'vat3', tr.writeOutput, v3src);
  const v3argv = {};
  const v3root = await v3.initializeCode('vat3/0', v3argv);

  const v1_to_v2 = [];
  const c12 = {
    send(msg) { console.log('SEND12', msg);
                v1_to_v2.push(msg);
              },
  };
  v1.connectionMade('vat2', c12);

  t.equal(v1_to_v2.length, 1);
  t.deepEqual(JSON.parse(v1_to_v2[0]),
              { seqnum: 0, op: 'send',
                resultSwissbase: 'base-1',
                targetSwissnum: '0',
                methodName: 'getVow',
                args: [],
              });

  v2.commsReceived('vat1', v1_to_v2[0]);

  const v2_to_v1 = [];
  const c21 = {
    send(msg) { console.log('SEND21', msg);
                v2_to_v1.push(msg);
              },
  };
  v2.connectionMade('vat1', c21);
  // that immediately provokes an ack

  t.equal(v2_to_v1.length, 1);
  t.deepEqual(JSON.parse(v2_to_v1[0]),
              { ackSeqnum: 0, op: 'ack',
              });

  // the getVow isn't executed until a turn later
  await Promise.resolve(0);

  // because getVow() returned an unresolved Vow, no opResolve is sent yet:
  // nothing is sent until it is resolved by v2root.fire()
  t.equal(v2_to_v1.length, 1);

  // now allow the messages to three to be delivered
  const v1_to_v3 = [];
  const c13 = {
    send(msg) { console.log('SEND13', msg);
                v1_to_v3.push(msg);
              },
  };
  v1.connectionMade('vat3', c13);

  // we don't currently forward unresolved vows to their most-likely target,
  // so when we send 'two' to three.pleaseWait, we send a vat1 vow, not the
  // original vat2 vow
  t.equal(v1_to_v3.length, 1);
  t.deepEqual(JSON.parse(v1_to_v3[0]),
              { seqnum: 0, op: 'send',
                resultSwissbase: 'base-2',
                targetSwissnum: '0',
                methodName: 'pleaseWait',
                args: [{ '@qclass': 'unresolvedVow',
                         vatID: 'vat1', // owned by vat1
                         swissnum: 3,
                       }],
              });


  const v3_to_v1 = [];
  const c31 = {
    send(msg) { console.log('SEND31', msg);
                v3_to_v1.push(msg);
              },
  };
  v3.connectionMade('vat1', c31);
  t.equal(v3_to_v1.length, 0);

  v3.commsReceived('vat1', v1_to_v3[0]);

  // that returns an immediate ack, and a turn later we send a (for
  // 'undefined') of the answer to pleaseWait()

  t.equal(v3_to_v1.length, 1);
  t.deepEqual(JSON.parse(v3_to_v1[0]),
              { ackSeqnum: 0, op: 'ack',
              });
  await Promise.resolve(0);
  t.equal(v3_to_v1.length, 2);
  t.deepEqual(JSON.parse(v3_to_v1[1]),
              { seqnum: 0, op: 'resolve',
                targetSwissnum: 'hash-of-base-2',
                value: {'@qclass': 'undefined' },
              });

  v1.commsReceived('vat3', v3_to_v1[0]);
  v1.commsReceived('vat3', v3_to_v1[1]);

  t.equal(v1_to_v3.length, 2);
  t.deepEqual(JSON.parse(v1_to_v3[1]),
              { ackSeqnum: 0, op: 'ack',
              });

  t.equal(v3root.getFired(), false);
  // ok, now we tell vat2 to resolve the Vow, and we expect vat3 to
  // eventually be notified
  console.log('FIRE IN THE HOLE');
  v2root.fire('burns');

  // nothing happens for a turn
  t.equal(v2_to_v1.length, 1);
  await Promise.resolve(0);

  // first, vat2 should tell vat1 about the resolution
  t.equal(v2_to_v1.length, 2);
  t.deepEqual(JSON.parse(v2_to_v1[1]),
              { seqnum: 0, op: 'resolve',
                targetSwissnum: 'hash-of-base-1',
                value: 'burns',
              });

  v1.commsReceived('vat2', v2_to_v1[1]);
  t.equal(v1_to_v2.length, 2);
  t.deepEqual(JSON.parse(v1_to_v2[1]),
              { ackSeqnum: 0, op: 'ack',
              });
  v2.commsReceived('vat1', v1_to_v2[1]);

  // and vat1 now tells vat3 about the resolution, after a turn
  t.equal(v1_to_v3.length, 2);
  await Promise.resolve(0);
  t.equal(v1_to_v3.length, 3);
  t.deepEqual(JSON.parse(v1_to_v3[2]),
              { seqnum: 1, op: 'resolve',
                targetSwissnum: 3,
                value: 'burns',
              });
  v3.commsReceived('vat1', v1_to_v3[2]);

  t.equal(v3root.getFired(), false);
  await Promise.resolve(0);
  t.equal(v3root.getFired(), 'burns');

  t.equal(v3_to_v1.length, 3);
  t.deepEqual(JSON.parse(v3_to_v1[2]),
              { ackSeqnum: 1, op: 'ack',
              });

  t.end();
});
