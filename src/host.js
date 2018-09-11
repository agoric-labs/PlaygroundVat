// this defines the endowments that live in the primal realm and may be
// granted to the Vat host. It is the "airlock" or Membrane that sits between
// the primal realm and the SES realm, specialized for the specific
// interactions and APIs that must be supported. It enforces some types
// (basically just strings), and uses eventual-sends to prevent plan
// interference (as well as hiding exception constructors by hiding the
// exceptions entirely).

import fs from 'fs';
import crypto from 'crypto';
import process from 'process';

export function makeVatEndowments(s, output, comms) {
  const power = { // made available to build()
    comms,
    output,
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

  function build(power, log) {
    function eventually(f) {
      Promise.resolve().then(_ => f());
    }
    return def({
      comms: {
        registerManager(m) { // m is SES
          // the manager will be called with connectionMade, commsReceived,
          // and connectionLost
          const wrappedManager = def({
            connectionMade(hostID, c) { // c is Primal
              // the Connection has a send() method
              const wrappedConnection = def({ // wrappedConnection is SES
                send(msg) {
                  c.send(`${msg}`);
                }
              });
              eventually(_ => m.connectionMade(`${hostID}`, wrappedConnection));
            },
            // hostID and line are supposed to be strings, which are
            // primitives so they don't belong to any particular realm, but
            // stringify them to be sure
            commsReceived(hostID, line) { // hostID+line are Primal
              eventually(_ => m.commsReceived(`${hostID}`, `${line}`));
            },
            connectionLost(hostID) { // hostID is Primal
              eventually(_ => m.connectionLost(`${hostID}`));
            },
          });
          eventually(_ => power.comms.registerManager(wrappedManager));
        },
        start() {
          eventually(_ => power.comms.start());
        },
        wantConnection(hostID) { // hostID is SES
          // wantConnection will be called early, when we process the input
          // transcript, before comms have started. The Remote Manager will
          // use a Vow to defer delivery of these messages until comms are
          // ready.
          eventually(_ => power.comms.wantConnection(`${hostID}`));
        },
      },
      writeOutput(s) {
        power.output.write(s);
        power.output.write('\n');
      },
      exit(rc, message) {
        power.exit(rc, message);
      },
    });
  }

  function log(...args) {
    console.log(...args);
  }
  return s.evaluate(`(${build})`)(power, log);
}

export function readAndHashFile(fn) {
  const source = fs.readFileSync(fn);
  const sourceHasher = crypto.createHash('sha256');
  sourceHasher.update(source);
  const sourceHash = sourceHasher.digest('hex');
  return { source, sourceHash };
}

