import { test } from 'tape-promise/tape';
import { confineVatSource, makeRealm, buildVat, bundleCode } from '../src/main';
import { makeTranscript, funcToSource } from './util';

function v1source() {
  exports.default = function(argv) {
    Vow.resolve(argv.target).e.pleaseRespond('marco');
    //  .then(res => log(`got answer: ${res}`));
  };
}

function v2source() {
  exports.default = function(argv) {
    return {
      pleaseRespond(arg) {
        log(`pleaseRespond called with ${arg}`);
        return `${arg}-polo`;
      },
    };
  };
}


test('comms, sending a message', async (t) => {
  const tr = makeTranscript();
  const s = makeRealm();
  const v1src = funcToSource(v1source);
  const v1 = await buildVat(s, 'vat1', tr.writeOutput, v1src);
  const v1argv = { target: v1.createPresence('vat2/0') };
  const v1root = await v1.initializeCode('vat1/0', v1argv);

  const v2src = funcToSource(v2source);
  const v2 = await buildVat(s, 'vat2', tr.writeOutput, v2src);
  const v2argv = {};
  const v2root = await v2.initializeCode('vat2/0', v2argv);

  const v1_to_v2 = [];
  const c12 = {
    send(msg) { //console.log('SEND12', msg);
                v1_to_v2.push(msg);
              },
  };
  v1.connectionMade('vat2', c12);

  t.equal(v1_to_v2.length, 1);
  t.deepEqual(JSON.parse(v1_to_v2[0]),
              { seqnum: 0, op: 'send',
                resultSwissbase: 'base-1',
                targetSwissnum: '0',
                methodName: 'pleaseRespond',
                args: ['marco'],
              });

  v2.commsReceived('vat1', v1_to_v2[0]);

  const v2_to_v1 = [];
  const c21 = {
    send(msg) { //console.log('SEND21', msg);
                v2_to_v1.push(msg);
              },
  };
  v2.connectionMade('vat1', c21);
  // that immediately provokes an ack

  t.equal(v2_to_v1.length, 1);
  t.deepEqual(JSON.parse(v2_to_v1[0]),
              { ackSeqnum: 0, op: 'ack',
              });

  // the pleaseRespond isn't executed until a turn later
  await Promise.resolve(0);

  t.equal(v2_to_v1.length, 2);
  t.deepEqual(JSON.parse(v2_to_v1[1]),
              { seqnum: 0, op: 'resolve',
                targetSwissnum: 'hash-of-base-1',
                value: 'marco-polo',
              });

  t.end();
});
