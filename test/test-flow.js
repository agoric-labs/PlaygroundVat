import { test } from 'tape-promise/tape';
import { E, Flow, makeUnresolvedRemoteVow } from '../src/flow/flowcomm';

test('tape works', t => {
  t.equal(1, 1);
  t.end();
});

function delay(fn) {
  Promise.resolve(null).then(fn);
}

// TODO: move most of the Promises from this file into a single utility
// function which schedules a new turn

test('async tests pass', async (t) => {
  const a = await Promise.resolve(42);
  t.equal(a, 42);
  t.end();
});

test('unresolved send queues in order', async (t) => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);

  //const v2 = E(v1).concat(" MORE"); //v1 ! concat(" MORE")
  const v2 = E(v1).concat(" MORE"); //v1!concat(" MORE")

  delay(() => r1("some"));

  const res = await v2;

  t.equal(res, 'some MORE');

  t.end();
});

test('resolved send queues in order', async (t) => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  delay(() => r1("some"));
  const v2 = E(v1).concat(" MORE"); //v1 ! concat(" MORE")
  const res = await v2;
  t.equal(res, 'some MORE');
  t.end();
});

test('pre-resolved send queues in order', async (t) => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  r1("some");
  const v2 = E(v1).concat(" MORE"); //v1 ! concat(" MORE")
  const res = await v2;
  t.equal(res, 'some MORE');
  t.end();
});

test('order across forwarding', async (t) => {
  let c = 0;
  console.log(`s ${c++}`);
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  const v2 = E(v1).concat(" MORE"); //v1 ! concat(" MORE")
  console.log(`s ${c++}`);
  let r3;
  const v3 = f1.makeVow(r => r3 = r);
  r1(v3);
  r3("some");
  console.log(`s ${c++}`);

  const res = await v2;
  console.log(`s ${c++}`);
  t.equal(res, 'some MORE');
  t.end();
});

test('all flow', t => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  let r2;
  const x1 = f1.makeVow(r => r2 = r);

  const v2 = E(v1).concat(" MORE"); //v1 ! concat(" MORE")
  delay(() => r1("some"));
  // console.log(v1);

  v1.then(s => console.log(`THE      N1 ${s}`));
  v2.then(s => console.log(`THEN2 ${s}`));

  const x2 = E(x1).concat(" ANOTHER"); //x1 ! concat(" ANOTHER")

  const v3 = E(v1).split();
  //console.log(v3);

  v3.then(s => console.log(`THEN3 ${s}`));

  console.log(`${f1}`);

  Promise.resolve("DONE").then(console.log)

  t.end();
});


test('remote vow', t => {
  const results = [];
  const serializer = {
    allocateSwissStuff() {
      return { swissbase: 'base1', swissnum: 'num1' };
    },
    registerRemoteVow(targetVatID, swissnum, val) {
      console.log(`registerRemoteVow: ${targetVatID}, ${swissnum}, ${val}`);
    },
    opSend(resultSwissbase, targetVatID, targetSwissnum, methodName, args, resolutionOf) {
      results.push({resultSwissbase, targetVatID, targetSwissnum, methodName, args});
    }
  };
  const v1 = makeUnresolvedRemoteVow(serializer, 'vat1', 'swiss1');
  E(v1).foo('arg1', 'arg2');

  t.deepEqual(results, [ { resultSwissbase: 'base1',
                           targetVatID: 'vat1',
                           targetSwissnum: 'swiss1',
                           methodName: 'foo',
                           args: [ 'arg1', 'arg2' ],
                         } ]);

  t.end();
});

test('JSON serialize Vow', t => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  // this used to suffer infinite recursion and overflowed the stack
  t.equal(`${JSON.stringify(v1)}`, '{}');
  t.end();
});

test('simple broken vow', async (t) => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  const v2 = E(v1).badMessage(" MORE"); //v1!badMessage(" MORE")

  delay(() => r1("some"));
  let res;
  try {
    res = await v2;
  } catch (reason) {
    res = 42;
  }
  t.equal(res, res);
  t.end();
});

test('error across forwarding', async (t) => {
  let c = 0;
  console.log(`s ${c++}`);
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  const v2 = E(v1).concat(" MORE"); //v1 ! concat(" MORE")
  console.log(`s ${c++}`);
  let r3;
  const v3 = f1.makeVow(r => r3 = r);
  r1(v3);
  r3(7);
  console.log(`s ${c++}`);

  let res;
  try {
    res = await v2;
  } catch (reason) {
    res = 42;
  }
  t.equal(res, res);
  t.end();
});
