// this file is evaluated in the SES realm and defines the Vat. It gets two
// endowments: 'module' (used to export everything) and 'log' (which wraps
// console.log). Both of these come from the primal realm, so they must not
// be exposed to guest code.

import { makeWebkeyMarshal } from './webkey';
import { isVow, asVow, Flow, Vow } from '../flow/flowcomm';

const msgre = /^msg: (\w+)->(\w+) (.*)$/;

function insist(condition, exception) {
  if (!condition) {
    throw exception;
  }
}

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

function Presence(vatID, swissnum) {
  this.vatID = vatID;
  this.swissnum = swissnum;
  // Vow.resolve(p) on a Presence turns into a FarVow with the same values
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

  // We have one serializer/deserializer for each locally-hosted Vat, so
  // it shared among all peer Vats.

  let localWebKeyCounter = 0;
  function allocateSwissnum() {
    localWebKeyCounter += 1;
    const swissnum = localWebKeyCounter; // todo: random, of course
    return swissnum;
  }

  function makeLocalWebKey(val, val2webkey, webkeyString2val, resolutionOf) {
    // We are responsible for serializing (or finding previous serializations
    // of) all pass-by-presence objects, and maintaining the bidirectional
    // tables we share with the deserializer. There are seven categories. The
    // first two are not Vows (but can be obtained from Vows by using a
    // .then() callback):
    //
    // | resolved? | home   | .then()  | webkey.type |
    // |-----------+--------+----------+-------------|
    // | yes       | local  | object   | presence    |
    // | yes       | remote | Presence | presence    |
    //
    // Local objects might already be in the table (if we sent them earlier),
    // but if not we must assign them a swissnum and deliver them as a
    // "presence" webkey, which will appear on the remote side as a Presence
    // object. All local Presences got here from somewhere else (either as a
    // Presence or a FarVow), so they were created by our deserializer, so
    // they will already be in the table, and we should use the webkey from
    // there.

    if (val2webkey.has(val)) {
      // this covers previously-serialized regular objects, all Presences,
      // and all Vows in the FarVow and RemoteVow states.
      return val2webkey.get(val);
    }

    function allocateWebkey(type, obj) {
      // webkeys must be JSON-serializable so we can use it as a lookup key
      // in the map
      const webkey = { type: type,
                       vatID: myVatID,
                       swissnum: allocateSwissnum() };
      // todo: we rely upon consistent JSON here, is that guaranteed?
      const webkeyString = JSON.serialize(webkey);
      val2webkey.set(obj, webkey);
      webkeyString2val.set(webkeyString, obj);
      return webkey;
    }

    function nearVowForPresence(wk) {
      insist(wk.type === 'presence', "resolution wasn't a presence");
      return { type: 'resolved vow',
               vatid: wk.vatid,
               swissnum: wk.swissnum };
    }

    if (!isVow(val)) {
      // must be a regular object that we haven't serialized before
      return allocateWebkey('presence', val);
    }

    // It must be a Vow.

    // Vows can be in one of five states:

    // | resolved? | home   | Vow.resolve | webkey.type    | resolutionOf() |
    // |-----------+--------+-------------+----------------+----------------|
    // | yes       | local  | NearVow     | resolved vow   | object         |
    // | yes       | remote | FarVow      | resolved vow   | Presence       |
    // | no        | local  | LocalVow    | unresolved vow |                |
    // | no        | remote | RemoteVow   | unresolved vow |                |
    // | yes       | broken | BrokenVow   | broken vow     |                |

    // We have private access to the Vow resolutionOf() function, which will
    // tell us (immediately) whether a given Vow has already been resolved,
    // and to what. We use this to find NearVows/FarVows, and use their
    // underlying object/Presense for serialization.

    // Vows with a remote "home" (FarVow and RemoteVow) were created by our
    // deserializer, like Presences. However we don't store FarVows in the
    // table: we only store the associated Presence. If we're asked to
    // serialize a FarVow, we use resolutionOf() to get the Presence, look up
    // the Presence in the table (which must already be present), extract the
    // vatid and swissnum, and build a "resolved vow" webkey around those
    // values. On the way in, if we receive a "resolved vow" webkey for a
    // different vat, we create and store a Presence in the table, then
    // deliver a FarVow to the target.

    // TODO: BrokenVow. Maybe add rejectionOf() helper?

    const r = resolutionOf(val);
    if (r) {
      // Must be NearVow or FarVow. If it was a FarVow, 'r' will be a
      // Presence, which will be in the table. If it was a NearVow, then 'r'
      // will be a local object, which may or may not already be in the table
      // (but will have type 'presence' if it is).
      const wk = val2webkey.get(r);
      if (wk) {
        // send the corresponding "resolved vow" webkey
        return nearVowForPresence(wk);
      }
      // must be NearVow, and we've never sent either the NearVow nor the
      // underlying object

      const webkey = allocateWebkey('presence', val);
      return nearVowForPresence(webkey);
    }

    // must be a LocalVow that has never been sent before
    return allocateWebkey('unresolved vow', val);

    // TODO: not sure this table is accurate anymore
    // | sending this   | arrives on other vat as | or on home vat as |
    // |----------------+-------------------------+-------------------|
    // | regular object | Presence                | original object   |
    // | NearVow        | FarVow                  | original NearVow  |
    // | BrokenVow      | BrokenVow               | BrokenVow         |
    // | Presence       | Presence                | original object   |
    // | FarVow         | FarVow                  | NearVow           |
    // | LocalVow       | RemoteVow               | original LocalVow |
    // | RemoteVow      | RemoteVow               | original LocalVow |
  }


  let outbound;

  // A FarVow (specifically a Vow in the 'far' state) can be used to send
  // remote messages: v.e.foo(1,2) will queue an invocation of
  // target.foo(1,2) on whatever target object the vow eventually resolves
  // to. Each Vow (including FarVows) have their own identity: creating two
  // (resolved) Vows from the same object will yield entirely different Vows.
  // So if you have two Vows and want to ask if they point at the same thing,
  // you must use .then(), wait for the callback to fire with a Presence,
  // then compare the Presences instead. This callback will fire on a
  // subsequent turn without doing network IO, since FarVows are already
  // resolved (unlike RemoteVows or LocalVows).

  // A Presence represents a specific remote object (on a specific Vat). You
  // get one by calling .then() on a some Vow (other than a NearVow, which
  // will resolve to local object, or a BrokenVow, which resolves to an
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

  // When sending a NearVow, the comms layer will need to know the resolution
  // object, so it can assign a swissnum that can be used by the receiving
  // side to build a Presence that points to the same object. This will
  // always occur in the context of an outbound message, when the FarHandler
  // delivers the (op, args) event to the comms layer. We put an extra
  // argument into this function call to give the comms layer a way to ask
  // about NearVow->object mappings.


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

  const vatIDToSerializer = new Map();

  const ext = new Flow().makeFarVow(vatIDToSerializer.get('v2'),
                                    { vatID: 'v2', swissnum: 'swiss1' },
                                    new Presence('v2', 'swiss1'));

  vatIDToSerializer.set('v2', { sendOp(count, op, args) {
    if (outbound) {
      const argString = marshal.serialize(def({method: op, args: args}));
      outbound.push(`msg: ${myVatID}->v2 ${argString}\n`);
    }
  } });

  function makeFarResourceMaker(serialize, unserialize) {
    function makeFarResource(webkey, webkeyString2val, val2webkey) {
      // receiving a pass-by-presence non-Vow object turns into a Presence
      const serializer = vatIDToSerializer.get(webkey.vatID);

      // todo: we rely upon consistent JSON serialization here
      const webkeyString = JSON.serialize(webkey);
      if (webkeyString2val.has(webkeyString)) {
        // This covers previously-sent LocalVows, previously-sent regular
        // objects, and the regular objects referenced by previously-sent
        // NearVows.
        //
        // It also covers previously-received Presences, ...
        return webkeyString2val.get(webkeyString);
      }

      insist(webkey.vatid !== myVatID, "I don't remember sending this");

      // we return 'val', but we store 'cacheVal' in the table under
      // 'cacheWebkey'.
      let val, cacheWebkey, cacheVal;

      if (webkey.type === 'presence') {
        // must live somewhere else, as we don't remember sending it
        val = new Presence(webkey.vatid, webkey.swissnum);
        cacheWebkey = webkey;
        cacheVal = val;
      } else if (webkey.type === 'resolved vow') {
        // must live somewhere else (FarVow), since we don't remember sending
        // it. Create a Presence, add it to the table, then deliver a FarVow
        cacheVal = new Presence(webkey.vatid, webkey.swissnum);
        const cacheWebkey = {
          type: 'presence',
          vatID: webkey.vatID,
          swissnum: webkey.swissnum };
        val = new Flow().makeFarVow(serializer, webkey.swissnum, cacheVal);
      } else if (webkey.type === 'unresolved vow') {
        // must live somewhere else (RemoteVow)
        // todo: we make a normal Vow for now, but for pipelining we want a
        // specialized form that can be told about non-resolving forwarding
        val = new Flow().makeVow(XXX);
        cacheVal = val;
        cacheWebkey = webkey;
      } else {
        throw new Error(`makeFarResource() unknown webkey ${webkey}`);
      }

      const cacheWebkeyString = JSON.serialize(cacheWebkey);
      webkeyString2val.set(cacheWebkeyString, cacheVal);
      val2webkey.set(cacheVal, cacheWebkey);

      return val;
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
        //Vow.resolve(result).then(r => comms.sendResolve(sourceVatID, swissnum, marshal.serialize(r));
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

