import isVow from '../flow/flowcomm';

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


// makeLocalWebkey(localObject) -> webkey to be honored by this vat.
// makeFarResourceMaker(serialize, unserialize) -> makeFarResource
// makeFarResource(webkey) -> far reference to another vat
//
export function makeWebkeyMarshal(makeLocalWebkey, makeFarResourceMaker, resolutionOf) {

  // val might be a primitive, a pass by (shallow) copy object, a
  // remote reference, or other.  We treat all other as a local object
  // to be exported as a local webkey.
  function serialize(val) {
    return JSON.stringify(val, makeReplacer());
  }

  function unserialize(str) {
    return JSON.parse(str, makeReviver());
  }

  const val2webkey = new WeakMap();
  const webkeyString2val = new Map();

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

      // We can serialize some things as plain pass-by-copy: arrays (todo:
      // serialize them as arrays) and objects with one or more data
      // properties and no method properties.

      if (canPassByCopy(val)) {
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

      // todo: we might have redundantly done an isFrozen test above, but
      // it's safer than forgetting to do it for the other cases.

      // makeLocalWebkey() is entirely responsible for figuring out how to
      // serialize pass-by-reference objects, including cache/table
      // management

      let webkey = makeLocalWebkey(val, val2webkey, webkeyString2val, 
                                   resolutionOf);
      return def({
        [QCLASS]: 'webkey',
        webkey: webkey
      });
    };
  }

  const makeFarResource = makeFarResourceMaker(serialize, unserialize);

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

          case 'webkey': {

            // Each Presence/FarVow pair is permanently tied to a specific
            // peer Vat (whose vatid is included in the webkey), and can only
            // be created in response to a remote message of some sort
            // (either from their home vat, or todo as a third-party
            // reference from someone else). That remote message might have
            // referred to either the Presence (if the sender serialized a
            // regular object) or the FarVow (if they serialized a NearVow),
            // but both use the same swissnum. In either case, we check the
            // table with the presence-style webkey, creating a new Presence
            // object if necessary. Then we either deliver the Presence or
            // convert it into a new FarVow depending upon the 'type'
            // provided by the sender.

            // if the VatID matches our own, the webkeyString2val table will
            // point to the original object (or NearVow) which we sent in an
            // earlier outbound call. We don't need to compare VatIDs (todo,
            // really?).

            const webkey = data.webkey;
            // makeFarResource is responsible for caching
            data = makeFarResource(webkey, webkeyString2val, val2webkey);
            // overwrite data and break to ibid registration.
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

  return def({serialize, unserialize, serializeToWebkey, unserializeWebkey});
}
