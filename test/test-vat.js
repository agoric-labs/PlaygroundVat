import test from 'tape';
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

  let resolver1;
  log('i am here');
  const p1 = new Promise((resolve, reject) => resolver1 = resolve);
  log('i got here');

  exports.wait = () => {
    log('in wait');
    return p1;
  };
  exports.fire = (arg) => {
    log('in fire');
    resolver1(arg);
    log(' ran resolver');
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
  console.log(`source: ${s1code}`);
  const e = confineVatSource(s, `${s1code}`);
  t.equal(e.increment(), 1);
  t.equal(e.increment(), 2);
  t.equal(e.decrement(), 1);
  t.end();
});


test('methods can return a promise', async (t) => {
  const outputTranscript = [];
  function writeOutput(line) {
    outputTranscript.push(line);
  }
  const s = makeRealm();
  const v = await buildVat(s, 'v1', writeOutput, funcToSource(s1));
  let resolver2;
  let result2 = false;
  const p2 = new Promise((resolve, reject) => resolver2 = resolve);
  p2.then((res) => {
    console.log('dfghjdfj');
    result2 = res;
  });
  console.log(`v is ${v}`);
  v.check();
  v.opReceived('msg: v2->v1 {"method": "wait", "args": []}', resolver2);
  t.equal(result2, false);
  v.opReceived('msg: v2->v1 {"method": "fire", "args": [10]}');
  //
  await promisify(setImmediate)();
  t.equal(result2, 10);
  t.end();
});
