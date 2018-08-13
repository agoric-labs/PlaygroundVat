import test from 'tape';
import { confineVatSource } from '../src/main';
import SES from 'ses';

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
