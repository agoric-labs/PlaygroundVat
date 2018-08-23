import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';

import yargs from 'yargs';
import { rollup } from 'rollup';

import SES from 'ses';

import PeerId from 'peer-id';

import { makeComms } from './comms';
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

export function makeRealm() {
  const s = SES.makeSESRootRealm();
  return s;
}

export async function bundleCode(filename, appendSourcemap) {
  const guestBundle = await rollup({ input: filename, treeshake: false });
  let { code: source, map: sourceMap } = await guestBundle.generate({ format: 'cjs',
                                                                      sourcemap: appendSourcemap });
  // Rollup will generate inline sourceMappingURLs for you, but only if you
  // write the output to a file. We do it manually to avoid using a tempfile.
  //await guestBundle.write({format: 'cjs', file: 'foof', sourcemap: 'inline'});
  if (appendSourcemap) {
    //console.log(`sourceMap is: ${JSON.stringify(sourceMap, undefined, ' ')}`);
    //console.log(`typeof sourceMap is: ${typeof sourceMap}`);
    const body = Buffer.from(JSON.stringify(sourceMap)).toString('base64');
    const dataURL = `data:application/json;charset=utf-8;base64,${body}`;
    source += '\n//# sourceMappingURL=' + dataURL + '\n';
  }
  return source;
}

export async function buildVat(s, vatID, writeOutput, guestSource) {

  // This needs to read the contents of vat.js, as a string. SES manages this
  // by putting all the code (as ES6 modules) in a directory named bundle/ ,
  // then the build process uses 'rollup' and some small editing to merge it
  // all into a file named 'stringifiedBundle' which exports an object named
  // 'creatorStrings'. If we did that (which might become more important as
  // the vat code expands to live in multiple files), then this would become
  // "import { makeVatStrings } from './bundlesomething'". Without it, we
  // need to find a filename relative to our current source file, which is
  // ugly.

  const vatSource = await bundleCode(require.resolve('./vat'));
  //console.log(`vatSource: ${vatSource}`);

  //const vatSource = fs.readFileSync(require.resolve('./vat.js'));
  const { makeVat } = confineVatSource(s, vatSource);
  const vatEndowments = { writeOutput };

  return makeVat(vatEndowments, vatID, guestSource);
}

async function create(argv) {
  await fs.promises.mkdir(argv.basedir);
  const id = await promisify(PeerId.create)();
  let f = await fs.promises.open(path.join(argv.basedir, 'private-id'), 'w');
  await f.appendFile(JSON.stringify(id.toJSON(), null, 2) + '\n');
  await f.close();

  f = await fs.promises.open(path.join(argv.basedir, 'id'), 'w');
  await f.appendFile(id.toB58String() + '\n');
  await f.close();

}


async function run(argv) {
  console.log(`run ${argv.source} ${argv.input} ${argv.output}`);
  const s = makeRealm();

  const output = fs.openSync(argv.output, 'w');

  const vatEndowments = makeVatEndowments(argv, output);
  const myVatID = argv.vatID;
  const guestSource = await bundleCode(argv.source, true);
  const v = await buildVat(s, myVatID, vatEndowments.writeOutput, guestSource);

  // replay transcript to resume from previous state
  const opTranscript = fs.readFileSync(argv.input).toString('utf8');
  const ops = opTranscript.split('\n');
  for(let op of ops) {
    v.executeTranscriptLine(op);
  }

  // create a JSON peer-id record (private key, public key, id=hash(pubkey))
  // by running 'node node_modules/.bin/peer-id > vinfo', then run
  // bin/vat with --vinfo=vinfo
  const vinfoJson = fs.readFileSync(argv.vinfo).toString('utf8');
  const c = await makeComms(vinfoJson, v);

  // network listener goes here, call v.processOp() or something more like
  // dataReceived()

  // we fall off the edge here, but Node keeps running because there are
  // still open listening sockets
  console.log('run() finishing');
}

export async function main() {
  yargs
    .command('create <basedir>', 'create a new Vat in BASEDIR', (yargs) => {
      yargs
        .positional('basedir', {
          describe: 'new directory to be created and populated with Vat state',
        })
      ;
    }, (argv) => create(argv))
    .command('run <basedir>', 'run a Vat from BASEDIR', (yargs) => {
      yargs
        .positional('basedir', {
          describe: 'base directory, created by "vat create"',
        })
      ;
    }, (argv) => {
      return run(argv);
    })
    .parse();
}
