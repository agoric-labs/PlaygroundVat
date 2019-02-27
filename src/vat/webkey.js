/* global BigInt */

/* eslint-disable-next-line import/no-extraneous-dependencies */
import harden from '@agoric/harden';
import { makeSwissnum, makeSwissbase, doSwissHashing } from './swissCrypto';
import { isVow, makePresence, makeUnresolvedRemoteVow } from '../flow/flowcomm';

// objects can only be passed in one of two/three forms:
// 1: pass-by-presence: all properties (own and inherited) are methods,
//    the object itself is of type object, not function
// 2: pass-by-copy: all string-named own properties are data, not methods
//    the object must inherit from Object.prototype or null
// 3: the empty object is pass-by-presence, for identity comparison

// todo: maybe rename pass-by-presence to pass-as-presence, or pass-by-proxy
// or remote reference

// all objects must be frozen

// anything else will throw an error if you try to serialize it

// with these restrictions, our remote call/copy protocols expose all useful
// behavior of these objects: pass-by-presence objects have no other data (so
// there's nothing else to copy), and pass-by-copy objects have no other
// behavior (so there's nothing else to invoke)

function canPassByCopy(val) {
  if (!Object.isFrozen(val)) {
    return false;
  }
  if (typeof val !== 'object') {
    return false;
  }
  const names = Object.getOwnPropertyNames(val);
  const hasFunction = names.some(name => typeof val[name] === 'function');
  if (hasFunction) return false;
  const p = Object.getPrototypeOf(val);
  if (p !== null && p !== Object.prototype && p !== Array.prototype) {
    // todo: arrays should also be Array.isArray(val)
    return false;
  }
  if (names.length === 0) {
    // empty objects are pass-by-presence, not pass-by-copy
    return false;
  }
  return true;
}

function mustPassByPresence(val) {
  // throws exception if cannot
  if (!Object.isFrozen(val)) {
    throw new Error(`cannot serialize non-frozen objects like ${val}`);
  }
  if (typeof val !== 'object') {
    throw new Error(`cannot serialize non-objects like ${val}`);
  }

  const names = Object.getOwnPropertyNames(val);
  names.forEach(name => {
    if (name === 'e') {
      // hack to allow Vows to pass-by-presence
      return;
    }
    if (typeof val[name] !== 'function') {
      throw new Error(
        `cannot serialize objects with non-methods like the .${name} in ${val}`,
      );
      // return false;
    }
  });

  const p = Object.getPrototypeOf(val);
  if (p !== null && p !== Object.prototype) {
    mustPassByPresence(p);
  }
  // ok!
}

// Special property name that indicates an encoding that needs special
// decoding.
const QCLASS = '@qclass';

export function makeEngine(
  hash58,
  Vow,
  myVatID,
  myVatSecret,
  manager,
) {

  function makePair() {
    let r;
    const v = new Vow(r0 => r = r0);
    return {v, r};
  }

  const { makePresence, makeRemote, shorten } = Vow.makeHook();

  // we remember:
  // * RemoteVows we created
  // * FarVows we created
  // * objects that our FarVow/RemoteVows have been resolved to

  // categories of things to serialize
  // known
  //  previous pass-by-presence
  //  previous local Vow
  //  inbound Presence (we make these and remember them)
  //  inbound FarVow (ditto)
  //  inbound RemoteVow (ditto)
  // pass-by-value
  // local pass-by-presence


  // val2Serialized tracks every vow and presence we receive, and every vow
  // and presence we send. It maps them to the serialization we were given,
  // or generated. It also tracks the "answer" vows we create on behalf of
  // the target of an opSend (to hold their result), since we decide the
  // serialization of that vow. For FarVow/Presence pairs we receive, each
  // has a separate entry.
  const val2Serialized = new WeakMap();

  // webkey2Vow is only used for inbound vows
  const webkey2Vow = new Map();

  // webkey2Presence is only used for inbound presences
  const webkey2Presence = new Map();

  // this is used for inbound Vows, to track the resolver we created for
  // them. We delete this once the Vow is resolved (opResolve is call-once).
  const webkey2Resolver = new Map();

  let swissCounter = 0;
  function allocateSwissnum() {
    swissCounter += 1;
    return makeSwissnum(myVatSecret, swissCounter, hash58);
  }

  function allocateSwissbase() {
    swissCounter += 1;
    return makeSwissbase(myVatSecret, swissCounter, hash58);
  }

  function makeWebkey(data) {
    // todo: use a cheaper (but still safe/reversible) combiner
    return JSON.stringify({ vatID: data.vatID, swissnum: data.swissnum });
  }

  function serializeVowData(vatID, swissnum) {
    return harden({
      [QCLASS]: 'vow',
      vatID: vatID,
      swissnum,
    });
  }

  function serializePresenceData(vatID, swissnum) {
    return harden({
      [QCLASS]: 'presence',
      vatID: vatID,
      swissnum,
    });
  }

  function serializePassByPresence(val, swissnum = undefined) {
    // we are responsible for new serialization of pass-by-presence objects

    // since we're using webkeys, we serialize everything identically
    // regardless of which toVatID we're sending it to. This will change when
    // we switch to c-lists. We'll need to keep track of inbound Vows
    // independently of their serialized representation, and remember which
    // Vat they came from, so we know whether to use their c-list index, or a
    // three-party handoff.

    if (typeof swissnum === 'undefined') {
      swissnum = allocateSwissnum();
    }

    let table, serialized;
    if (isVow(val)) {
      // This must be a new Local Vow (if it were remote, it would have been
      // added to our table upon receipt, and we wouldn't get here) (and if
      // we'd already serialized it once, it would also be in the table). We
      // must allocate a new swissnum.
      table = webkey2Vow;
      serialized = serializeVowData(myVatID, swissnum);
    } else {
      // This must be a new local pass-by-presence object
      table = webkey2Presence;
      serialized = serializePresenceData(myVatID, swissnum);
    }

    const key = makeWebkey({ vatID: myVatID, swissnum });
    // console.log(`assigning key ${key}`);

    val2Serialized.set(val, serialized);
    table.set(key, val);
    return serialized;
  }

  function makeReplacer() {
    const ibidMap = new Map();
    let ibidCount = 0;

    return function replacer(_, val) {
      // First we handle all primitives. Some can be represented directly as
      // JSON, and some must be encoded as [QCLASS] composites.
      switch (typeof val) {
        case 'object': {
          if (val === null) {
            return null;
          }
          if (!Object.isFrozen(val)) {
            console.log(
              'asked to serialize',
              val,
              typeof val,
              Object.isFrozen(val),
            );
            throw new Error(
              `non-frozen objects like ${val} are disabled for now`,
            );
          }
          break;
        }
        case 'function': {
          throw new Error(`bare functions like ${val} are disabled for now`);
        }
        case 'undefined': {
          return harden({ [QCLASS]: 'undefined' });
        }
        case 'string':
        case 'boolean': {
          return val;
        }
        case 'number': {
          if (Number.isNaN(val)) {
            return harden({ [QCLASS]: 'NaN' });
          }
          if (Object.is(val, -0)) {
            return harden({ [QCLASS]: '-0' });
          }
          if (val === Infinity) {
            return harden({ [QCLASS]: 'Infinity' });
          }
          if (val === -Infinity) {
            return harden({ [QCLASS]: '-Infinity' });
          }
          return val;
        }
        case 'symbol': {
          const optKey = Symbol.keyFor(val);
          if (optKey === undefined) {
            // TODO: Symmetric unguessable identity
            throw new TypeError('Cannot serialize unregistered symbol');
          }
          return harden({
            [QCLASS]: 'symbol',
            key: optKey,
          });
        }
        case 'bigint': {
          return harden({
            [QCLASS]: 'bigint',
            digits: String(val),
          });
        }
        default: {
          // TODO non-std exotic objects are allowed other typeofs.
          // Perhaps a warning and break would be better.
          throw new TypeError(`unrecognized typeof ${typeof val}`);
        }
      }

      // Now that we've handled all the primitives, it is time to deal with
      // objects. The only things which can pass this point are frozen and
      // non-null.

      if (QCLASS in val) {
        // TODO Hilbert hotel
        throw new Error(`property "${QCLASS}" reserved`);
      }

      // if we've seen this object before, serialize a backref

      if (ibidMap.has(val)) {
        throw new Error('ibid disabled for now');
        // Backreference to prior occurrence
        // return harden({
        //   [QCLASS]: 'ibid',
        //   index: ibidMap.get(val),
        // });
      }
      ibidMap.set(val, ibidCount);
      ibidCount += 1;

      // if we've serialized it before, or if it arrived from the outside
      // (and is thus in the table), use the previous serialization
      if (val2Serialized.has(val)) {
        return val2Serialized.get(val);
      }

      // We can serialize some things as plain pass-by-copy: arrays, and
      // objects with one or more data properties but no method properties.

      // todo: handle this properly, by constructing a @qclass: error
      if (val instanceof Error) {
        console.log('cannot yet serialize Errors correctly', val);
        console.log('stack was:', val);
        throw new Error('cannot yet serialize Errors correctly');
      }

      if (canPassByCopy(val)) {
        // console.log(`canPassByCopy: ${val}`);
        // Purposely in-band for readability, but creates need for
        // Hilbert hotel.
        return val;
      }

      // The remaining objects are pass-by-reference. This includes Vows,
      // Presences, and objects with method properties (we reject entirely
      // hybrid objects that have both data and method properties). The empty
      // object is pass-by-reference because it is useful to compare its
      // identity.

      mustPassByPresence(val);
      // console.log(`mustPassByPresence: ${val}`);

      // todo: we might have redundantly done an isFrozen test above, but
      // it's safer than forgetting to do it for the other cases.

      // makeLocalWebkey() is entirely responsible for figuring out how to
      // serialize pass-by-reference objects, including cache/table
      // management

      return serializePassByPresence(val);
    };
  }

  // type suffixes:
  //  -Data: {vatID, swissnum}
  //  -WebKey: a "webkey" string, JSON.stringify({vatID, swissnum})
  //  -Serialized: a "qclass" object, { "@qclass": type, vatID, swissnum }
  //               created by serializeVowData/serializePresenceData/replacer

  // FarVows and Presences are created in pairs. We remember the Presence in
  // a table which maps it to a serialization of {'@qclass': 'presence',
  // vatID, swissnum}. The FarVow (which can only be obtained with
  // presence.then) would be serialized like any other Vow.

  function makeRemoteVowHandler(targetData) {
    return harden({
      call(op, name, args) {
        if (op === 'post') {
          // create a synthetic RemoteVow, as if we'd received swissnum from
          // targetvat. We register it with the comms tables so that when the
          // other end sends their {type:'resolve'} message, it will cause
          // this resultVow to resolve, and any queued messages we put into
          // it will be delivered. We choose the swissnum because we're
          // allocating the object, but we do it with a swissbase so we can't
          // deliberately collide with anything currently allocated on the
          // other end

          const { swissnum: answerSwissnum,
                  swissbase: answerSwissbase } = allocateSwissStuff();
          const answerData = { vatID: targetData.vatID,
                               swissnum: answerSwissnum };
          const answerWebKey = makeWebkey(answerData);
          const answerSerialized = serializeVowData(answerData.vatID,
                                                    answerSwissnum);

          const handler = makeRemoteVowHandler(answerWebKey, flow);
          const {p, r} = makePair();
          const answerVow = makeRemote(handler, p);

          // Make sure we can send the answerVow elsewhere. This would
          // normally happen when the Vow was sent or received as an argument
          // or a return value, but answerVow is synthetic: the target does
          // not send it to us, we merely pretend they sent it to us. So we
          // must do all the same registration ourselves.
          val2Serialized.set(answerVow, answerSerialized);

          // this prepares for the case where we send our answerVow
          // elsewhere, then someone references it in a message to us
          webkey2Vow.set(answerWebKey, answerVow);

          // This prepares for the target to resolve our answerVow. It is
          // safe to use the same webkey for both Vow and resolver because we
          // only accept opResolve for Vows owned by the sender.
          webkey2Resolver.set(answerWebKey, r);

          // send the message, and immediately subscribe to hear the answer
          opSend(targetData, name, args, answerSwissbase);
          opWhen(targetData.vatID, answerSwissnum);

          return answerVow;

        } else {
          throw Error(`unknown op ${op}`);
        }
      },
    });
  }

  function unserializeVow(data) {
    const key = makeWebkey(data);
    if (webkey2Vow.has(key)) {
      return webkey2Vow.get(key);
    }
    const handler = makeRemoteVowHandler(key);
    const {p, r} = makePair();
    const v = makeRemote(handler, p);

    // remember their serialization so we use it again if we ever send this
    // value
    val2Serialized.set(v, data);

    // remember the Vow we created, so if this serialization ever arrives
    // again, we'll deliver the same Vow
    webkey2Vow.set(key, v);

    // remember the resolver we'll use when they send an opResolve for this
    // Vow
    webkey2Resolver.set(key, r);

    // this is the first time we've seen this Vow, so subscribe to hear about
    // its resolution
    opWhen(data.vatID, data.swissnum); // subscribe
    return v;
  }

  // todo: queue this until finishTurn, stall outbound messages until the
  // turn succeeds
  function opSend(target, name, args, answerSwissbase) {
    /* eslint-disable-next-line no-use-before-define */
    const argsS = serialize(harden(args));
    const body = harden({
      op: 'send',
      targetSwissnum: target.swissnum,
      methodName: name,
      argsS,
      resultSwissbase: answerSwissbase,
    });
    manager.sendTo(target.vatID, body);
  }

  function opWhen(targetVatID, targetSwissnum) {
    // subscribe to get an opResolve when the target Vow is resolved
    const body = harden({ op: 'when', targetSwissnum });
    manager.sendTo(targetVatID, body);
  }

  function opResolve(targetVatID, targetSwissnum, value) {
    // todo: rename targetSwissnum to mySwissnum? The thing being resolved
    // lives on the sender, not the recipient.
    const valueS = serialize(harden(value));
    const body = harden({ op: 'resolve', targetSwissnum, valueS });
    manager.sendTo(targetVatID, body);
  }


  function makeFarVowHandler(key) {
    // I think these behave the same way. RemoteVowHandler's target is a Vow,
    // while FarVowHandler's target is a pass-by-presence object.
    return makeRemoteVowHandler(key);
  }

  function unserializePresence(data) {
    const key = makeWebkey(data);
    if (webkey2Presence.has(key)) {
      return webkey2Presence.get(key);
    }

    const handler = makeFarVowHandler(key);
    const { presence, vow } = makePresence(handler);

    val2Serialized.set(presence, data);
    webkey2Presence.set(key, presence);

    return presence;
  }

  function makeReviver() {
    const ibids = [];

    return function reviver(_, data) {
      if (Object(data) !== data) {
        // primitives pass through
        return data;
      }
      if (QCLASS in data) {
        const qclass = `${data[QCLASS]}`;
        switch (qclass) {
          // Encoding of primitives not handled by JSON
          case 'undefined': {
            return undefined;
          }
          case '-0': {
            return -0;
          }
          case 'NaN': {
            return NaN;
          }
          case 'Infinity': {
            return Infinity;
          }
          case '-Infinity': {
            return -Infinity;
          }
          case 'symbol': {
            return Symbol.for(data.key);
          }
          case 'bigint': {
            /* eslint-disable-next-line no-undef */
            return BigInt(data.digits);
          }

          case 'ibid': {
            throw new Error('ibid disabled for now');
            // const index = Nat(data.index);
            // if (index >= ibids.length) {
            //   throw new RangeError(`ibid out of range: ${index}`);
            // }
            // return ibids[index];
          }

          case 'vow': {
            data = unserializeVow(data);
            // overwrite data and break to ibid registration.
            break;
          }
          case 'presence': {
            data = unserializePresence(data);
            break;
          }
          default: {
            // TODO reverse Hilbert hotel
            throw new TypeError(`unrecognized ${QCLASS} ${qclass}`);
          }
        }
      } else {
        // The unserialized copy also becomes pass-by-copy, but we don't need
        // to mark it specially
        // todo: what if the unserializer is given "{}"?
      }
      // The ibids case returned early to avoid this.
      ibids.push(data);
      return harden(data);
    };
  }

  // val might be a primitive, a pass by (shallow) copy object, a
  // remote reference, or other.  We treat all other as a local object
  // to be exported as a local webkey.
  function serialize(val) {
    return JSON.stringify(val, makeReplacer());
  }

  function unserialize(str) {
    return JSON.parse(str, makeReviver());
  }

  function parseSturdyref(sturdyref) {
    const parts = sturdyref.split('/');
    return { vatID: parts[0], swissnum: parts[1] };
  }

  function createPresence(sturdyref) {
    // used to create initial argv references: we just pretend we've received
    // a serialized presence record, which stores it in the tables so we can
    // send it back out again later
    const { vatID, swissnum } = parseSturdyref(sturdyref);
    const serialized = harden({
      [QCLASS]: 'presence',
      vatID,
      swissnum,
    });
    return unserializePresence(serialized);
  }

  function allocateSwissStuff() {
    const swissbase = allocateSwissbase();
    const swissnum = doSwissHashing(swissbase, hash58);
    return { swissbase, swissnum };
  }

  function registerTarget(val, swissnum) {
    // used to register the Vat's root object (to bootstrap other vats
    // pointing at us), as well as to register the answer promise created
    // when someone sends us an opSend (for which the sender allocates the
    // swissnum, not us)
    serializePassByPresence(val, swissnum);
  }

  function getOutboundResolver(vatID, swissnum) {
    // console.log(`getOutboundResolver looking up ${vatID} / ${swissnum}`);
    const key = makeWebkey({ vatID, swissnum });
    // console.log(` with key ${key}`);
    const r = webkey2Resolver.get(key);
    if (r) {
      webkey2Resolver.delete(key);
    }
    return r;
  }

  function getMyTargetBySwissnum(swissnum) {
    // used when we receive opWhen, to find which Vow they're subscribing to
    const key = makeWebkey({ vatID: myVatID, swissnum });
    return webkey2Vow.get(key);
  }


  function doSendInternal(opMsg) {
    const target = getMyTargetBySwissnum(opMsg.targetSwissnum);
    if (!target) {
      throw new Error(`unrecognized target, swissnum=${opMsg.targetSwissnum}`);
    }
    if (!opMsg.argsS) {
      throw new Error('opMsg is missing .argsS');
    }
    const args = unserialize(opMsg.argsS);
    // todo: sometimes causes turn delay, could fastpath if target is
    // resolved
    return Vow.resolve(target).e[opMsg.methodName](...args);
  }

  function rxMessage(senderVatID, opMsg) {
    // opMsg is { op: 'send', targetSwissnum, methodName, argsS,
    // resultSwissbase, answerR }, or { op: 'resolve', targetSwissnum, valueS
    // } . Pass argsS/valueS to marshal.unserialize

    // We are strictly given messages in-order from each sender

    // todo: It does not include seqnum (which must be visible to the manager).
    // sent messages are assigned a seqnum by the manager
    // txMessage(recipientVatID, message)

    // console.log(`op ${opMsg.op}`);
    let done;
    if (opMsg.op === 'send') {
      const res = doSendInternal(opMsg);
      if (opMsg.resultSwissbase) {
        const resolverSwissnum = doSwissHashing(opMsg.resultSwissbase, hash58);
        // if they care about the result, they'll send an opWhen hot on the
        // heels of this opSend, which will register their interest in the
        // Vow
        registerTarget(res, resolverSwissnum);
        // note: BrokenVow is pass-by-copy, so Vow.resolve(rej) causes a BrokenVow
      } else {
        // else it was really a sendOnly
        console.log(`commsReceived got sendOnly, dropping result`);
      }
      done = res; // for testing
    } else if (opMsg.op === 'when') {
      const v = getMyTargetBySwissnum(opMsg.targetSwissnum);
      // todo: assert that it's a Vow, but really we should tolerate peer
      // being weird
      Vow.resolve(v).then(res =>
                          opResolve(senderVatID, opMsg.targetSwissnum, res),
      );
      // todo: rejection
    } else if (opMsg.op === 'resolve') {
      // console.log('-- got op resolve');
      // console.log(' senderVatID', senderVatID);
      // console.log(' valueS', opMsg.valueS);
      const r = getOutboundResolver(senderVatID, opMsg.targetSwissnum);
      // console.log(`r: ${r}`);
      // console.log('found target');
      let value;
      try {
        value = unserialize(opMsg.valueS);
      } catch (ex) {
        console.log('exception in unserialize of:', opMsg.valueS);
        console.log(ex);
        throw ex;
      }
      // console.log('found value', value);
      r(value);
      // console.log('did resolve');
    }
    return done; // for testing, to wait until things are done
  }



  return harden({
    serialize,
    unserialize,
    rxMessage,
    registerTarget, // opSend registers the resolver, Vat registers the root
    createPresence, // for bootstrap(argv), and tests
  });
}
