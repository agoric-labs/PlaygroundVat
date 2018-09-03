import { test } from 'tape-promise/tape';
import { parseVatID, makeRemoteForVatID } from '../src/vat/remotes';

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

  const r2 = parseVatID('q2-vat1-vat2-vat3');
  t.equal(r2.threshold, 2);
  t.equal(r2.leader, 'vat1');
  t.equal(r2.members.size, 3);
  t.ok(r1.members.has('vat1'));
  t.notOk(r1.members.has('vat4'));
  t.deepEqual(Array.from(r2.members.values()).sort(), ['vat1', 'vat2', 'vat3']);

  t.throws(_ => parseVatID('m2-err-what'), /unknown VatID type: m2-err-what/);

  t.end();
});


function logConflict(text, componentID, seqNum, msgID, msg) {
}


test('vatRemote seqnum', (t) => {
  const r = makeRemoteForVatID('vat1', shallowDef, console.log, logConflict);
  t.equal(r.nextOutboundSeqnum(), 0);
  t.equal(r.nextOutboundSeqnum(), 1);
  t.equal(r.getReadyMessage(), undefined);
  t.end();
});

function makeMsg(vat, seqnum, target='etc') {
  return { fromVatID: vat,
           toVatID: 'vat1',
           seqnum,
           msg: { op: 'send',
                  target },
         };
}

test('vatRemote inbound solo', (t) => {
  // I am vat1, upstream is vat2. Deliver messages from an upstream solo vat,
  // out of order, and examine how getReadyMessage() makes them available for
  // delivery.
  const r = makeRemoteForVatID('vat2', shallowDef, console.log, logConflict);

  function got(hostMessage, host) {
    const msgID = JSON.stringify(hostMessage);
    return r.gotHostMessage(host, msgID, hostMessage);
  }

  const hm0 = makeMsg('vat2', 0);
  const hm1 = makeMsg('vat2', 1);
  const hm2 = makeMsg('vat2', 2);
  const hm3 = makeMsg('vat2', 3);

  const res0 = got(hm0, 'vat2');
  t.ok(res0);
  t.deepEqual(res0, hm0);
  t.equal(r.getReadyMessage(), undefined);

  // 2 and 3 are queued until 1 is delivered
  const res2 = got(hm2, 'vat2');
  t.equal(res2, undefined);
  t.equal(r.getReadyMessage(), undefined);
  const res3 = got(hm3, 'vat2');
  t.equal(res3, undefined);
  t.equal(r.getReadyMessage(), undefined);

  const res1 = got(hm1, 'vat2');
  t.deepEqual(res1, hm1);
  t.equal(r.getReadyMessage(), hm2);
  t.equal(r.getReadyMessage(), hm3);
  t.equal(r.getReadyMessage(), undefined);

  t.end();
});

test('vatRemote inbound quorum', (t) => {
  // I am vat1, upstream is q2-vat2a-vat2b-vat2c
  const fromVatID = 'q2-vat2a-vat2b-vat2c';
  const r = makeRemoteForVatID(fromVatID, shallowDef, console.log, logConflict);
  function got(hostMessage, host, msgID=null) {
    msgID = msgID || JSON.stringify(hostMessage);
    return r.gotHostMessage(host, msgID, hostMessage);
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
  t.equal(r.getReadyMessage(), hm2);
  t.equal(r.getReadyMessage(), hm3);
  t.equal(r.getReadyMessage(), undefined);

  // upstream disagreement is ok as long as the threshold is reached
  const hm4x = makeMsg(fromVatID, 4, 'x');
  const hm4y = makeMsg(fromVatID, 4, 'y');
  t.equal(got(hm4x, 'vat2a'), undefined);
  t.equal(got(hm4y, 'vat2b'), undefined);
  t.deepEqual(got(hm4x, 'vat2c'), hm4x);
  t.equal(r.getReadyMessage(), undefined);

  // we currently let upstream components equivocate, and accept the first
  // variant that achieves the threshold
  const hm5x = makeMsg(fromVatID, 5, 'x');
  const hm5y = makeMsg(fromVatID, 5, 'y');
  const hm5z = makeMsg(fromVatID, 5, 'z');
  t.equal(got(hm5x, 'vat2a'), undefined);
  t.equal(got(hm5y, 'vat2b'), undefined);
  t.equal(got(hm5z, 'vat2c'), undefined);
  t.deepEqual(got(hm5x, 'vat2c'), hm5x);
  t.equal(r.getReadyMessage(), undefined);

  t.end();
});
