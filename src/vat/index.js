// this file is evaluated in the SES realm and defines the Vat. It gets two
// endowments: 'module' (used to export everything) and 'log' (which wraps
// console.log). Both of these come from the primal realm, so they must not
// be exposed to guest code.

import { makeWebkeyMarshal } from './webkey';
import { isVow, asVow, Flow, Vow } from '../flow/flowcomm';

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

  let localWebKeyCounter = 0;
  function makeLocalWebKey(localObject) {
    // We'll never see a Presence here, because they originate from other
    // Vats, so they're assigned a webkey on the way in. We'll never see a
    // farVow or remoteVow for the same reason.

    let count;

    // So if it's a Vow, it must be a LocalVow
    if (isVow(localObject)) {
      // we don't assign a new counter if we've seen the corresponding
      // presence before
      const p = getPresenceForVow(localObject);
      if (p) {
        count = p.count;
      } else {
        localWebKeyCounter += 1;
        count = localWebKeyCounter;
      }
      // this will appear as a farVow
      return def({type: 'farVow',
                  vatID: myVatID,
                  count: count});
    }

    // Otherwise, this must be a local object. We don't assign webkeys for
    // pass-by-copy objects, so this must be pass-by-presence, and will
    // appear on the far side as a Presence

    // we don't assign a new count if we've seen the corresponding Vow before
    TODODODODODO
    localWebKeyCounter += 1;
    return def({type: 'presence',
                vatID: myVatID,
                count: localWebKeyCounter});
  }


  let outbound;

  // fake implementations for now
/*
  function FarVow(vatID, count) {
    log(`new FarVow ${vatID} ${count}`);
    this.vatID = vatID;
    this.count = count;
    // v.e.NAME(ARGS) causes serialized sendOp or sendOnlyOp messages to be
    // sent to the target vat
    this.e = {};
    this.e.foo = function(...args) {
      log('e.foo called');
      // todo: without both passByCopy wrappers, this causes an infinite replacer() loop
      const argString = marshal.serialize(def({method: 'foo', args: args}));
      if (outbound) {
        outbound.push(`msg: ${myVatID}->${vatID} ${argString}\n`);
      }
    };
  }
*/
  const ext = new Flow().makeFarVow(vatIDToSerializer.get('v2'), 1);

  function Presence(vatID, count) {
    this.vatID = vatID;
    this.count = count;
    // Vow.resolve(p) on a Presence turns into a FarVow with the same values
  }

  const vatIDToSerializer = new Map();
  vatIDToSerializer.put('v2', { sendOp(count, op, args) {
    if (outbound) {
      const argString = marshal.serialize(def({method: op, args: args}));
      outbound.push(`msg: ${myVatID}->v2 ${argString}\n`);
    }
  } });

  function makeFarResourceMaker(serialize, unserialize) {
    function makeFarResource(webkey) {
      // receiving a pass-by-presence non-Vow object turns into a Presence
      const serializer = vatIDToSerializer.get(webkey.vatID);
      const p = def({});
      const v = new Flow().makeFarVow(serializer, webkey.count, p);
      // p and v should know about each other
      if (webkey.type === 'farVow') {
        return v;
      }
      if (webkey.type === 'presence') {
        return p;
      }
      throw new Error(`makeFarResource() unknown webkey ${webkey}`);
    }
    return makeFarResource;
  }

  const marshal = makeWebkeyMarshal(makeLocalWebKey, makeFarResourceMaker);
  // marshal.serialize, unserialize, serializeToWebkey, unserializeWebkey

  const e = confineGuestSource(initialSource,
                               { isVow, asVow, Flow, Vow,
                                 ext
                               });
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

    registerPush(p) {
      outbound = p;
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

