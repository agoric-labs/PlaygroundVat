import test from 'tape';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import SES from 'ses';
import { promisify } from 'util';


test('marshal', async (t) => {
  const s = SES.makeSESRootRealm();
  const code = await bundleCode(require.resolve('../src/vat/webkey'));
  const e = confineVatSource(s, code);

  function helpers() {
    function serializer(x) {
      log(x);
    }
    const ref1 = { a() { return 1; } };
    const val = {
      empty: {},
      array1: [1,2],
      ref1,
      ref2: { a() { return 2; } },
      nested1: {b: ref1, c: 3},
      serializer
    };
    return def(val);
  }
  const h = s.evaluate(`${helpers}; helpers()`);

  function mdef(template, ...subs) {
    if (subs.length !== 0) {
      throw new Error('unimplemented');
    }
    return s.evaluate(`def(${template[0]})`);
  }

  const m = e.makeWebkeyMarshal('v1', h.serializer);
  t.equal(m.serialize(1), '1');
  t.equal(m.serialize('abc'), '"abc"');
  t.equal(m.serialize(true), 'true');

  t.equal(m.serialize(h.array1), '[1,2]');

  //const ref1 = mdef`{ a() { return 1; } }`;

  // as a side effect, this stashes the object in the marshaller's tables
  t.equal(m.serialize(h.ref1), '{"@qclass":"presence","vatID":"v1","swissnum":1}');

  t.equal(m.serialize(h.empty), '{"@qclass":"presence","vatID":"v1","swissnum":2}');
  t.equal(m.unserialize('{"@qclass":"presence","vatID":"v1","swissnum":2}'), h.empty);

  // todo: what if the unserializer is given "{}"

  t.equal(m.unserialize('1'), 1);
  t.equal(m.unserialize('"abc"'), 'abc');
  t.equal(m.unserialize('false'), false);

  const w1 = m.serialize(h.ref2); // wk2
  t.equal(m.unserialize(w1), h.ref2); // comes back out of the table

  // Presence: we get an empty object, but it is registered in the Vow
  // tables, and will roundtrip properly on the way back out
  const p = m.unserialize('{"@qclass":"presence","vatID":"v2","swissnum":"sw44"}');
  t.deepEqual(p, {});
  t.equal(m.serialize(p), '{"@qclass":"presence","vatID":"v2","swissnum":"sw44"}');

  // JS primitives that aren't natively representable by JSON
  t.deepEqual(m.unserialize('{"@qclass":"undefined"}'), undefined);
  t.ok(Object.is(m.unserialize('{"@qclass":"-0"}'), -0));
  t.notOk(Object.is(m.unserialize('{"@qclass":"-0"}'), 0));
  t.ok(Object.is(m.unserialize('{"@qclass":"NaN"}'), NaN));
  t.deepEqual(m.unserialize('{"@qclass":"Infinity"}'), Infinity);
  t.deepEqual(m.unserialize('{"@qclass":"-Infinity"}'), -Infinity);
  t.deepEqual(m.unserialize('{"@qclass":"undefined"}'), undefined);
  t.deepEqual(m.unserialize('{"@qclass":"symbol", "key":"sym1"}'), Symbol.for('sym1'));
  // The host does not support BigInts yet. Some day.
  //t.deepEqual(m.unserialize('{"@qclass":"bigint"}'), something);


  t.deepEqual(m.unserialize('[1,2]'), [1,2]);
  t.deepEqual(m.unserialize('{"a":1,"b":2}'), {a: 1, b: 2});
  t.deepEqual(m.unserialize('{"a":1,"b":{"c": 3}}'), {a: 1, b: { c: 3 }});

  // pass-by-copy can contain pass-by-reference
  const aser = m.serialize(h.nested1);
  t.equal(aser, '{"b":{"@qclass":"presence","vatID":"v1","swissnum":1},"c":3}');

  t.end();
});


function funcToSource(f) {
  let code = `${f}`;
  code = code.replace(/^function .* {/, '');
  code = code.replace(/}$/, '');
  return code;
}

function s1() {
  exports.run = (arg1, arg2) => {
    return arg1;
  };

}

test('deliver farref to vat', async (t) => {
  const s = makeRealm();
  const v = await buildVat(s, 'v1', () => {}, funcToSource(s1));
  const bodyJson = JSON.stringify({op: 'send',
                                   targetSwissnum: 0,
                                   methodName: 'run',
                                   args: [{'@qclass': 'presence',
                                           vatID: 'vat2',
                                           swissnum: 123
                                          }]});

  const { res, rej, success } = v.doSendOnly(bodyJson);
  // that should be a Presence instance, which looks like an empty object,
  // but roundtrips correctly
  t.deepEqual(res, {});
  t.deepEqual(v.serialize(res), '{"@qclass":"presence","vatID":"vat2","swissnum":123}');

  t.end();
});
