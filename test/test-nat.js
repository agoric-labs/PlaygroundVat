import { test } from 'tape-promise/tape';
import SES from 'ses';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';

function s1() {
  exports.foo = a => {
    return Nat(a);
  };
}

function funcToSource(f) {
  let code = `${f}`;
  code = code.replace(/^function .* {/, '');
  code = code.replace(/}$/, '');
  return code;
}

test('Nat', t => {
  const s = SES.makeSESRootRealm();
  const s1code = funcToSource(s1);
  const n = confineVatSource(s, funcToSource(s1)).foo;
  t.equal(n(2), 2);
  t.end();
});
