import { Vow, isVow, Flow, makePresence, makeUnresolvedRemoteVow } from '../flow/flowcomm';

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
  for (let name of names) {
    if (typeof val[name] === 'function') {
      return false;
    }
  }
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

function mustPassByPresence(val) { // throws exception if cannot
  if (!Object.isFrozen(val)) {
    throw new Error(`cannot serialize non-frozen objects like ${val}`);
  }
  if (typeof val !== 'object') {
    throw new Error(`cannot serialize non-objects like ${val}`);
  }
  for (let name of Object.getOwnPropertyNames(val)) {
    if (name === 'e') {
      // hack to allow Vows to pass-by-presence
      continue;
    }
    if (typeof val[name] !== 'function') {
      throw new Error(`cannot serialize objects with non-methods like the .${name} in ${val}`);
      return false;
    }
  }
  const p = Object.getPrototypeOf(val);
  if (p !== null && p !== Object.prototype) {
    mustPassByPresence(p);
  }
  // ok!
}


// Special property name that indicates an encoding that needs special
// decoding.
const QCLASS = '@qclass';

function insist(condition, exception) {
  if (!condition) {
    throw exception;
  }
}

export function doSwissHashing(base) {
  return `hash-of-${base}`; // todo hahaha
}

export function makeWebkeyMarshal(myVatID, serializer) {

  // val might be a primitive, a pass by (shallow) copy object, a
  // remote reference, or other.  We treat all other as a local object
  // to be exported as a local webkey.
  function serialize(val, resolutionOf, targetVatID) {
    return JSON.stringify(val, makeReplacer(resolutionOf, targetVatID));
  }

  function unserialize(str) {
    return JSON.parse(str, makeReviver());
  }

  function makeWebkey(data) {
    // todo: use a cheaper (but still safe/reversible) combiner
    return JSON.stringify({vatID: data.vatID, swissnum: data.swissnum});
  }

  // Record: { value, vatID, swissnum, serialized }
  // holds both objects (pass-by-presence) and unresolved promises
  const val2Record = new WeakMap();
  const webkey2Record = new Map();

  let fakeSwissCounter = 0;
  function allocateSwissnum() {
    fakeSwissCounter += 1;
    const swissnum = fakeSwissCounter; // todo: random, of course
    return swissnum;
  }

  function allocateSwissbase() {
    fakeSwissCounter += 1;
    const swissbase = `base-${fakeSwissCounter}`; // todo: random, of course
    return swissbase;
  }

  function serializePassByPresence(val, resolutionOf, targetVatID, swissnum=undefined) {
    // we are responsible for new serialization of pass-by-presence objects

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

    // deal with a promise that's already resolved to a pass-by-copy value
    // { type: unresolved vow, vatid, swissnum }
    // or
    // { type: resolved vow, resolution: X }
    // X could be:
    // * presence (resolved to pass-by-reference)
    // * other (resolved to pass-by-copy)

    let type;

    if (isVow(val)) {
      const r = resolutionOf(val);
      if (r) {
        // resolved Vows are sent as QCLASS: resolvedVow, with a .value
        // property. The .value might be pass-by-copy, or maybe a presence
        // (which will be passed as QCLASS: presence). These do not have an
        // identity, so no swissnum (although the value it resolves to
        // might).

        return def({
          [QCLASS]: 'resolvedVow',
          value: serialize(r, resolutionOf, targetVatID)
        });
      }

      // unresolved Vows are send as QCLASS: unresolvedVow, with a vatID and
      // swissnum. 'val' wasn't in the val2Record table, so this must be the
      // first time we've seen this Vow (coming or going), so it must be a
      // LocalVow or NearVow, and we need to allocate a swissnum and put it
      // in the table.
      type = 'unresolvedVow';
    } else {
      // non-Vows. This will only be local pass-by-presence objects that we
      // haven't already sent, because the other pass-by-presence is a Presence
      // and these will have already been added to val2Record. (we must add
      // them upon receipt, because a Presence otherwise looks like
      // pass-by-copy)
      type = 'presence';
    }

    if (typeof swissnum === 'undefined') {
      swissnum = allocateSwissnum();
    }

    const rec = def({ value: val,
                      vatID: myVatID,
                      swissnum: swissnum,
                      serialized: {
                        [QCLASS]: type,
                        vatID: myVatID,
                        swissnum: swissnum
                      }
                    });
    //log(`assigning rec ${JSON.stringify(rec)}`);
    val2Record.set(val, rec);
    const key = JSON.stringify({vatID: myVatID, swissnum: swissnum});
    webkey2Record.set(key, rec);
    return rec.serialized;

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

  function makeReplacer(resolutionOf, targetVatID) {
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
            throw new Error(`non-frozen objects like ${val} are disabled for now`);
          }
          break;
        }
        case 'function': {
          throw new Error(`bare functions like ${val} are disabled for now`);
        }
        case 'undefined': {
          return def({[QCLASS]: 'undefined'});
        }
        case 'string':
        case 'boolean': {
          return val;
        }
        case 'number': {
          if (Number.isNaN(val)) {
            return def({[QCLASS]: 'NaN'});
          }
          if (Object.is(val, -0)) {
            return def({[QCLASS]: '-0'});
          }
          if (val === Infinity) {
            return def({[QCLASS]: 'Infinity'});
          }
          if (val === -Infinity) {
            return def({[QCLASS]: '-Infinity'});
          }
          return val;
        }
        case 'symbol': {
          const opt_key = Symbol.keyFor(val);
          if (opt_key === undefined) {
            // TODO: Symmetric unguessable identity
            throw new TypeError('Cannot serialize unregistered symbol');
          }
          return def({
            [QCLASS]: 'symbol',
            key: opt_key
          });
        }
        case 'bigint': {
          return def({
            [QCLASS]: 'bigint',
            digits: String(val)
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
        return def({
          [QCLASS]: 'ibid',
          index: ibidMap.get(val)
        });
      }
      ibidMap.set(val, ibidCount);
      ibidCount += 1;

      // if we've serialized it before, or if it arrived from the outside
      // (and is thus in the table), use the previous serialization
      if (val2Record.has(val)) {
        return val2Record.get(val).serialized;
      }

      // We can serialize some things as plain pass-by-copy: arrays, and
      // objects with one or more data properties but no method properties.

      if (canPassByCopy(val)) {
        //log(`canPassByCopy: ${val}`);
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
      //log(`mustPassByPresence: ${val}`);

      // todo: we might have redundantly done an isFrozen test above, but
      // it's safer than forgetting to do it for the other cases.

      // makeLocalWebkey() is entirely responsible for figuring out how to
      // serialize pass-by-reference objects, including cache/table
      // management

      return serializePassByPresence(val, resolutionOf, targetVatID);
    };
  }

  function parseSturdyref(sturdyref) {
    const parts = sturdyref.split('/');
    return { vatID: parts[0],
             swissnum: parts[1] };
  }

  function createPresence(sturdyref) {
    // used to create initial argv references
    const { vatID, swissnum } = parseSturdyref(sturdyref);
    const serialized = {
      [QCLASS]: 'presence',
      vatID: vatID,
      swissnum: swissnum
    };
    // this creates the Presence, and also stores it into the tables, so we
    // can send it back out again later
    return unserializePresence(serialized);
  }

  function unserializePresence(data) {
    //log(`unserializePresence ${JSON.stringify(data)}`);
    const key = makeWebkey(data);
    if (webkey2Record.has(key)) {
      //log(` found previous`);
      return webkey2Record.get(key).value;
    }
    //log(` did not find previous`);
    for (let k of webkey2Record.keys()) {
      //log(` had: ${k}`);
    }

    // todo: maybe pre-generate the FarVow and stash it for quick access
    const p = makePresence(serializer, data.vatID, data.swissnum);
    const rec = def({ value: p,
                      vatID: data.vatID,
                      swissnum: data.swissnum,
                      serialized: data });
    val2Record.set(p, rec);
    webkey2Record.set(key, rec);
    return p;
  }

  function unserializeResolvedVow(data) {
    const r = unserialize(data.value);
    // this creates a FarVow (specifically a Vow with a FarRemoteHandler)
    return Vow.resolve(r);
  }

  function unserializeUnresolvedVow(data) {
    const key = makeWebkey(data);
    if (webkey2Record.has(key)) {
      return webkey2Record.get(key).value;
    }
    const v = makeUnresolvedRemoteVow(serializer, data.vatID, data.swissnum);
    const rec = def({ value: v,
                      vatID: data.vatID,
                      swissnum: data.swissnum,
                      serialized: data });
    val2Record.set(v, rec);
    webkey2Record.set(key, rec);
    return v;
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
          case 'undefined': { return undefined; }
          case '-0': { return -0; }
          case 'NaN': { return NaN; }
          case 'Infinity': { return Infinity; }
          case '-Infinity': { return -Infinity; }
          case 'symbol': { return Symbol.for(data.key); }
          case 'bigint': { return BigInt(data.digits); }

          case 'ibid': {
            throw new Error('ibid disabled for now');
            const index = Nat(data.index);
            if (index >= ibids.length) {
              throw new RangeError(`ibid out of range: ${index}`);
            }
            return ibids[index];
          }

          case 'unresolvedVow': {
            data = unserializeUnresolvedVow(data);
            // overwrite data and break to ibid registration.
            break;
          }
          case 'presence': {
            data = unserializePresence(data);
            break;
          }
          case 'resolvedVow': {
            data = unserializeResolvedVow(data);
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
      return def(data);
    };
  }

  // Like makeLocalWebkey, but with extra bookkeeping
  function serializeToWebkey(val) {
    const data = serialize(val);
    if (typeof data === 'object' && data[QCLASS] === 'webkey') {
      return data.webkey;
    }
    throw new TypeError('Did not serialize to webkey');
  }

  // Like makeFarResource, but with extra bookkeeping
  function unserializeWebkey(webkey) {
    return unserialize(def({
      [QCLASS]: 'webkey',
      webkey
    }));
  }

  function allocateSwissStuff() {
    const swissbase = allocateSwissbase();
    const swissnum = doSwissHashing(swissbase);
    return { swissbase, swissnum };
  }

  function registerTarget(val, swissnum, resolutionOf) {
    const targetVatID = null;
    serializePassByPresence(val, resolutionOf, targetVatID, swissnum);
  }

  function getOutboundResolver(vatID, swissnum, handlerOf) {
    //log(`getOutboundResolver looking up ${vatID} / ${swissnum}`);
    const key = makeWebkey({vatID, swissnum});
    //log(` with key ${key}`);
    const rec = webkey2Record.get(key);
    if (rec) {
      //log(` found record`);
      return handlerOf(rec.value);
    }
    //log(` did not find record`);
    return undefined;
  }

  function getMyTargetBySwissnum(swissnum) {
    const key = makeWebkey({vatID: myVatID, swissnum});
    const rec = webkey2Record.get(key);
    if (rec) {
      return rec.value;
    }
    return undefined;
  }

  function registerRemoteVow(targetVatID, swissnum, val) {
    //log(`registerRemoteVow: ${targetVatID} / ${swissnum} as ${val}`);
    const rec = def({ value: val,
                      vatID: targetVatID,
                      swissnum: swissnum,
                      serialized: {
                        [QCLASS]: 'unresolvedVow',
                        vatID: targetVatID,
                        swissnum: swissnum
                      }
                    });
    val2Record.set(val, rec);
    const key = JSON.stringify({vatID: targetVatID, swissnum: swissnum});
    //log(` with key ${key}`);
    webkey2Record.set(key, rec);
  }

  return def({serialize, unserialize, serializeToWebkey, unserializeWebkey,
              allocateSwissStuff, registerRemoteVow, getMyTargetBySwissnum,
              registerTarget, getOutboundResolver, createPresence});
}
