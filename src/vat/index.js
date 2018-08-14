// this file is evaluated in the SES realm and defines the Vat. It gets two
// endowments: 'module' (used to export everything) and 'log' (which wraps
// console.log). Both of these come from the primal realm, so they must not
// be exposed to guest code.

import Q from './nanoq';

const msgre = /^msg: (\w+)->(\w+) (.*)$/;

function confineGuestSource(source, endowments) {
  endowments = endowments || {};
  const exports = {};
  const module = { exports };
  function guestLog(...args) {
    log(...args);
  }
  const endow = { module, exports, log: guestLog };
  if (endowments) {
    Object.defineProperties(endow,
                            Object.getOwnPropertyDescriptors(endowments));
  }
  SES.confine(source, endow);
  return module.exports;
}


export function makeVat(endowments, myVatID, initialSource) {
  const { writeOutput } = endowments;

  // manually create an object that represents a Far reference, wire it up to
  // write some "message" to writeOutput() when invoked, and then let the
  // guest code invoke it. This object is a nanoq Q-style 'far' promise.

  const relay = {
    POST(_p, key, args) {
      writeOutput(`POST: ${key}, ${args}`);
    }
  };
  const ext = Q.makeFar(relay);

  const e = confineGuestSource(initialSource, { ext, Q });
  //writeOutput(`load: ${initialSourceHash}`);

  function processOp(op, resolver) {
    if (op === '') {
      log(`empty op`);
      return;
    }
    if (op.startsWith('load: ')) {
      const arg = /^load: (\w+)$/.exec(op)[1];
//      if (arg !== initialSourceHash) {
//        throw Error(`err: input says to load ${arg}, but we loaded ${initialSourceHash}`);
//      }
      log(`load matches, good`);
    } else if (op.startsWith('msg: ')) {
      const m = msgre.exec(op);
      const fromVat = m[1];
      const toVat = m[2];
      const bodyJson = m[3];
      log(`msg ${fromVat} ${toVat} (i am ${myVatID})`);
      if (toVat === myVatID) {
        writeOutput(op);
        const body = JSON.parse(bodyJson);
        log(`method ${body.method}`);
        const result = e[body.method](...body.args);
        if (resolver) {
          log('calling that resolver');
          resolver(result);
        }
      }
    } else {
      log(`unknown op: ${op}`);
    }
  }

  return {
    check() {
      log('yes check');
    },
    start(opTranscript) {
      const ops = opTranscript.split('\n');
      for(let op of ops) {
        processOp(op);
      }
    },

    opReceived(op, resolver) {
      log(`opReceived ${op}`);
      processOp(op, resolver);
    }
  };
}

