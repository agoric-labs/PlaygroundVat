import { test } from 'tape-promise/tape';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import SES from 'ses';
import { promisify } from 'util';

function s1() {
  let count = 0;

  exports.increment = () => {
    count += 1;
    log(`count is now ${count}`);
    return count;
  };

  exports.decrement = () => {
    count -= 1;
    log(`count is now ${count}`);
    return count;
  };
}

function s2() {
  let resolver1;

  //log('i am here');
  const f = new Flow();
  const p1 = f.makeVow((resolve, reject) => resolver1 = resolve);
  //log('i got here');

  exports.returnValue = (value) => {
    return value;
  };

  exports.send = (target) => {
    Vow.resolve(target).e.foo('arg1', 'arg2');
  };

  exports.wait = () => {
    //log('in wait');
    return p1;
  };

  exports.fire = (arg) => {
    //log('in fire');
    resolver1(arg);
    //log(' ran resolver');
  };
}

function funcToSource(f) {
  let code = `${f}`;
  code = code.replace(/^function .* {/, '');
  code = code.replace(/}$/, '');
  return code;
}

test('confineVatSource', (t) => {
  const s = SES.makeSESRootRealm();
  const s1code = funcToSource(s1);
  //console.log(`source: ${s1code}`);
  const e = confineVatSource(s, `${s1code}`);
  t.equal(e.increment(), 1);
  t.equal(e.increment(), 2);
  t.equal(e.decrement(), 1);
  t.end();
});

function makeTranscript() {
  const lines = [];
  const waiters = [];

  return {
    writeOutput(line) {
      lines.push(line);
      const w = waiters.shift();
      if (w) {
        w(line);
      }
    },

    lines,

    wait() {
      return new Promise(r => waiters.push(r));
    },
  };
}

test('methods can send messages via doSendOnly', async (t) => { // todo remove
  const tr = makeTranscript();
  const s = makeRealm();
  const v = await buildVat(s, 'v1', tr.writeOutput, funcToSource(s2));

  const bodyJson = JSON.stringify({op: 'send',
                                   targetSwissnum: 0,
                                   methodName: 'send',
                                   args: [{'@qclass': 'presence',
                                           vatID: 'vat2',
                                           swissnum: 123
                                          }]});
  await v.doSendOnly(bodyJson);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 1);
  const pieces = tr.lines[0].split(' '); // cheap
  t.equal(pieces[0], 'msg:');
  t.equal(pieces[1], 'v1->vat2');
  const args = JSON.parse(pieces[2]);
  t.equal(args.op, 'send');
  t.equal(args.targetSwissnum, 123);
  t.equal(args.methodName, 'foo');
  t.deepEqual(args.args, ['arg1', 'arg2']);
  t.equal(args.resultSwissbase, 'base-1'); // todo: this will become random

  t.end();
});

test('methods can send messages via commsReceived', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v = await buildVat(s, 'v1', tr.writeOutput, funcToSource(s2));

  const bodyJson = JSON.stringify({op: 'send',
                                   targetSwissnum: 0,
                                   methodName: 'send',
                                   args: [{'@qclass': 'presence',
                                           vatID: 'vat2',
                                           swissnum: 123
                                          }]});
  await v.commsReceived('vat2', bodyJson);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 2);
  const pieces = tr.lines[1].split(' '); // cheap
  t.equal(pieces[0], 'msg:');
  t.equal(pieces[1], 'v1->vat2');
  const args = JSON.parse(pieces[2]);
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

  const bodyJson = JSON.stringify({op: 'send',
                                   resultSwissbase: '5',
                                   targetSwissnum: 0,
                                   methodName: 'returnValue',
                                   args: [3]});
  await v.commsReceived('vat2', bodyJson);
  console.log(`transcript is ${tr.lines}`);
  t.equal(tr.lines.length, 2);
  const pieces = tr.lines[1].split(' '); // cheap
  t.equal(pieces[0], 'msg:');
  t.equal(pieces[1], 'v1->vat2');
  const args = JSON.parse(pieces[2]);
  t.equal(args.op, 'resolve');
  t.equal(args.targetSwissnum, 'hash-of-5');
  t.deepEqual(args.value, 3);

  t.end();
});

test('methods can return a promise', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v = await buildVat(s, 'v1', tr.writeOutput, funcToSource(s2));

  let result = false;
  const op1 = {op: 'send',
               targetSwissnum: 0,
               methodName: 'wait',
               args: []};
  const p = v.doSendOnly(JSON.stringify(op1));
  p.then((res) => {
    result = res;
  });

  t.equal(result, false);
  const op2 = {op: 'send',
               targetSwissnum: 0,
               methodName: 'fire',
               args: [10]};
  v.doSendOnly(JSON.stringify(op2));
  await promisify(setImmediate)();
  t.equal(result, 10);
  t.end();
});
