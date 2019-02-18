import test from 'tape';
import SES from 'ses';
import { bundleCode, confineVatSource } from '../src/main';

test('build source map from module', async t => {
  const s = SES.makeSESRootRealm();
  const code = await bundleCode(require.resolve('./m1'), true);
  // console.log(code);
  const exports = confineVatSource(s, code);
  // exports.foo();
  const lines = code.split('\n');
  const last = lines[lines.length - 2];
  t.ok(last.startsWith('//# sourceMappingURL='));
  t.end();
});
