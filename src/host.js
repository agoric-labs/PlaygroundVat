// this defines the endowments that live in the primal realm and are granted
// to the Vat host

import fs from 'fs';
import crypto from 'crypto';

export function makeVatEndowments(argv, output) {
  return {
    writeOutput(s) {
      fs.writeSync(output, s);
      fs.writeSync(output, '\n');
    },

  };
}

export function readAndHashFile(fn) {
  const source = fs.readFileSync(fn);
  const sourceHasher = crypto.createHash('sha256');
  sourceHasher.update(source);
  const sourceHash = sourceHasher.digest('hex');
  return { source, sourceHash };
}

