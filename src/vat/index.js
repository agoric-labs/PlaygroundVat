// this file is evaluated in the SES realm and defines the Vat. It gets two
// endowments: 'module' (used to export everything) and 'log' (which wraps
// console.log). Both of these come from the primal realm, so they must not
// be exposed to guest code.

import { isVow, asVow, Flow, Vow, makePresence, makeUnresolvedRemoteVow } from '../flow/flowcomm';
import { resolutionOf, handlerOf } from '../flow/flowcomm'; // todo unclean
import { makeRemoteManager } from './remotes';
import { makeEngine } from './executionEngine';

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

  // We have one serializer/deserializer for each locally-hosted Vat, so
  // it shared among all peer Vats.

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

  function managerWriteInput(senderVatID, seqnum, msg) {
    endowments.writeOutput(`msg: ${senderVatID}->${myVatID}[${seqnum}] ${msg}\n`);
  }
  function managerWriteOutput(targetVatID, seqnum, msg) {
    endowments.writeOutput(`msg: ${myVatID}->${targetVatID}[${seqnum}] ${msg}\n`);
  }
  const manager = makeRemoteManager(myVatID,
                                    managerWriteInput, managerWriteOutput);

  const engine = makeEngine(def,
                            Vow, isVow, Flow,
                            makePresence, makeUnresolvedRemoteVow,
                            handlerOf, resolutionOf,
                            myVatID,
                            manager);
  manager.setEngine(engine);
  const marshal = engine.marshal;

  // This is the host's interface to the Vat. It must act as a sort of
  // airlock: host objects passed into these functions should not be exposed
  // to other code, to avoid accidentally exposing primal-realm
  // Object/Function/etc.

  function buildSturdyRef(vatID, swissnum) {
    return `${vatID}/${swissnum}`;
  }

  function whatConnectionsDoYouWant() {
    return manager.whatConnectionsDoYouWant();
  }

  function connectionMade(hostID, connection) {
    log(`connectionMade for ${hostID}`);
    const c = {
      send(msg) {
        connection.send(msg);
      }
    };
    manager.gotConnection(`${hostID}`, c);
  }

  function connectionLost(hostID) {
    manager.lostConnection(`${hostID}`);
  }

  function commsReceived(hostID, line) {
    manager.commsReceived(`${hostID}`, `${line}`, marshal);
  }

  return {
    check() {
      log('yes check');
    },

    makeEmptyObject() {
      return {};
    },

    createPresence(sturdyref) {
      return engine.createPresence(sturdyref);
    },

    async initializeCode(rootSturdyRef, argv) {
      const refParts = rootSturdyRef.split('/');
      const refVatID = refParts[0];
      const rootSwissnum = refParts[1];
      if (refParts[0] !== myVatID) {
        throw new Error(`vatID mismatch:\n${myVatID} is my vatID, but saved rootSturdyRef uses\n${refVatID}`);
      }
      //endowments.writeOutput(`load: ${initialSourceHash}`);
      // the top-level code executes now, during evaluation
      const e = confineGuestSource(initialSource,
                                   { isVow, asVow, Flow, Vow,
                                     ext: engine.ext,
                                   }).default;
      // then we execute whatever was exported as the 'default'
      const root = await Vow.resolve().then(_ => e(argv));
      // we wait for that to resolve before executing the transcript
      if (root) {
        // we register this, but nobody is waiting on it yet, so we don't
        // have to tell registerTarget a vat to notify when it resolves
        engine.registerTarget(root, rootSwissnum);
      }
      return root; // for testing
    },

    whatConnectionsDoYouWant,
    connectionMade,
    connectionLost,
    commsReceived,

    serialize(val, targetVatID) {
      return engine.serialize(val, targetVatID);
    },

    doSendOnly(bodyJson) {
      return engine.rxSendOnly(bodyJson);
    },

    debugRxMessage(senderVatID, seqnum, bodyJson) {
      managerWriteInput(senderVatID, seqnum, bodyJson);
      return engine.rxMessage(senderVatID, bodyJson);
    },

    executeTranscriptLine(line) {
      log(`executeTranscriptLine '${line}'`);
      if (line === '') {
        //log(`empty line`);
        return;
      }
      if (line.startsWith('load: ')) {
        const arg = /^load: (\w+)$/.exec(line)[1];
        //      if (arg !== initialSourceHash) {
        //        throw Error(`err: input says to load ${arg}, but we loaded ${initialSourceHash}`);
        //      }
        log(`load matches, good`);
      } else if (line.startsWith('msg: ')) {
        const m = msgre.exec(line);
        const fromVat = m[1];
        const toVat = m[2];
        const bodyJson = m[3];
        log(`transcript msg ${fromVat} ${toVat} (i am ${myVatID})`);
        if (toVat === myVatID) {
          //endowments.writeOutput(line);
          commsReceived(fromVat, bodyJson);
        }
      } else {
        log(`unknown line: ${line}`);
      }
    },

    /*
    sendReceived(op, sourceVatID, resultSwissbase) {
      // returns a promise
      log(`sendReceived ${op}`);
      const result = processOp(op);
      Vow.resolve(result).then(r => serializer.sendResolve(sourceVatID, resultSwissnum, marshal.serialize(r)));
      let resolver;
      const p = f.makeVow((resolve, reject) => resolver = resolve);
      processOp(op, resolver);
      return p;
    }*/
  };
}

