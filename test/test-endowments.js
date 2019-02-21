import { test } from 'tape-promise/tape';
import SES from 'ses';
import { makeVatEndowments } from '../src/host';
import {
  makeSwissnum,
  makeSwissbase,
  doSwissHashing,
} from '../src/vat/swissCrypto';

test('hash58', t => {
  const s = SES.makeSESRootRealm();
  const e = makeVatEndowments(s, null, null);
  // test vectors from python and electrum/lib/address.py Base58 class
  // Base58.encode(hashlib.sha256(s).digest()[:16])
  t.equal(e.hash58(''), 'V7jseQevszwMPhi4evidTR');
  t.equal(e.hash58(''), 'V7jseQevszwMPhi4evidTR'); // stable
  t.equal(e.hash58('a'), 'S1yrYnjHbfbiTySsN9h1eC');
  let xyz100 = '';
  for (let i = 0; i < 100; i += 1) {
    xyz100 += 'xyz';
  }
  t.equal(e.hash58(xyz100), 'LkLiePjfKWZzhQgmcEPT8j');
  t.end();
});

test.skip('swissHashing', t => {
  const s = SES.makeSESRootRealm();
  const e = makeVatEndowments(s, null, null);
  const vs = e.hash58('vat secret');
  t.equal(vs, 'WHMV2quAubLYGoFtXtpEao');
  const sw1 = makeSwissnum(vs, 1, e.hash58);
  t.equal(sw1, '1-QJLaesBjzmJURkMeDUBanr'); //  (='1-'+hash58(vatsecret))

  const sw2 = makeSwissnum(vs, 2, e.hash58);
  t.equal(sw2, '2-8j3hwtrXHPLuG4tDPbMSQm');

  const sw3 = makeSwissbase(vs, 3, e.hash58);
  t.equal(sw3, 'b3-8ETwGG3NFZMskqWBorEhe2');

  const hsw3 = doSwissHashing(sw3, e.hash58);
  t.equal(hsw3, 'hb3-8ET-9vy5vpgVHi9H4PJCNYKxas');

  t.end();
});
