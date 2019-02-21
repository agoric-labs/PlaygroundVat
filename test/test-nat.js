/* global Nat */

import { test } from 'tape-promise/tape';
import Nat from '@agoric/nat';
import SES from 'ses';
import { confineVatSource } from '../src/main';

function s1() {
  exports.foo = a => {
    const Nat = require('@agoric/nat');
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
  const req = s.makeRequire({'@agoric/nat': Nat, '@agoric/harden': true});
  const s1code = funcToSource(s1);
  const n = confineVatSource(s, req, s1code).foo;
  t.equal(n(2), 2);
  t.end();
});
