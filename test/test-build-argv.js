import test from 'tape';
import { buildArgv } from '../src/main';

test('build argv', async (t) => {
  const filenames = [];
  function readBaseFile(fn) {
    filenames.push(fn);
    return 'contents of file';
  }
  const vat = { makeEmptyObject() { return {}; },
                createPresence(sturdyref) { return `sr: ${sturdyref}`; },
              };
  const j1 = `{"name1": {"string": "silly"},
               "name2": {"number": 123.4},
               "name3": {"filename": "fn1"},
               "name4": {"sturdyref": "vat1/swiss1"}
              }`;
  const a1 = await buildArgv(vat, j1, readBaseFile);
  t.equal(a1.name1, 'silly');
  t.equal(a1.name2, 123.4);
  t.equal(a1.name3, 'contents of file');
  t.deepEqual(filenames, ['fn1']);
  t.equal(a1.name4, 'sr: vat1/swiss1');

  t.end();
});
