import test from 'tape';
import Nat from '@agoric/nat';
import SES from 'ses';
import { promisify } from 'util';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import { makeVatEndowments } from '../src/host';
import { hash58 } from '../src/host';

test('marshal', async t => {
  const s = SES.makeSESRootRealm({consoleMode: 'allow', errorStackMode: 'allow'});
  const code = await bundleCode(require.resolve('../src/vat/webkey'));
  const req = s.makeRequire({'@agoric/nat': Nat, '@agoric/harden': true});
  const e = confineVatSource(s, req, code);
  const endowments = makeVatEndowments(s, req, null, null);
  const hash58 = endowments.hash58;

  function helpers() {
    const harden = require('@agoric/harden');
    function serializer(x) {
      console.log(x);
    }
    const ref1 = {
      a() {
        return 1;
      },
    };
    const val = {
      empty: {},
      array1: [1, 2],
      ref1,
      ref2: {
        a() {
          return 2;
        },
      },
      nested1: { b: ref1, c: 3 },
      serializer,
    };
    return harden(val);
  }
  const h = s.evaluate(`${helpers}; helpers()`, { require: req });

  function mdef(template, ...subs) {
    if (subs.length !== 0) {
      throw new Error('unimplemented');
    }
    return s.evaluate(`(const harden = require('@agoric/harden'); harden(${template[0]}))`, { require: req });
  }
  const myVatSecret = 'v1 secret';
  const m = e.makeWebkeyMarshal(
    hash58,
    'v1',
    myVatSecret,
    h.serializer,
  );
  function resolutionOf(val) {
    return val;
  }
  function ser(what) {
    return m.serialize(what, resolutionOf);
  }
  t.equal(ser(1), '1');
  t.equal(ser('abc'), '"abc"');
  t.equal(ser(true), 'true');

  t.equal(ser(h.array1), '[1,2]');

  // const ref1 = mdef`{ a() { return 1; } }`;

  // as a side effect, this stashes the object in the marshaller's tables
  t.equal(
    ser(h.ref1),
    '{"@qclass":"presence","vatID":"v1","swissnum":"1-Y74TZcuaAYa3B4JwDWbKqM"}',
  );

  t.equal(
    ser(h.empty),
    '{"@qclass":"presence","vatID":"v1","swissnum":"2-HsfpAvGAS8GS3ENVCn9VUm"}',
  );
  t.equal(
    m.unserialize(
      '{"@qclass":"presence","vatID":"v1","swissnum":"2-HsfpAvGAS8GS3ENVCn9VUm"}',
    ),
    h.empty,
  );

  // todo: what if the unserializer is given "{}"

  t.equal(m.unserialize('1'), 1);
  t.equal(m.unserialize('"abc"'), 'abc');
  t.equal(m.unserialize('false'), false);

  const w1 = ser(h.ref2); // wk2
  t.equal(m.unserialize(w1), h.ref2); // comes back out of the table

  // Presence: we get an empty object, but it is registered in the Vow
  // tables, and will roundtrip properly on the way back out
  const p = m.unserialize(
    '{"@qclass":"presence","vatID":"v2","swissnum":"sw44"}',
  );
  t.deepEqual(p, {});
  t.equal(ser(p), '{"@qclass":"presence","vatID":"v2","swissnum":"sw44"}');

  // JS primitives that aren't natively representable by JSON
  t.deepEqual(m.unserialize('{"@qclass":"undefined"}'), undefined);
  t.ok(Object.is(m.unserialize('{"@qclass":"-0"}'), -0));
  t.notOk(Object.is(m.unserialize('{"@qclass":"-0"}'), 0));
  t.ok(Object.is(m.unserialize('{"@qclass":"NaN"}'), NaN));
  t.deepEqual(m.unserialize('{"@qclass":"Infinity"}'), Infinity);
  t.deepEqual(m.unserialize('{"@qclass":"-Infinity"}'), -Infinity);
  t.deepEqual(m.unserialize('{"@qclass":"undefined"}'), undefined);
  t.deepEqual(
    m.unserialize('{"@qclass":"symbol", "key":"sym1"}'),
    Symbol.for('sym1'),
  );
  // The host does not support BigInts yet. Some day.
  // t.deepEqual(m.unserialize('{"@qclass":"bigint"}'), something);

  t.deepEqual(m.unserialize('[1,2]'), [1, 2]);
  t.deepEqual(m.unserialize('{"a":1,"b":2}'), { a: 1, b: 2 });
  t.deepEqual(m.unserialize('{"a":1,"b":{"c": 3}}'), { a: 1, b: { c: 3 } });

  // pass-by-copy can contain pass-by-reference
  const aser = ser(h.nested1);
  t.equal(
    aser,
    '{"b":{"@qclass":"presence","vatID":"v1","swissnum":"1-Y74TZcuaAYa3B4JwDWbKqM"},"c":3}',
  );

  t.end();
});

function funcToSource(f) {
  let code = `${f}`;
  code = code.replace(/^function .* {/, '');
  code = code.replace(/}$/, '');
  return code;
}

function s1() {
  exports.default = function(argv) {
    return {
      run(arg1, arg2) {
        return arg1;
      },
    };
  };
}

test.skip('deliver farref to vat', async t => {
  const s = makeRealm();
  const endow = { writeOutput() {}, comms: { registerManager() {} }, hash58 };
  const req = s.makeRequire({'@agoric/nat': Nat, '@agoric/harden': true});
  const v = await buildVat(s, req, 'v1', 'v1 secret', 'v1', endow, funcToSource(s1));
  await v.initializeCode('v1/0');
  const opMsg = {
    op: 'send',
    targetSwissnum: '0',
    methodName: 'run',
    argsS: JSON.stringify([
      { '@qclass': 'presence', vatID: 'vat2', swissnum: '123' },
    ]),
  };

  const res = await v.doSendOnly(opMsg);
  // that should be a Presence instance, which looks like an empty object,
  // but roundtrips correctly
  t.deepEqual(res, {});
  t.deepEqual(
    v.serialize(res),
    '{"@qclass":"presence","vatID":"vat2","swissnum":"123"}',
  );

  t.end();
});
