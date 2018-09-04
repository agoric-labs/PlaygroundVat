// this defines the endowments that live in the primal realm and may be
// granted to the Vat host

import fs from 'fs';
import crypto from 'crypto';
import process from 'process';

export function makeVatEndowments(argv, output) {
  return {
    writeOutput(s) {
      output.write(s);
      output.write('\n');
    },

    exit(rc, message) {
      if (message) {
        console.log(`process exiting (rc=${rc}): ${message}`);
      } else {
        console.log(`process exiting (rc=${rc})`);
      }
      try {
        process.exit(rc);
        // do not allow exceptions in process.exit (e.g. if 'rc' is not a
        // number) to escape back to the caller
      } catch (ex) {
        process.exit(1);
      }
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

