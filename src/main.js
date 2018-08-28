import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';

import yargs from 'yargs';
import { rollup } from 'rollup';

import SES from 'ses';

import PeerId from 'peer-id';
import PeerInfo from 'peer-info';

import { startComms } from './comms';
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
                                                                      sourcemap: appendSourcemap,
                                                                      exports: 'named'});
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
  const id = await promisify(PeerId.create)();
  const vatID = id.toB58String();
  const basedir = argv.basedir;
  await fs.promises.mkdir(basedir);
  let f = await fs.promises.open(path.join(basedir, 'private-id'), 'w');
  await f.appendFile(`${JSON.stringify(id.toJSON(), null, 2)}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'id'), 'w');
  await f.appendFile(`${id.toB58String()}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'listen-ports'), 'w');
  await f.appendFile(`/ip4/0.0.0.0/tcp/${argv.port}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'addresses'), 'w');
  await f.appendFile(`/ip4/${argv.hostname}/tcp/${argv.port}/ipfs/${vatID}\n`);
  await f.close();

  const demoSourceFilename = require.resolve('../examples/counter.js');
  const demoSource = await fs.promises.readFile(demoSourceFilename);
  await fs.promises.mkdir(path.join(basedir, 'source'));
  f = await fs.promises.open(path.join(basedir, 'source', 'index.js'), 'w');
  await f.appendFile(demoSource);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'root-sturdyref'), 'w');
  await f.appendFile(`${id.toB58String()}/0\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'vat-version'), 'w');
  await f.appendFile(`1\n`);
  await f.close();

  console.log(`created new VatID ${vatID} in ${basedir}`);
}


async function run(argv) {
  let basedir = '.';
  if (argv.basedir) {
    basedir = argv.basedir;
    // else we must be run from a vat basedir
  }
  async function readBaseLine(fn) {
    const c = await fs.promises.readFile(path.join(basedir, fn),
                                         { encoding: 'utf-8' });
    return c.slice(0, c.indexOf('\n'));
  }
  async function readBaseFile(fn) {
    const c = await fs.promises.readFile(path.join(basedir, fn),
                                         { encoding: 'utf-8' });
    return c;
  }
  async function readBaseLines(fn) {
    const c = await fs.promises.readFile(path.join(basedir, fn),
                                         { encoding: 'utf-8' });
    return c.slice(0, c.lastIndexOf('\n')).split('\n');
  }
  const version = await readBaseLine('vat-version');
  if (version !== '1') {
    throw new Error(`I understand vat-version '1', but this basedir has '${version}'`);
  }
  const myVatID = await readBaseLine('id');
  console.log(`myVatID ${myVatID}`);
  const rootSturdyRef = await readBaseLine('root-sturdyref');

  const s = makeRealm();

  // todo: how do we set encoding=utf-8 on an open()?
  const output = await fs.promises.open(path.join(basedir, 'output-transcript'), 'w');

  const vatEndowments = makeVatEndowments(argv, output);
  const guestSource = await bundleCode(path.join(basedir, 'source', 'index.js'), true);
  const v = await buildVat(s, myVatID, vatEndowments.writeOutput, guestSource);
  await v.initializeCode(rootSturdyRef);
  console.log(`rootSturdyRef: ${rootSturdyRef}`);

  // replay transcript to resume from previous state
  let ops = [];
  try {
    ops = await readBaseLines('input-transcript');
  } catch (ex) {
    console.log(`unable to read input-transcript, ignoring (${ex})`);
  }
  for(let op of ops) {
    // TODO: find turn boundaries, ignore all messages that might appear
    // after a turn boundary because that means we crashed while writing
    v.executeTranscriptLine(op);
  }

  const myPeerID_s = await readBaseFile('private-id');
  const myPeerID = await promisify(PeerId.createFromJSON)(JSON.parse(myPeerID_s));
  const myPeerInfo = new PeerInfo(myPeerID);
  const ports = await readBaseLines('listen-ports');
  for (let port of ports) {
    if (port) {
      myPeerInfo.multiaddrs.add(port);
    }
  }

  const locatordir = path.join(basedir, '..');

  async function getAddressesForVatID(vatID) {
    const dirs = await fs.promises.readdir(locatordir);
    for (let d of dirs) {
      const idFile = path.join(locatordir, d, 'id');
      let f;
      try {
        f = await fs.promises.readFile(idFile, { encoding: 'utf-8' });
      } catch (ex) {
        if (ex.code !== 'ENOENT' && ex.code !== 'ENOTDIR') {
          throw ex;
        }
        continue;
      }
      const id = f.split('\n')[0];
      if (id !== vatID)
        continue;
      const portsFile = path.join(locatordir, d, 'addresses'); // todo: fake symlink
      const data = await fs.promises.readFile(portsFile, { encoding: 'utf-8' });
      const addresses = data.split('\n').filter(address => address); // remove blank lines
      return addresses;
    }
    console.log(`unable to find addresses for VatID ${vatID}`);
    return [];
  }

  await startComms(v, myPeerInfo, myVatID, getAddressesForVatID);

  // we fall off the edge here, but Node keeps running because there are
  // still open listening sockets
  console.log('run() finishing');
}

export async function main() {
  yargs
    .command('create <basedir> <hostname> <port>', 'create a new Vat in BASEDIR', (yargs) => {
      yargs
        .positional('basedir', {
          describe: 'directory to create, must not already exist',
        })
        .positional('hostname', {
          describe: 'hostname to advertise in BASEDIR/addresses, start with 127.0.0.1',
        })
        .positional('port', {
          describe: 'TCP port to listen on, choose something unique',
        })
      ;
    }, (argv) => create(argv))
    .command('run [basedir]', 'run a Vat (in current directory, or from BASEDIR)', (yargs) => {
      yargs
        .option('basedir', {
          describe: 'base directory, created by "vat create"',
        })
      ;
    }, (argv) => {
      return run(argv);
    })
    .parse();
}
