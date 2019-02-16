import { test } from 'tape-promise/tape';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import SES from 'ses';
import { promisify } from 'util';
import { makeTranscript, funcToSource } from './util';
import { hash58 } from '../src/host';
import { doSwissHashing } from '../src/vat/swissCrypto';

function s1() {
  exports.default = function(argv) {
    let count = 0;

    return {
      increment() {
        count += 1;
        console.log(`count is now ${count}`);
        return count;
      },
      decrement() {
        count -= 1;
        console.log(`count is now ${count}`);
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
        //console.log('in wait');
        return p1;
      },

      fire(arg) {
        //console.log('in fire');
        resolver1(arg);
        //console.log(' ran resolver');
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
  const endow = { writeOutput: tr.writeOutput,
                  comms: { registerManager() {},
                           wantConnection() {} },
                  hash58 };
  const v = await buildVat(s, 'v1', 'v1 secret', 'v1', endow, funcToSource(s2));
  await v.initializeCode('v1/0');

  const opMsg = {op: 'send',
                 targetSwissnum: '0',
                 methodName: 'send',
                 argsS: JSON.stringify([
                   {'@qclass': 'presence',
                    vatID: 'vat2',
                    swissnum: '123'
                   }])};
  await v.doSendOnly(opMsg);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 2);
  let pieces = tr.lines[0].split(' '); // cheap, assumes no spaces in args
  t.equal(pieces[0], 'output:');
  t.equal(pieces[1], 'op');
  let op = JSON.parse(pieces[2]);
  let expected = { fromVatID: 'v1',
                     toVatID: 'vat2',
                     seqnum: 0,
                     opMsg: { op: 'send',
                              targetSwissnum: '123',
                              methodName: 'foo',
                              argsS: JSON.stringify(['arg1', 'arg2']),
                              resultSwissbase: 'b1-Y74TZcuaAYa3B4JwDWbKqM',
                            },
                   };
  t.deepEqual(op, expected);

  pieces = tr.lines[1].split(' '); // cheap, assumes no spaces in args
  t.equal(pieces[0], 'output:');
  t.equal(pieces[1], 'op');
  op = JSON.parse(pieces[2]);
  expected = { fromVatID: 'v1',
               toVatID: 'vat2',
               seqnum: 1,
               opMsg: { op: 'when',
                        targetSwissnum: 'hb1-Y74-T2sLvC4p1vL4cVJoHpwZS',
                      },
             };
  t.deepEqual(op, expected);

  t.end();
});

test('methods can send messages via commsReceived', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const endow = { writeOutput: tr.writeOutput,
                  comms: { registerManager() {},
                           wantConnection() {}  },
                  hash58 };
  const v = await buildVat(s, 'v1', 'v1 secret', 'v1', endow, funcToSource(s2));
  await v.initializeCode('v1/0');

  const opMsg = {op: 'send',
                 targetSwissnum: '0',
                 methodName: 'send',
                 argsS: JSON.stringify([
                   { '@qclass': 'presence',
                     vatID: 'vat2',
                     swissnum: '123'
                   }]) };
  const body = { fromVatID: 'vat2',
                 toVatID: 'v1',
                 seqnum: 0,
                 opMsg };
  const payload = 'op ' + JSON.stringify(body);
  // note: commsReceived's return value doesn't wait for the method to be
  // invoked, it discards that Promise, unlike debugRxMessage
  await v.commsReceived('vat2', payload);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 3);
  t.ok(tr.lines[0].startsWith('input: vat2 op'));
  let pieces = tr.lines[1].split(' '); // cheap
  t.equal(pieces[0], 'output:');
  t.equal(pieces[1], 'op');
  let op = JSON.parse(pieces[2]);
  let expected = { fromVatID: 'v1',
                   toVatID: 'vat2',
                   seqnum: 0,
                   opMsg: {
                     op: 'send',
                     targetSwissnum: '123',
                     methodName: 'foo',
                     argsS: JSON.stringify([
                       'arg1', 'arg2']),
                     resultSwissbase: 'b1-Y74TZcuaAYa3B4JwDWbKqM',
                   }};
  t.deepEqual(op, expected);

  pieces = tr.lines[2].split(' '); // cheap
  t.equal(pieces[0], 'output:');
  t.equal(pieces[1], 'op');
  op = JSON.parse(pieces[2]);
  expected = { fromVatID: 'v1',
               toVatID: 'vat2',
               seqnum: 1,
               opMsg: {
                 op: 'when',
                 targetSwissnum: 'hb1-Y74-T2sLvC4p1vL4cVJoHpwZS',
               }};
  t.deepEqual(op, expected);

  t.end();
});

test('method results are sent back', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const endow = { writeOutput: tr.writeOutput,
                  comms: { registerManager() {},
                           wantConnection() {} },
                  hash58 };
  const v = await buildVat(s, 'v1', 'v1 secret', 'v1', endow, funcToSource(s2));
  await v.initializeCode('v1/0');
  const opMsg = { op: 'send',
                  resultSwissbase: '5',
                  targetSwissnum: '0',
                  methodName: 'returnValue',
                  argsS: JSON.stringify([3]) };
  await v.debugRxMessage('vat2', 0, opMsg);
  const sh = doSwissHashing('5', hash58);
  const whenMsg = { op: 'when',
                    targetSwissnum: sh };
  await v.debugRxMessage('vat2', 1, whenMsg);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 1);
  const pieces = tr.lines[0].split(' '); // cheap
  t.equal(pieces[0], 'output:');
  t.equal(pieces[1], 'op');
  const op = JSON.parse(pieces[2]);
  const expected = { fromVatID: 'v1',
                     toVatID: 'vat2',
                     seqnum: 0,
                     opMsg: {
                       op: 'resolve',
                       targetSwissnum: sh,
                       valueS: JSON.stringify(3),
                     }};
  t.deepEqual(op, expected);
  t.end();
});

test('methods can return a promise', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const endow = { writeOutput: tr.writeOutput,
                  comms: { registerManager() {},
                           wantConnection() {} },
                  hash58 };
  const v = await buildVat(s, 'v1', 'v1 secret', 'v1', endow, funcToSource(s2));
  await v.initializeCode('v1/0');

  let result = false;
  const op1 = { op: 'send',
                targetSwissnum: '0',
                methodName: 'wait',
                argsS: JSON.stringify([]) };
  const p = v.doSendOnly(op1);
  p.then((res) => {
    result = res;
  });

  t.equal(result, false);
  const op2 = { op: 'send',
                targetSwissnum: '0',
                methodName: 'fire',
                argsS: JSON.stringify([10]) };
  v.doSendOnly(op2);
  await promisify(setImmediate)();
  t.equal(result, 10);
  t.end();
});
