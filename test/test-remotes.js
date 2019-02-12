import { test } from 'tape-promise/tape';
import { makeRemoteForVatID, makeDecisionList,
         makeRemoteManager } from '../src/vat/remotes';
import { parseVatID } from '../src/vat/id';
import { vatMessageIDHash } from '../src/vat/swissCrypto';
import { hash58 } from '../src/host';

function shallowDef(obj) {
  return Object.freeze(obj);
}


test('parseVatID', (t) => {
  const r1 = parseVatID('vat1');
  t.equal(r1.threshold, 1);
  t.equal(r1.leader, 'vat1');
  t.equal(r1.members.size, 1);
  t.ok(r1.members.has('vat1'));
  t.notOk(r1.members.has('vat2'));
  t.deepEqual(Array.from(r1.members.values()).sort(), ['vat1']);
  t.deepEqual(r1.followers, []);

  const r2 = parseVatID('q2-vat1-vat2-vat3');
  t.equal(r2.threshold, 2);
  t.equal(r2.leader, 'vat1');
  t.equal(r2.members.size, 3);
  t.ok(r2.members.has('vat1'));
  t.notOk(r2.members.has('vat4'));
  t.deepEqual(Array.from(r2.members.values()).sort(), ['vat1', 'vat2', 'vat3']);
  t.deepEqual(r2.followers, ['vat2', 'vat3']);

  t.throws(_ => parseVatID('m2-err-what'), /unknown VatID type: m2-err-what/);

  t.end();
});


function logConflict(text, componentID, seqNum, msgID, msg, seqMap) {
  throw new Error('logConflict');
}


test('vatRemote seqnum', (t) => {
  const r = makeRemoteForVatID('vat1', shallowDef, logConflict);
  t.equal(r.nextOutboundSeqnum(), 0);
  t.equal(r.nextOutboundSeqnum(), 1);
  t.equal(r.getReadyMessage(), undefined);
  t.end();
});

function makeMsg(vat, seqnum, target='etc', toVatID='vat1') {
  const hostMessage = { fromVatID: vat,
                        toVatID,
                        seqnum,
                        msg: { op: 'send',
                               target },
                      };
  const wireMessage = `op ${JSON.stringify(hostMessage)}`;
  const id = vatMessageIDHash(JSON.stringify(hostMessage), hash58);
  return { hostMessage, wireMessage, id };
}

test('vatRemote inbound solo', (t) => {
  // I am vat1, upstream is vat2. Deliver messages from an upstream solo vat,
  // out of order, and examine how getReadyMessage() makes them available for
  // delivery.
  const r = makeRemoteForVatID('vat2', shallowDef, logConflict);

  function got(hm, host) {
    return r.gotHostMessage({ fromHostID: host }, hm.id,
                            { hostMessage: hm.hostMessage,
                              wireMessage: hm.wireMessage });
  }

  const hm0 = makeMsg('vat2', 0);
  const hm1 = makeMsg('vat2', 1);
  const hm2 = makeMsg('vat2', 2);
  const hm3 = makeMsg('vat2', 3);

  const res0 = got(hm0, 'vat2');
  t.ok(res0);
  t.deepEqual(res0, hm0);
  t.deepEqual(r.getReadyMessage(), hm0);
  r.consumeReadyMessage();
  t.deepEqual(r.getReadyMessage(), undefined);

  // 2 and 3 are queued until 1 is delivered
  const res2 = got(hm2, 'vat2');
  t.equal(res2, undefined);
  t.equal(r.getReadyMessage(), undefined);
  const res3 = got(hm3, 'vat2');
  t.equal(res3, undefined);
  t.equal(r.getReadyMessage(), undefined);

  const res1 = got(hm1, 'vat2');
  t.deepEqual(res1, hm1);
  t.deepEqual(r.getReadyMessage(), hm1);
  r.consumeReadyMessage();
  t.deepEqual(r.getReadyMessage(), hm2);
  r.consumeReadyMessage();
  t.deepEqual(r.getReadyMessage(), hm3);
  r.consumeReadyMessage();

  t.equal(r.getReadyMessage(), undefined);

  // duplicate delivery should be tolerated and ignored
  got(hm3, 'vat2');
  t.equal(r.getReadyMessage(), undefined);

  t.end();
});

test('vatRemote inbound quorum', (t) => {
  // I am vat1, upstream is q2-vat2a-vat2b-vat2c
  const fromVatID = 'q2-vat2a-vat2b-vat2c';
  const conflicts = [];
  function logConflict(...args) {
    conflicts.push(args);
  }
  const r = makeRemoteForVatID(fromVatID, shallowDef, logConflict);
  function got(hm, host, msgID=null) {
    msgID = msgID || hm.id;
    return r.gotHostMessage({ fromHostID: host }, msgID,
                            { hostMessage: hm.hostMessage,
                              wireMessage: hm.wireMessage });
  }
  let res;

  const hm0 = makeMsg(fromVatID, 0);
  const hm1 = makeMsg(fromVatID, 1);
  const hm2 = makeMsg(fromVatID, 2);
  const hm3 = makeMsg(fromVatID, 3);

  // non-members should be ignored. For now this logs and NOPs, but todo it
  // should raise some sort of exception that causes the connection to be
  // dropped or something, but doesn't break the rest of our vat.

  res = got(hm0, 'vat5');
  t.equal(res, undefined);

  // build up seqnum0, one component at a time, and only the last component
  // will trigger a delivery
  res = got(hm0, 'vat2a');
  t.equal(res, undefined);
  res = got(hm0, 'vat2a'); // redelivering the same component is ignored
  t.equal(res, undefined);

  res = got(hm0, 'vat2b'); // threshold is 2, so this is sufficient
  t.ok(res);
  t.deepEqual(res, hm0);
  t.deepEqual(res, r.getReadyMessage());
  r.consumeReadyMessage();
  t.equal(r.getReadyMessage(), undefined);

  // delivering additional components doesn't trigger duplicate deliveries
  res = got(hm0, 'vat2c');
  t.equal(res, undefined);
  t.equal(r.getReadyMessage(), undefined);

  // 2 and 3 are queued until 1 is delivered
  t.equal(got(hm2, 'vat2a'), undefined);
  t.equal(got(hm2, 'vat2b'), undefined);
  t.equal(got(hm2, 'vat2c'), undefined);
  t.equal(got(hm3, 'vat2a'), undefined);
  t.equal(got(hm3, 'vat2b'), undefined);
  t.equal(got(hm3, 'vat2c'), undefined);
  t.equal(r.getReadyMessage(), undefined);

  t.equal(got(hm1, 'vat2c'), undefined);
  t.deepEqual(got(hm1, 'vat2b'), hm1);
  t.deepEqual(r.getReadyMessage(), hm1);
  r.consumeReadyMessage();
  t.deepEqual(r.getReadyMessage(), hm2);
  r.consumeReadyMessage();
  t.deepEqual(r.getReadyMessage(), hm3);
  r.consumeReadyMessage();
  t.equal(r.getReadyMessage(), undefined);

  // upstream disagreement is ok as long as the threshold is reached
  const hm4x = makeMsg(fromVatID, 4, 'x');
  const hm4y = makeMsg(fromVatID, 4, 'y');
  t.equal(got(hm4x, 'vat2a'), undefined);
  t.equal(got(hm4y, 'vat2b'), undefined);
  t.equal(conflicts.length, 1);
  t.deepEqual(got(hm4x, 'vat2c'), hm4x);
  t.deepEqual(r.getReadyMessage(), hm4x);
  r.consumeReadyMessage();
  t.equal(r.getReadyMessage(), undefined);

  // we currently let upstream components equivocate, and accept the first
  // variant that achieves the threshold
  const hm5x = makeMsg(fromVatID, 5, 'x');
  const hm5y = makeMsg(fromVatID, 5, 'y');
  const hm5z = makeMsg(fromVatID, 5, 'z');
  t.equal(conflicts.length, 1);
  t.equal(got(hm5x, 'vat2a'), undefined);
  t.equal(got(hm5y, 'vat2b'), undefined);
  t.equal(conflicts.length, 2);
  t.equal(got(hm5z, 'vat2c'), undefined);
  t.equal(conflicts.length, 3);
  t.deepEqual(got(hm5x, 'vat2c'), hm5x);
  t.equal(conflicts.length, 3);
  t.deepEqual(r.getReadyMessage(), hm5x);
  r.consumeReadyMessage();
  t.equal(r.getReadyMessage(), undefined);

  t.end();
});

test('decisionList solo', (t) => {
  const remotes = new Map();
  const hm20 = makeMsg('vat2', 0);
  const hm30 = makeMsg('vat3', 0);
  let ready = [];
  let consumed = [];
  const deliveries = [];
  const deliver = (fromVatID, msg) => deliveries.push({ fromVatID, msg });
  const decisionMessages = [];
  const sendDecisionTo = (toHostID, msg) =>
        decisionMessages.push({ toHostID, msg });

  const dl = makeDecisionList('q2-vat1a-vat1b-vat1c', true, [],
                              () => ready, deliver, sendDecisionTo);
  t.equal(dl.debug_getNextDeliverySeqnum(), 0);

  ready.push([ 'vat2', hm20, () => consumed.push(20) ]);
  dl.addMessage(hm20);
  //console.log(dl.debug_getDecisionList());
  t.deepEqual(deliveries, [ { fromVatID: 'vat2', msg: hm20.hostMessage } ]);
  t.deepEqual(consumed, [20]);

  deliveries.splice(0);
  consumed.splice(0);

  ready.push(['vat3', hm30, () => consumed.push(30) ]);
  dl.addMessage(hm30);
  t.deepEqual(deliveries, [ { fromVatID: 'vat3', msg: hm30.hostMessage } ]);
  t.deepEqual(consumed, [30]);

  t.deepEqual(decisionMessages, []);

  t.end();

});

test('decisionList follower', (t) => {
  const remotes = new Map();
  let ready = [];
  let consumed = [];
  function getReadyMessages() {
    return ready;
  }

  const deliveries = [];
  const deliver = (fromVatID, msg) => deliveries.push({ fromVatID, msg });
  const decisionMessages = [];
  const sendDecisionTo = (toHostID, msg) =>
        decisionMessages.push({ toHostID, msg });

  const dl = makeDecisionList('q2-vat1a-vat1b-vat1c', false,
                              ['vat1b', 'vat1c'],
                              getReadyMessages, deliver, sendDecisionTo);
  t.equal(dl.debug_getNextDeliverySeqnum(), 0);
  const hm20 = makeMsg('vat2', 0, 'etc', 'q2-vat1a-vat1b-vat1c');
  const hm30 = makeMsg('vat3', 0, 'etc', 'q2-vat1a-vat1b-vat1c');
  const hm21 = makeMsg('vat2', 1, 'etc', 'q2-vat1a-vat1b-vat1c');
  const hm31 = makeMsg('vat3', 1, 'etc', 'q2-vat1a-vat1b-vat1c');

  // message before decision

  ready.push([ 'vat2', hm20, () => consumed.push(20) ]);
  dl.addMessage(hm20);
  t.deepEqual(deliveries, []);
  t.deepEqual(consumed, []);

  dl.addDecision({ toVatID: 'q2-vat1a-vat1b-vat1c', decisionSeqnum: 0, vatMessageID: hm20.id});
  t.deepEqual(deliveries, [ { fromVatID: 'vat2', msg: hm20.hostMessage } ]);
  t.deepEqual(consumed, [20]);

  deliveries.splice(0);
  consumed.splice(0);

  // decision before message

  dl.addDecision({ toVatID: 'q2-vat1a-vat1b-vat1c', decisionSeqnum: 1, vatMessageID: hm30.id});
  t.deepEqual(deliveries, []);
  t.deepEqual(consumed, []);

  ready.push([ 'vat3', hm30, () => consumed.push(30) ]);
  dl.addMessage(hm30);
  t.deepEqual(deliveries, [ { fromVatID: 'vat3', msg: hm30.hostMessage } ]);
  t.deepEqual(consumed, [30]);

  deliveries.splice(0);
  consumed.splice(0);

  // duplicate decision does nothing

  dl.addDecision({ toVatID: 'q2-vat1a-vat1b-vat1c', decisionSeqnum: 1, vatMessageID: hm30.id});
  t.deepEqual(deliveries, []);
  t.deepEqual(consumed, []);

  // out-of-order decisions: last causes multiple deliveries
  ready.push([ 'vat2', hm21, () => consumed.push(21) ]);
  dl.addMessage(hm21);
  ready.push([ 'vat3', hm31, () => consumed.push(31) ]);
  dl.addMessage(hm31);
  t.deepEqual(deliveries, []);
  t.deepEqual(consumed, []);

  dl.addDecision({ toVatID: 'q2-vat1a-vat1b-vat1c', decisionSeqnum: 3, vatMessageID: hm31.id});
  t.deepEqual(deliveries, []);
  t.deepEqual(consumed, []);

  dl.addDecision({ toVatID: 'q2-vat1a-vat1b-vat1c', decisionSeqnum: 2, vatMessageID: hm21.id});
  t.deepEqual(deliveries, [ { fromVatID: 'vat2', msg: hm21.hostMessage },
                            { fromVatID: 'vat3', msg: hm31.hostMessage } ]);
  t.deepEqual(consumed, [21, 31]);

  t.deepEqual(decisionMessages, []);

  t.end();

});

test('decisionList leader', (t) => {
  const remotes = new Map();
  let ready = [];
  let consumed = [];
  function getReadyMessages() {
    return ready;
  }

  const deliveries = [];
  const deliver = (fromVatID, msg) => deliveries.push({ fromVatID, msg });
  const decisionMessages = [];
  const sendDecisionTo = (toHostID, msg) =>
        decisionMessages.push({ toHostID, msg });

  const dl = makeDecisionList('q2-vat1a-vat1b-vat1c', true,
                              ['vat1b', 'vat1c'],
                              getReadyMessages, deliver, sendDecisionTo);
  t.equal(dl.debug_getNextDeliverySeqnum(), 0);
  const hm20 = makeMsg('vat2', 0, 'etc', 'q2-vat1a-vat1b-vat1c');

  ready.push([ 'vat2', hm20, () => consumed.push(20) ]);
  dl.addMessage(hm20);
  t.deepEqual(deliveries, [ { fromVatID: 'vat2', msg: hm20.hostMessage } ]);
  t.deepEqual(consumed, [20]);

  t.deepEqual(decisionMessages, [
    { toHostID: 'vat1b',
      msg: { toVatID: 'q2-vat1a-vat1b-vat1c',
             decisionSeqnum: 0,
             vatMessageID: hm20.id,
             debug_fromVatID: 'vat2',
             debug_vatSeqnum: 0 } },
    { toHostID: 'vat1c',
      msg: { toVatID: 'q2-vat1a-vat1b-vat1c',
             decisionSeqnum: 0,
             vatMessageID: hm20.id,
             debug_fromVatID: 'vat2',
             debug_vatSeqnum: 0 } },
  ]);

  t.end();

});

test('connections', (t) => {
  function managerWriteInput(fromVatID, wireMessage) {
  }
  function managerWriteOutput(msg) {
  }
  function logConflict(issue, componentID, seqNum, msgID, msg, seqMap) {
  }
  function def(o) {
    return Object.freeze(o);
  }
  const wanted = [];
  const comms = {
    wantConnection(hostID) { wanted.push(hostID); },
  };

  const rm = makeRemoteManager('vat1', 'vat1', comms,
                               managerWriteInput, managerWriteOutput,
                               def, logConflict, hash58);
  const fakeEngine = {};
  rm.setEngine(fakeEngine);
  rm.sendTo('vat2', {op: 'whatever'});
  t.deepEqual(wanted, [ 'vat2' ]);
  const messages = [];
  const c = {
    send(body) {
      messages.push(body);
    },
  };
  rm.connectionMade('vat2', c);
  t.equal(messages.length, 1);
  t.ok(messages[0].startsWith('op '));
  const m = JSON.parse(messages[0].slice('op '.length));
  t.deepEqual(m, { fromVatID: 'vat1',
                   toVatID: 'vat2',
                   seqnum: 0,
                   opMsg: { op: 'whatever' },
                 });
  rm.connectionLost('vat2');

  // each new connection should re-send all messages, until we get acks
  rm.connectionMade('vat2', c);
  t.equal(messages.length, 2);

  t.end();
});
