// this file is evaluated in the SES realm and defines the Vat. It gets two
// endowments: 'module' (used to export everything) and 'log' (which wraps
// console.log). Both of these come from the primal realm, so they must not
// be exposed to guest code.

import { makeWebkeyMarshal } from './webkey';
import Flow from '../flow/flowcomm';

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
  //const ext = Q.makeFar(relay);

  let localWebKeyCounter = 0;
  function makeLocalWebKey(localObject) {
    localWebKeyCounter += 1;
    return `wk${localWebKeyCounter}`;
  }

  function makeFarResourceMaker(serialize, unserialize) {
    function makeFarResource(webkey) {
      return { farref: webkey };
    }
    return makeFarResource;
  }

  const marshal = makeWebkeyMarshal(makeLocalWebKey, makeFarResourceMaker);
  // marshal.serialize, unserialize, serializeToWebkey, unserializeWebkey

  const e = confineGuestSource(initialSource, { Flow });
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
        const body = marshal.unserialize(bodyJson);
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

  const f = new Flow();

  return {
    check() {
      log('yes check');
    },

    sendOnlyReceived(op) {
      log(`sendOnlyReceived ${op}`);
      processOp(op);
    },

    sendReceived(op) {
      // returns a promise
      log(`sendReceived ${op}`);
      let resolver;
      const p = f.makeVow((resolve, reject) => resolver = resolve);
      processOp(op, resolver);
      return p;
    }
  };
}

