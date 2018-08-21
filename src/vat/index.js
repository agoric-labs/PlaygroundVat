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

  // A FarVow (specifically a Vow in the 'far' state) can be used to send
  // remote messages: v.e.foo(1,2) will queue an invocation of
  // target.foo(1,2) on whatever target object the vow eventually resolves
  // to. Each Vow (including FarVows) have their own identity: creating two
  // (resolved) Vows from the same object will yield entirely different Vows.
  // So if you have two Vows and want to ask if they point at the same thing,
  // you must use .then() to wait until they resolve, and then compare the
  // resolutions instead.

  // A Presence represents a specific remote object (on a specific Vat). You
  // get one by calling .then() on a some Vow (other than a NearVow, which
  // will resolve to local object, or a BrokenVows, which resolves to an
  // error), and then waiting until the callback fires. Presences can be
  // compared for EQ, but you can't send messages on them. To send messages,
  // turn the Presence into a FarVow by using Vow.resolve(p) .

  // Vow states:
  // * near: resolved, points to a local object
  // * far: resolved, points to an object on some other vat
  // * local: unresolved, no idea what it will resolve to
  // * remote: unresolved, but some other vat has a LocalVow that is a better
  //   place to queue messages than us
  // * broken

  // Vow transfers:
  // * sending a pass-by-reference object results in a Presence. Sending that
  //   Presence elsewhere results in another Presence. Sending a Presence to
  //   its home vat results in the original object reference (EQ to the
  //   starting point)
  // * sending a NearVow results in a FarVow. Sending that FarVow elsewhere
  //   results in another FarVow. Sending a FarVow to its home vat results in
  //   a new NearVow (not EQ to the original): using .then() on both will
  //   yield the same object.
  // * sending a LocalVow results in a RemoteVow. Sending that RemoteVow
  //   elsewhere is currently an error. Sending that RemoteVow to its home
  //   vat is currently an error. (ideally sending it elsewhere yields a
  //   RemoteVow, and sending it back home results in the original LocalVow,
  //   but it isn't clear how hard this might be)

  // makeFarResource() will be asked to deal with local pass-by-reference
  // objects, NearVows, LocalVows, and BrokenVows. It does not need to handle
  // FarVows or Presences because those were created by the comms layer while
  // processing an inbound message. It does not handle RemoteVows for the
  // same reason.

  // When sending a NearVow, the comms layer will need to know the resolution
  // object, so it can assign a swissnum that can be used by the receiving
  // side to build a Presence that points to the same object. This will
  // always occur in the context of an outbound message, when the FarHandler
  // delivers the (op, args) event to the comms layer. We put an extra
  // argument into this function call to give the comms layer a way to ask
  // about NearVow->object mappings.

  // Presences, FarVows, and RemoteVows arrive as webkeys with (vatid,
  // swissnum, type). 'type' is either 'presence', 'farvow', or 'remotevow'.

  // We currently define three operations: Send(targetID, op, args,
  // resolverID), SendOnly(targetID, op, args), and Resolve(resolverID, val).

  // Each side of a pairwise comms connection maintains a "resolution table",
  // mapping a resolutionID to a Resolver that should be invoked upon receipt
  // of a Resolve() operation. In practice there will be one table for the
  // whole comms layer, but it is indexed by (peerVatID, resolutionID).
  // Inbound Resolve() operations *from* VatA may only access rows with
  // peerVatID==VatA. This requires the transport layer to reliably indicate
  // the origin of an inbound connection.

  // When an object in VatA does y = b.foo(), y is a new LocalVow created by
  // the comms layer (ish). The comms layer allocates a random unguessable
  // resolverID and puts the new resolver into the resolution table, and
  // includes the resolverID in the Send() operation. The receiver
  // deserializes the arguments, looks up the target, invokes the named
  // operation, and inspects the result. If the result is an immediate value,
  // it sends (really it queues until after checkpoint) a Resolve() operation
  // with the resolverID and value. If the result is a Promise, it attaches a
  // .then() callback to do the same.

  // if an object in VatA has a LocalVow 'x' (todo: maybe of any type) and
  // includes it as an argument like b.foo(x), then the comms layer assigns a
  // new swissnum (if 'x' has not been sent anywhere before). It attaches a
  // .then() callback to the object, so when that fires in the future, it
  // sends a Resolve(swissnum, val) operation to the remote side. When the
  // receiver deserializes the argument into a RemoteVow, it adds the
  // swissnum into its resolution table.

  // The resolution table thus contains rows allocated by the local side
  // (when sending a resolver, in the specific case of a message-send that is
  // not a SendOnly), and rows allocated by the far side (when receiving a
  // RemoteVow).

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
    function makeFarResource(webkey, webkeyString2val, val2webkey) {
      // receiving a pass-by-presence non-Vow object turns into a Presence
      const serializer = vatIDToSerializer.get(webkey.vatID);

      function getPresenceOrLocalObject(vatid, swissnum) {
        const localWebkey = { type: 'presence',
                              vatid: webkey.vatid,
                              swissnum: webkey.swissnum };
        const localWebkeyString = JSON.serialize(localWebkey);
        const local = webkeyString2val.get(localWebkeyString);
        if (vatid === myVatID) {
          // must be a local object
          if (!local) {
            throw new Error(`got 'presence' for my VatID but I don't recognize the swissnum`);
          }
          return local;
        }
        // might be a Presence pointing to a remote one
        if (!local) {
          let presence = def({});
          webkeyString2val.set(localWebkeyString, presence);
          return presence;
        }
        return local;
      }

      if (webkey.type === 'presence') {
        return getPresenceOrLocalObject(webkey.vatid, webkey.swissnum);
      }

      if (webkey.type === 'farvow') {
        // pretend we got the 'presence' message, then Vow the result. We'll
        // either get a Presence or a local object that we sent earlier
        const local = getPresenceOrLocalObject(webkey.vatid, webkey.swissnum);
        return Vow.makeFarVow(serializer, webkey.swissnum, local);
      }

      // todo: we rely upon consistent JSON serialization here
      const webkeyString = JSON.serialize(webkey);
      if (webkeyString2val.has(webkeyString)) {
        return webkeyString2val.get(webkeyString);
      }

      if (webkey.type === 'remotevow') {
        // todo: for now we make a FarVow. We'll want to make a new
        // RemoteHandler for these so it's clear they aren't resolved yet
        unimplemented;

      }

      // make the new thing


      webkeyString2val.set(webkeyString, val);
      val2webkey.set(val, webkey);

      return val;
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

