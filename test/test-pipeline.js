import { test } from 'tape-promise/tape';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import { makeTranscript, funcToSource, makeQueues } from './util';
import { hash58 } from '../src/host';

function t1_left() {
  exports.default = function(argv) {
    let done;
    let p2 = Vow.resolve(argv.p1).e.foo('foo');
    let p3 = p2.e.bar('bar');
    p3.then(res => { done = res; });
    return {
      getDone() { return done; },
    };
  };
}

function t1_right() {
  exports.default = function(argv) {
    let fooCalled, barCalled;
    let obj2 = {
      bar(arg) {
        barCalled = arg;
        return 'done';
      }
    };
    let obj3 = {};
    return {
      foo(arg) {
        fooCalled = arg;
        return obj2;
      },
      getFooCalled() { return fooCalled; },
      getBarCalled() { return barCalled; },
    };
  };
}


test('promise pipelining', async (t) => {
  const tr = makeTranscript();
  const endow = { writeOutput: tr.writeOutput,
                  comms: { registerManager() {},
                           wantConnection() {} },
                  hash58 };
  const s = makeRealm();
  const v1 = await buildVat(s, 'vat1', 'vat1 secret', 'vat1', endow, funcToSource(t1_left));
  const v1argv = { p1: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2 = await buildVat(s, 'vat2', 'vat2 secret', 'vat2', endow, funcToSource(t1_right));
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);
  const q = makeQueues(t);
  let got;

  v1.connectionMade('vat2', q.addQueue(1, 2));
  v2.connectionMade('vat1', q.addQueue(2, 1));

  // foo() is transmitted immediately, and bar() is pipelined right behind it

  const got1 = q.expect(1, 2,
                        { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 0},
                        { op: 'send',
                          resultSwissbase: 'b1-ScrHVw5LqkhEJMJdeCE17W',
                          targetSwissnum: '0',
                          methodName: 'foo',
                          args: ['foo'],
                        });

  const got2 = q.expect(1, 2,
                        { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 1},
                        { op: 'when',
                          targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
                        });

  const got3 = q.expect(1, 2,
                        { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 2},
                        { op: 'send',
                          resultSwissbase: 'b2-XpvixAJgvUFL8NY6AZkUH9',
                          targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
                          methodName: 'bar',
                          args: ['bar'],
                        });

  const got4 = q.expect(1, 2,
                        { fromVatID: 'vat1', toVatID: 'vat2', seqnum: 3},
                        { op: 'when',
                          targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ'
                        });

  q.expectEmpty(1, 2);

  // delivering foo() causes p2 to be resolved, then bar() can be delivered immediately
  v2.commsReceived('vat1', got1); // foo()
  v2.commsReceived('vat1', got2); // 'when' to resolve p2
  await Promise.resolve(0);
  t.equal(v2root.getFooCalled(), 'foo');

  v2.commsReceived('vat1', got3); // bar()
  v2.commsReceived('vat1', got4); // 'when' to resolve p3
  await Promise.resolve(0);
  t.equal(v2root.getBarCalled(), 'bar');

  const got5 = q.expect(2, 1,
                        { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 0 },
                        { op: 'resolve',
                          targetSwissnum: 'hb1-Scr-V3gfYa5Ho4vdveBTCUjPsV',
                          value: {'@qclass': 'presence',
                                  vatID: 'vat2', swissnum: '1-YAjJjvUTPE9jgFC1USrG5B' },
                        });

  const got6 = q.expect(2, 1,
                        { fromVatID: 'vat2', toVatID: 'vat1', seqnum: 1 },
                        { op: 'resolve',
                          targetSwissnum: 'hb2-Xpv-H9Ti5fawDV9VkowVJWEBzJ',
                          value: 'done',
                        });

  q.expectEmpty(2, 1);
  v1.commsReceived('vat2', got5); // resolves p2
  v1.commsReceived('vat2', got6); // resolves p3
  await Promise.resolve(0);
  t.equal(v1root.getDone(), 'done');

  t.end();
});
