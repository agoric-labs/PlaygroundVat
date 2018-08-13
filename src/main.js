import fs from 'fs';
import crypto from 'crypto';

import yargs from 'yargs';
import { rollup } from 'rollup';

import SES from 'ses';

import { makeVatEndowments, readAndHashFile } from './host';

export function confineVatSource(s, source) {
  const exports = {};
  function log(...args) {
    console.log(...args);
  }
  const endow = { exports, log };
  s.evaluate(source, endow);
  return exports;
}

async function run(argv) {
  console.log(`run ${argv.source} ${argv.input} ${argv.output}`);
  const s = SES.makeSESRootRealm();
  const output = fs.openSync(argv.output, 'w');

  // This needs to read the contents of vat.js, as a string. SES manages this
  // by putting all the code (as ES6 modules) in a directory named bundle/ ,
  // then the build process uses 'rollup' and some small editing to merge it
  // all into a file named 'stringifiedBundle' which exports an object named
  // 'creatorStrings'. If we did that (which might become more important as
  // the vat code expands to live in multiple files), then this would become
  // "import { makeVatStrings } from './bundlesomething'". Without it, we
  // need to find a filename relative to our current source file, which is
  // ugly.

  const bundle = await rollup({ input: require.resolve('./vat') });
  const { code: vatSource } = await bundle.generate({ format: 'cjs' });
  //console.log(`vatSource: ${vatSource}`);

  //const vatSource = fs.readFileSync(require.resolve('./vat.js'));
  const { makeVat } = confineVatSource(s, vatSource);

  const vatEndowments = makeVatEndowments(argv, output);
  const myVatID = argv.vatID;

  const { source: initialSource, sourceHash: initialSourceHash } = readAndHashFile(argv.source);
  const v = makeVat(vatEndowments, myVatID, initialSource, initialSourceHash);

  const opTranscript = fs.readFileSync(argv.input).toString('utf8');
  v.start(opTranscript);

  // network listener goes here, call v.processOp() or something more like
  // dataReceived()

  fs.closeSync(output);
}

export async function main() {
  yargs
    .command('run [source]', 'run a service', (yargs) => {
      yargs.positional('source', {
        describe: 'initial object sourcefile',
      });
    }, (argv) => {
      return run(argv);
    })
    .option('input', {})
    .option('output', {})
    .option('vatID', {})
    .argv;
}
