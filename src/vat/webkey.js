import { doSwissHashing } from './swissCrypto';
import { insist } from '../insist';

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

export function makeWebkeyMarshal(log,
                                  Vow, isVow, Flow,
                                  makePresence, makeUnresolvedRemoteVow,
                                  myVatID, serializer) {

  // val might be a primitive, a pass by (shallow) copy object, a
  // remote reference, or other.  We treat all other as a local object
  // to be exported as a local webkey.
  function serialize(val, resolutionOf, targetVatID) {
    if (!targetVatID) {
      throw new Error(`forgot targetVatID`);
    }
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

    let type;
    if (isVow(val)) {
      // This must be a new Local Vow (if it were remote, it would have been
      // added to our table upon receipt, and we wouldn't get here) (and if
      // we'd already serialized it once, it would also be in the table). We
      // must allocate a new swissnum.
      type = 'vow';
    } else {
      // This must be a new local pass-by-presence object
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
    return rec;
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
            log('asked to serialize', val, typeof val, Object.isFrozen(val));
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
        const rec = val2Record.get(val);
        return rec.serialized;
      }

      // We can serialize some things as plain pass-by-copy: arrays, and
      // objects with one or more data properties but no method properties.

      // todo: handle this properly, by constructing a @qclass: error
      if (val instanceof Error) {
        log('cannot yet serialize Errors correctly', val);
        log('stack was:', val);
        throw new Error('cannot yet serialize Errors correctly');
      }

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

      const rec = serializePassByPresence(val, resolutionOf, targetVatID);
      return rec.serialized;
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

  function unserializeVow(data) {
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
    serializer.opWhen(data.vatID, data.swissnum);
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
      return def(data);
    };
  }

  function allocateSwissStuff() {
    const swissbase = allocateSwissbase();
    const swissnum = doSwissHashing(swissbase);
    return { swissbase, swissnum };
  }

  function registerTarget(val, swissnum, targetVatID, resolutionOf) {
    const rec = serializePassByPresence(val, resolutionOf, targetVatID, swissnum);
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
                        [QCLASS]: 'vow',
                        vatID: targetVatID,
                        swissnum: swissnum
                      }
                    });
    val2Record.set(val, rec);
    const key = JSON.stringify({vatID: targetVatID, swissnum: swissnum});
    //log(` with key ${key}`);
    webkey2Record.set(key, rec);
    serializer.opWhen(targetVatID, swissnum);
  }

  return def({serialize, unserialize,
              allocateSwissStuff, registerRemoteVow, getMyTargetBySwissnum,
              registerTarget, getOutboundResolver, createPresence});
}
