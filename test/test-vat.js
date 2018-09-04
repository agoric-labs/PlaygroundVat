import { test } from 'tape-promise/tape';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import SES from 'ses';
import { promisify } from 'util';
import { makeTranscript, funcToSource } from './util';

function s1() {
  exports.default = function(argv) {
    let count = 0;

    return {
      increment() {
        count += 1;
        log(`count is now ${count}`);
        return count;
      },
      decrement() {
        count -= 1;
        log(`count is now ${count}`);
        return count;
      },
    };
  };
}

function s2() {
  exports.default = function(argv) {
    let resolver1;

    //log('i am here');
    const f = new Flow();
    const p1 = f.makeVow((resolve, reject) => resolver1 = resolve);
    //log('i got here');

    return {
      returnValue(value) {
        return value;
      },

      send(target) {
        Vow.resolve(target).e.foo('arg1', 'arg2');
      },

      wait() {
        //log('in wait');
        return p1;
      },

      fire(arg) {
        //log('in fire');
        resolver1(arg);
        //log(' ran resolver');
      },
    };
  };
}

test('confineVatSource', (t) => {
  const s = SES.makeSESRootRealm();
  const s1code = funcToSource(s1);
  //console.log(`source: ${s1code}`);
  const e = confineVatSource(s, `${s1code}`).default();
  t.equal(e.increment(), 1);
  t.equal(e.increment(), 2);
  t.equal(e.decrement(), 1);
  t.end();
});

test('methods can send messages via doSendOnly', async (t) => { // todo remove
  const tr = makeTranscript();
  const s = makeRealm();
  const v = await buildVat(s, 'v1', tr.writeOutput, funcToSource(s2));
  await v.initializeCode('v1/0');

  const opMsg = {op: 'send',
                 targetSwissnum: '0',
                 methodName: 'send',
                 argsS: JSON.stringify([
                   {'@qclass': 'presence',
                    vatID: 'vat2',
                    swissnum: 123
                   }])};
  await v.doSendOnly(opMsg);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 1);
  const pieces = tr.lines[0].split(' '); // cheap
  t.equal(pieces[0], 'output:');
  t.equal(pieces[1], 'op');
  const argsPayload = JSON.parse(pieces[2]);
  t.equal(argsPayload.fromVatID, 'v1');
  t.equal(argsPayload.toVatID, 'vat2');
  t.equal(argsPayload.seqnum, 0);
  t.equal(argsPayload.opMsg.op, 'send');
  t.equal(argsPayload.opMsg.targetSwissnum, 123);
  t.equal(argsPayload.opMsg.methodName, 'foo');
  t.equal(argsPayload.opMsg.resultSwissbase, 'base-1'); // todo: this will become random
  const args = JSON.parse(argsPayload.opMsg.argsS);
  t.deepEqual(args, ['arg1', 'arg2']);

  t.end();
});

test('methods can send messages via commsReceived', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v = await buildVat(s, 'v1', tr.writeOutput, funcToSource(s2));
  await v.initializeCode('v1/0');

  const opMsg = {op: 'send',
                 targetSwissnum: '0',
                 methodName: 'send',
                 args: JSON.stringify([
                   {'@qclass': 'presence',
                    vatID: 'vat2',
                    swissnum: 123
                   }])};
  const body = { fromVatID: 'vat2',
                 toVatID: 'v1',
                 seqnum: 0,
                 opMsg };
  const payload = JSON.stringify(body);
  // note: commsReceived's return value doesn't wait for the method to be
  // invoked, it discards that Promise, unlike debugRxMessage
  await v.commsReceived('vat2', payload);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 2);
  const pieces = tr.lines[1].split(' '); // cheap
  t.equal(pieces[0], 'msg:');
  t.equal(pieces[1], 'v1->vat2[0]');
  const argsPayload = JSON.parse(pieces[2]);
  t.equal(argsPayload.type, 'op');
  t.equal(argsPayload.seqnum, 0);
  t.equal(argsPayload.targetVatID, 'vat2');
  const args = JSON.parse(argsPayload.msg);
  t.equal(args.op, 'send');
  t.equal(args.targetSwissnum, 123);
  t.equal(args.methodName, 'foo');
  t.deepEqual(args.args, ['arg1', 'arg2']);
  t.equal(args.resultSwissbase, 'base-1'); // todo: this will become random

  t.end();
});

test('method results are sent back', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v = await buildVat(s, 'v1', tr.writeOutput, funcToSource(s2));
  await v.initializeCode('v1/0');
  const body = {op: 'send',
                resultSwissbase: '5',
                targetSwissnum: '0',
                methodName: 'returnValue',
                args: [3]};
  const bodyJson = JSON.stringify(body);
  const payload = JSON.stringify({type: 'op',
                                  seqnum: 0,
                                  msg: bodyJson});
  await v.debugRxMessage('vat2', 0, bodyJson);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 2);
  const pieces = tr.lines[1].split(' '); // cheap
  t.equal(pieces[0], 'msg:');
  t.equal(pieces[1], 'v1->vat2[0]');
  const argsPayload = JSON.parse(pieces[2]);
  t.equal(argsPayload.type, 'op');
  t.equal(argsPayload.seqnum, 0);
  t.equal(argsPayload.targetVatID, 'vat2');
  const args = JSON.parse(argsPayload.msg);
  t.equal(args.op, 'resolve');
  t.equal(args.targetSwissnum, 'hash-of-5');
  t.deepEqual(args.value, 3);

  t.end();
});

test('methods can return a promise', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v = await buildVat(s, 'v1', tr.writeOutput, funcToSource(s2));
  await v.initializeCode('v1/0');

  let result = false;
  const op1 = {op: 'send',
               targetSwissnum: '0',
               methodName: 'wait',
               args: []};
  const p = v.doSendOnly(JSON.stringify(op1));
  p.then((res) => {
    result = res;
  });

  t.equal(result, false);
  const op2 = {op: 'send',
               targetSwissnum: '0',
               methodName: 'fire',
               args: [10]};
  v.doSendOnly(JSON.stringify(op2));
  await promisify(setImmediate)();
  t.equal(result, 10);
  t.end();
});
