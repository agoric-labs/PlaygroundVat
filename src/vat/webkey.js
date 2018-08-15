
const passByCopyRecords = new WeakSet();

export function isPassByCopy(record) {
  return Object(record) !== record || passByCopyRecords.has(record);
}

export function passByCopy(record) {
  if (isPassByCopy(record)) { return record; }
  if (Object.isFrozen(record)) {
    throw new TypeError(`already frozen`);
  }
  Object.freeze(record);
  if (!Object.isFrozen(record)) {
    throw new TypeError(`failed to freeze`);
  }
  passByCopyRecords.add(record);
  return record;
}

// Special property name that indicates an encoding that needs special
// decoding.
const QCLASS = '@qclass';


// makeLocalWebkey(localObject) -> webkey to be honored by this vat.
// makeFarResourceMaker(serialize, unserialize) -> makeFarResource
// makeFarResource(webkey) -> far reference to another vat
//
export function makeWebkeyMarshal(makeLocalWebkey, makeFarResourceMaker) {

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
  const webkey2val = new Map();

  function makeReplacer() {
    const ibidMap = new Map();
    let ibidCount = 0;
    
    return function replacer(_, val) {
      switch (typeof val) {
        case 'object': {
          if (val === null) {
            return null;
          }
          break;
        }
        case 'function': {
          break;
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

      // Here only if not null and typeof is 'object' or 'function'
      
      if (QCLASS in val) {
        // TODO Hilbert hotel
        throw new Error(`property "${QCLASS}" reserved`);
      }
      
      if (ibidMap.has(val)) {
        // Backreference to prior occurrence
        return def({
          [QCLASS]: 'ibid',
          index: ibidMap.get(val)
        });
      }
      ibidMap.set(val, ibidCount);
      ibidCount += 1;
      
      if (isPassByCopy(val)) {
        // Purposely in-band for readability, but creates need for
        // Hilbert hotel.
        return val;
      }

      if (!val2webkey.has(val)) {
        // Export a local pass-by-reference object
        const webkey = makeLocalWebkey(val);
        val2webkey.set(val, webkey);
        webkey2val.set(webkey, val);
      }

      // Could be local or remote
      return def({
        [QCLASS]: 'webkey',
        webkey: val2webkey.get(val)
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
            const index = Nat(data.index);
            if (index >= ibids.length) {
              throw new RangeError(`ibid out of range: ${index}`);
            }
            return ibids[index];
          }
          
          case 'webkey': {
            const webkey = data.webkey;
            if (!webkey2val.has(webkey)) {
              const val = makeFarResource(webkey);
              webkey2val.set(webkey, val);
              val2webkey.set(val, webkey);
            }
            // overwrite data and break to ibid registration.
            data = webkey2val.get(webkey);
            break;
          }
          default: {
            // TODO reverse Hilbert hotel
            throw new TypeError(`unrecognized ${QCLASS} ${qclass}`);
          }
        }
      } else {
        // The unserialized copy also becomes pass-by-copy
        passByCopy(data);
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
