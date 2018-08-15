import { test } from 'tape-promise/tape';

test('tape works', t => {
  t.equal(1, 1);
  t.end();
});

import Flow from '../src/flow/flowcomm';

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

  //const v2 = v1.e.concat(" MORE"); //v1 ! concat(" MORE")
  const v2 = v1.e.concat(" MORE"); //v1!concat(" MORE")

  Promise.resolve(null).then(ignore => r1("some"));

  const res = await v2;

  t.equal(res, 'some MORE');

  t.end();
});

test('resolved send queues in order', async (t) => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  Promise.resolve(null).then(ignore => r1("some"));
  const v2 = v1.e.concat(" MORE"); //v1 ! concat(" MORE")
  const res = await v2;
  t.equal(res, 'some MORE');
  t.end();
});

test('pre-resolved send queues in order', async (t) => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  r1("some");
  const v2 = v1.e.concat(" MORE"); //v1 ! concat(" MORE")
  const res = await v2;
  t.equal(res, 'some MORE');
  t.end();
});

test('order across forwarding', async (t) => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  const v2 = v1.e.concat(" MORE"); //v1 ! concat(" MORE")

  let r3;
  const v3 = f1.makeVow(r => r3 = r);
  r1(v3);
  r3("some");

  const res = await v2;
  t.equal(res, 'some MORE');
  t.end();
});

test('all flow', t => {
  const f1 = new Flow();
  let r1;
  const v1 = f1.makeVow(r => r1 = r);
  let r2;
  const x1 = f1.makeVow(r => r2 = r);

  const v2 = v1.e.concat(" MORE"); //v1 ! concat(" MORE")
  Promise.resolve(null).then(ignore => r1("some"));
  // console.log(v1);

  v1.then(s => console.log(`THEN1 ${s}`));
  v2.then(s => console.log(`THEN2 ${s}`));

  const x2 = x1.e.concat(" ANOTHER"); //x1 ! concat(" ANOTHER")

  const v3 = v1.e.split();
  //console.log(v3);

  v3.then(s => console.log(`THEN3 ${s}`));

  console.log(`${f1}`);

  Promise.resolve("DONE").then(console.log)

  t.end();
});


