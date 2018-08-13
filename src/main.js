// ESM syntax is supported.
export {}

import fs from 'fs';
import crypto from 'crypto';

import yargs from 'yargs';

import SES from 'ses';

function confineFile(s, fn, endowments) {
  const source = fs.readFileSync(fn);
  const sourceHasher = crypto.createHash('sha256');
  sourceHasher.update(source);
  const sourceHash = sourceHasher.digest('hex');
  const module = {};
  function log(...args) {
    console.log(...args);
  }
  const endow = { module, log };
  if (endowments) {
    Object.defineProperties(endow, 
                            Object.getOwnPropertyDescriptors(endowments));
  }
  s.evaluate(source, endow);
  return { e: module.exports,
           hash: sourceHash };
}

function run(argv) {
  console.log(`run ${argv.source} ${argv.input} ${argv.output}`);
  const s = SES.makeSESRootRealm();
  const { e, hash: sourceHash } = confineFile(s, argv.source);

  const myVatID = argv.vatID;
  const ops = fs.readFileSync(argv.input).toString('utf8').split('\n');
  console.log(`ops is ${ops}`);
  const output = fs.openSync(argv.output, 'w');
  fs.writeSync(output, `load: ${sourceHash}\n`);

  const msgre = /^msg: (\w+)->(\w+) (.*)$/;
  for(let op of ops) {
    if (op === '') {
      continue;
    }
    if (op.startsWith('load: ')) {
      const arg = /^load: (\w+)$/.exec(op)[1];
      if (arg !== sourceHash) {
        throw Error(`err: input says to load ${arg}, but we loaded ${sourceHash} (from ${argv.source})`);
      }
      console.log(`load matches, good`);
    } else if (op.startsWith('msg: ')) {
      const m = msgre.exec(op);
      const fromVat = m[1];
      const toVat = m[2];
      const bodyJson = m[3];
      console.log(`msg ${fromVat} ${toVat}`);
      if (toVat === myVatID) {
        fs.writeSync(output, op);
        fs.writeSync(output, '\n');
        const body = JSON.parse(bodyJson);
        console.log(`method ${body.method}`);
        e[body.method](body.args);
      }
    } else {
      console.log(`unknown op: ${op}`);
    }
      
  }



  fs.closeSync(output);

}

export function main() {
  yargs
    .command('run [source]', 'run a service', (yargs) => {
      yargs.positional('source', {
        describe: 'initial object sourcefile',
      });
    }, (argv) => {
      run(argv);
    })
    .option('input', {})
    .option('output', {})
    .option('vatID', {})
    .argv;
}
