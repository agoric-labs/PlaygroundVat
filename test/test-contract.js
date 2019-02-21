import { test } from 'tape-promise/tape';
import Nat from '@agoric/nat';
import { makeRealm, buildVat, bundleCode } from '../src/main';
import { hash58 } from '../src/host';

function sendCall(v, methodName, ...args) {
  const opMsg = {
    op: 'send',
    targetSwissnum: '0',
    methodName,
    argsS: JSON.stringify(args),
  };
  return v.doSendOnly(opMsg);
}

async function buildContractVat(source = '../examples/contract') {
  const outputTranscript = [];
  function writeOutput(line) {
    outputTranscript.push(line);
  }
  const s = makeRealm({ consoleMode: 'allow', errorStackMode: 'allow' });
  const req = s.makeRequire({'@agoric/nat': Nat, '@agoric/harden': true});
  const contractTestSource = await bundleCode(require.resolve(source));
  const endow = { writeOutput, comms: { registerManager() {} }, hash58 };
  const v = await buildVat(
    s,
    req,
    'v1',
    'v1 secret',
    'v1',
    endow,
    contractTestSource,
  );
  await v.initializeCode('v1/0');
  return v;
}

test('mint test', async t => {
  const v = await buildContractVat('../examples/contract/contractTest');
  const p = sendCall(v, 'mintTest');
  const contractResult = await p;
  t.deepEqual(contractResult, [950, 50]);
  t.end();
});

test('trivial contract test', async t => {
  const v = await buildContractVat();
  const p = sendCall(v, 'trivialContractTest');
  const contractResult = await p;
  t.equal(contractResult, 8);
  t.end();
});

test('contract test Alice first', async t => {
  const v = await buildContractVat();
  const p = sendCall(v, 'betterContractTestAliceFirst');
  const contractResult = await p;
  t.equal(contractResult, 'If it fits, ware it.');
  t.end();
});

test('contract test Bob first', async t => {
  const v = await buildContractVat();
  const p = sendCall(v, 'betterContractTestBobFirst');
  const contractResult = await p;
  t.deepEqual(contractResult, [7, 10]);
  t.end();
});

// this is broken until we can deliver Rejection properly
test.skip('contract test Bob lies', async t => {
  const v = await buildContractVat();
  const p = sendCall(v, 'betterContractTestBobFirst', true);
  await p.then(
    _e => t.fail('should have broken'),
    ex => {
      t.ok(ex.message.startsWith('unexpected contract'));
    },
  );
  t.end();
});
