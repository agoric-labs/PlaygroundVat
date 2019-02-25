import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';

import yargs from 'yargs';
import { rollup } from 'rollup';

import SES from 'ses';
import Nat from '@agoric/nat';

import PeerId from 'peer-id';
import PeerInfo from 'peer-info';

import { createComms } from './comms';
import { hash58, makeVatEndowments } from './host';
import { parseVatID } from './vat/id';
import { makeSwissnum } from './vat/swissCrypto';

export function confineVatSource(s, req, source) {
  const exports = {};
  s.evaluate(source, { exports, require: req });
  return exports;
}

export function makeRealm() {
  const mode = { consoleMode: 'allow' };
  // mode.errorStackMode = 'allow'; // debug only
  const s = SES.makeSESRootRealm(mode);
  return s;
}

export async function bundleCode(filename, appendSourcemap) {
  const guestBundle = await rollup({
    input: filename,
    treeshake: false,
    external: ['@agoric/nat', '@agoric/harden'],
  });
  const { output } = await guestBundle.generate({
    format: 'cjs',
    sourcemap: appendSourcemap,
    exports: 'named',
  });
  // TODO: assert that output.length == 1, we aren't prepared to handle
  // multiple chunks/assets yet
  // for (const chunkOrAsset of output) {
  if (output[0].isAsset) {
    throw Error(`not expecting an asset: ${output[0].fileName}`);
  }
  let { code: source } = output[0];
  const { map: sourceMap } = output[0];

  // Rollup will generate inline sourceMappingURLs for you, but only if you
  // write the output to a file. We do it manually to avoid using a tempfile.
  // await guestBundle.write({format: 'cjs', file: 'foof', sourcemap: 'inline'});
  if (appendSourcemap) {
    // console.log(`sourceMap is: ${JSON.stringify(sourceMap, undefined, ' ')}`);
    // console.log(`typeof sourceMap is: ${typeof sourceMap}`);
    const body = Buffer.from(JSON.stringify(sourceMap)).toString('base64');
    const dataURL = `data:application/json;charset=utf-8;base64,${body}`;
    source += `\n//# sourceMappingURL=${dataURL}\n`;
  }
  return source;
}

export async function buildVat(
  s,
  req,
  myVatID,
  myVatSecret,
  myHostID,
  vatEndowments,
  guestSource,
) {
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
  // console.log(`vatSource: ${vatSource}`);

  // const vatSource = fs.readFileSync(require.resolve('./vat.js'));
  const { makeVat } = confineVatSource(s, req, vatSource);

  return makeVat(vatEndowments, myVatID, myVatSecret, myHostID, guestSource);
}

async function create(argv) {
  const id = await promisify(PeerId.create)();
  const vatID = id.toB58String();
  const { basedir } = argv;
  await fs.promises.mkdir(basedir);
  let f = await fs.promises.open(path.join(basedir, 'private-id'), 'w');
  const privateId = `${JSON.stringify(id.toJSON(), null, 2)}\n`;
  await f.appendFile(privateId);
  await f.close();

  // generate a random vatSecret, unrelated to the per-host privateID
  // quorum vats must share a vatSecret
  const myVatSecret = hash58(crypto.randomBytes(128 / 8));
  f = await fs.promises.open(path.join(basedir, 'vat-secret'), 'w');
  await f.appendFile(`${myVatSecret}\n`);
  await f.close();

  const rootSwissnum = makeSwissnum(myVatSecret, 0, hash58);

  f = await fs.promises.open(path.join(basedir, 'id'), 'w'); // VatID
  await f.appendFile(`${id.toB58String()}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'host-id'), 'w');
  await f.appendFile(`${id.toB58String()}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'listen-ports'), 'w');
  await f.appendFile(`/ip4/0.0.0.0/tcp/${argv.port}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'addresses'), 'w');
  await f.appendFile(`/ip4/${argv.addr}/tcp/${argv.port}/ipfs/${vatID}\n`);
  await f.close();

  // exported function will be invoked as main({name1: 'arg1'})
  f = await fs.promises.open(path.join(basedir, 'argv.json'), 'w');
  await f.appendFile(`{ "name1": { "string": "arg1" } }\n`);
  await f.close();

  const demoSourceFilename = require.resolve('../examples/counter.js');
  const demoSource = await fs.promises.readFile(demoSourceFilename);
  await fs.promises.mkdir(path.join(basedir, 'source'));
  f = await fs.promises.open(path.join(basedir, 'source', 'index.js'), 'w');
  await f.appendFile(demoSource);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'root-sturdyref'), 'w');
  await f.appendFile(`${id.toB58String()}/${rootSwissnum}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'vat-version'), 'w');
  await f.appendFile(`1\n`);
  await f.close();

  console.log(`created new VatID ${vatID} in ${basedir}`);
}

export async function convertToQuorum(argv) {
  const quorumVatID = argv.vatid;
  const myVatSecret = argv.vatsecret;
  let basedir = '.';
  if (argv.basedir) {
    /* eslint-disable-next-line prefer-destructuring */
    basedir = argv.basedir;
    // else we must be run from a vat basedir
  }
  const p = parseVatID(quorumVatID);
  if (p.members.size === 1) {
    throw new Error(`this is a solo vat id, not quorum: ${quorumVatID}`);
  }
  if (p.threshold > p.members.size) {
    throw new Error(
      `unachievable quorum: threshold is ${p.threshold} but there are only ${
        p.members.size
      } members`,
    );
  }
  async function readBaseLine(fn) {
    const c = await fs.promises.readFile(path.join(basedir, fn), {
      encoding: 'utf-8',
    });
    return c.slice(0, c.indexOf('\n'));
  }
  const myVatID = await readBaseLine('id');
  const myHostID = await readBaseLine('host-id');
  if (myVatID !== myHostID) {
    throw new Error(`I am already a member of a quorum vat (${myVatID})`);
  }
  if (!p.members.has(myHostID)) {
    throw new Error(
      `I am not a member of the new quorum vat (I am ${myHostID}, quorum vat id is ${quorumVatID})`,
    );
  }
  // todo: assert lack of input-transcript, as it will have messages for the
  // wrong vat

  if (p.leader === myHostID) {
    console.log(`I am the leader of the new Quorum Vat`);
  } else {
    console.log(`I am a follower in the new Quorum Vat`);
  }

  // rewrite the swissnum: it is a function of the (new) vat secret
  const rootSwissnum = makeSwissnum(myVatSecret, 0, hash58);

  let f;

  f = await fs.promises.open(path.join(basedir, 'root-sturdyref'), 'w');
  await f.appendFile(`${quorumVatID}/${rootSwissnum}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'id'), 'w'); // VatID
  await f.appendFile(`${quorumVatID}\n`);
  await f.close();

  f = await fs.promises.open(path.join(basedir, 'vat-secret'), 'w');
  await f.appendFile(`${myVatSecret}\n`);
  await f.close();

  console.log('Conversion to Quorum Vat complete.');
}

export async function buildArgv(vat, argvJSON, readBaseFile, vatEndowments) {
  const argv = vat.makeEmptyObject(); // realm-side object
  const descs = JSON.parse(argvJSON);
  for (const name of Object.getOwnPropertyNames(descs)) {
    const v = descs[name];
    if ('string' in v) {
      argv[name] = v.string;
    } else if ('number' in v) {
      argv[name] = v.number;
    } else if ('sturdyref' in v) {
      argv[name] = vat.createPresence(v.sturdyref);
    } else if ('filename' in v) {
      /* eslint-disable-next-line no-await-in-loop */
      argv[name] = await readBaseFile(v.filename);
    } else if ('exit' in v && v.exit === 'allowed') {
      argv[name] = vatEndowments.exit;
    } else {
      throw new Error(`unknown argv type ${v}`);
    }
  }
  return argv;
}

async function buildComms(
  myVatSecret,
  readBaseFile,
  readBaseLines,
  locatordir,
) {
  const myPeerIDS = await readBaseFile('private-id');
  const myPeerID = await promisify(PeerId.createFromJSON)(
    JSON.parse(myPeerIDS),
  );
  const myPeerInfo = new PeerInfo(myPeerID);
  const ports = await readBaseLines('listen-ports');
  for (const port of ports) {
    if (port) {
      myPeerInfo.multiaddrs.add(port);
    }
  }

  async function getAddressesForHostID(hostID) {
    const dirs = await fs.promises.readdir(locatordir);
    for (const d of dirs) {
      const idFile = path.join(locatordir, d, 'host-id');
      let f;
      try {
        /* eslint-disable-next-line no-await-in-loop */
        f = await fs.promises.readFile(idFile, { encoding: 'utf-8' });
      } catch (ex) {
        if (ex.code !== 'ENOENT' && ex.code !== 'ENOTDIR') {
          throw ex;
        }
        /* eslint-disable-next-line no-continue */
        continue;
      }
      const id = f.split('\n')[0];
      /* eslint-disable-next-line no-continue */
      if (id !== hostID) continue;
      const portsFile = path.join(locatordir, d, 'addresses'); // todo: fake symlink
      /* eslint-disable-next-line no-await-in-loop */
      const data = await fs.promises.readFile(portsFile, { encoding: 'utf-8' });
      const addresses = data.split('\n').filter(address => address); // remove blank lines
      return addresses;
    }
    console.log(`unable to find addresses for HostID ${hostID}`);
    return [];
  }

  return createComms(myPeerInfo, getAddressesForHostID); // a promise
}

async function run(argv) {
  let basedir = '.';
  if (argv.basedir) {
    /* eslint-disable-next-line prefer-destructuring */
    basedir = argv.basedir;
    // else we must be run from a vat basedir
  }
  async function readBaseLine(fn) {
    const c = await fs.promises.readFile(path.join(basedir, fn), {
      encoding: 'utf-8',
    });
    return c.slice(0, c.indexOf('\n'));
  }
  async function readBaseFile(fn) {
    const c = await fs.promises.readFile(path.join(basedir, fn), {
      encoding: 'utf-8',
    });
    return c;
  }
  async function readBaseLines(fn) {
    const c = await fs.promises.readFile(path.join(basedir, fn), {
      encoding: 'utf-8',
    });
    return c.slice(0, c.lastIndexOf('\n')).split('\n');
  }

  const version = await readBaseLine('vat-version');
  if (version !== '1') {
    throw new Error(
      `I understand vat-version '1', but this basedir has '${version}'`,
    );
  }
  const myVatID = await readBaseLine('id');
  console.log(`myVatID ${myVatID}`);
  const myHostID = await readBaseLine('host-id');
  console.log(`myHostID ${myHostID}`);
  const myVatSecret = await readBaseLine('vat-secret');
  const rootSturdyRef = await readBaseLine('root-sturdyref');

  const s = makeRealm();
  const req = s.makeRequire({ '@agoric/nat': Nat, '@agoric/harden': true });

  // todo: how do we set encoding=utf-8 on an open()?
  const output = await fs.promises.open(
    path.join(basedir, 'output-transcript'),
    'w',
  );

  const locatordir = path.join(basedir, '..');
  const comms = await buildComms(
    myVatSecret,
    readBaseFile,
    readBaseLines,
    locatordir,
  );

  const vatEndowments = makeVatEndowments(s, req, output, comms);
  if (!(vatEndowments instanceof s.global.Object)) {
    throw new Error('vatEndowments must be in-Realm');
  }
  console.log('vatEndowments are', vatEndowments);
  const guestSource = await bundleCode(
    path.join(basedir, 'source', 'index.js'),
    true,
  );

  const v = await buildVat(
    s,
    req,
    myVatID,
    myVatSecret,
    myHostID,
    vatEndowments,
    guestSource,
  );
  const guestArgvJSON = await readBaseFile('argv.json');
  const guestArgv = await buildArgv(
    v,
    guestArgvJSON,
    readBaseFile,
    vatEndowments,
  );

  await v.initializeCode(rootSturdyRef, guestArgv);
  console.log(`rootSturdyRef: ${rootSturdyRef}`);

  // replay transcript to resume from previous state
  let ops = [];
  try {
    ops = await readBaseLines('input-transcript');
  } catch (ex) {
    console.log(`unable to read input-transcript, ignoring (${ex})`);
  }
  for (const op of ops) {
    // TODO: find turn boundaries, ignore all messages that might appear
    // after a turn boundary because that means we crashed while writing
    v.executeTranscriptLine(op);
  }
  v.startComms();

  // we fall off the edge here, but Node keeps running because there are
  // still open listening sockets
  console.log('run() finishing');
}

export async function main() {
  yargs
    .command(
      'create <basedir> <addr> <port>',
      'create a new Vat in BASEDIR',
      /* eslint-disable-next-line no-shadow */
      yargs => {
        yargs
          .positional('basedir', {
            describe: 'directory to create, must not already exist',
          })
          .positional('addr', {
            describe:
              'IP addr (not hostname) to advertise in BASEDIR/addresses, start with 127.0.0.1',
          })
          .positional('port', {
            describe: 'TCP port to listen on, choose something unique',
          })
          .coerce('addr', addr => {
            /* eslint-disable-next-line no-useless-escape */
            if (!/^[\d\.]+$/.test(addr)) {
              throw new Error(
                `addr=${addr} must be a dotted-quad numeric IP address, not a hostname`,
              );
            }
            // libp2p doesn't do hostname resolution, at least not the way
            // we're using it
            return addr;
          });
      },
      argv => create(argv),
    )
    .command(
      'run [basedir]',
      'run a Vat (in current directory, or from BASEDIR)',
      // shadowing style from yargs docs https://yargs.js.org/docs/#api-commandmodule
      /* eslint-disable-next-line no-shadow */
      yargs => {
        yargs.option('basedir', {
          describe: 'base directory, created by "vat create"',
        });
      },
      argv => run(argv),
    )
    .command(
      'convert-to-quorum <vatid> <vatsecret> [basedir]',
      'convert a Solo Vat (in current directory, or from BASEDIR) to the new Quorum VatID',
      /* eslint-disable-next-line no-shadow */
      yargs => {
        yargs
          .positional('vatid', {
            describe: 'new Quorum VatID',
          })
          .coerce('vatid', vatid => {
            if (!/^q(\d+)-/.test(vatid)) {
              throw new Error(
                `new vatid must start with 'qNN-', but is ${vatid}`,
              );
            }
            return vatid;
          })
          .positional('vatsecret', {
            describe: 'Quorum Vat secret, copy from LEADERDIR/vat-secret',
          })
          .option('basedir', {
            describe: 'base directory, created by "vat create"',
          });
      },
      argv => convertToQuorum(argv),
    )
    .command(
      '*',
      false,
      () => {},
      _argv => {
        console.log(
          'no subcommand specified, try "vat create", "vat run", or "vat convert-to-quorum"',
        );
      },
    )
    .parse();
}
