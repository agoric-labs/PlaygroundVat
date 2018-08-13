// Shim a small subset of Q

(function(global) {
  "use strict";

  // A remoteRelay must additionally have an AWAIT_FAR method
  const localRelay = {
    GET(p, key) { return p.then(o => o[key]); },
    PUT(p, key, val) { return p.then(o => o[key] = val); },
    DELETE(p, key) { return p.then(o => delete o[key]); },
    POST(p, opt_key, args) {
      if (opt_key === void 0 || opt_key === null) {
        return p.then(o => o(...args));
      } else {
        return p.then(o => o[opt_key](...args));
      }
    }
  };
  
  const relayToPromise = new WeakMap();
  const promiseToRelay = new WeakMap();
  
  function relay(p) {
    return promiseToRelay.get(p) || localRelay;
  }
  
  function Q(specimen) {
    return relayToPromise.get(specimen) || Promise.resolve(specimen);
  }
  
  Object.defineProperties(Promise.prototype, Object.getOwnPropertyDescriptors({
    get(key) { return relay(this).GET(this, key); },
    put(key, val) { return relay(this).PUT(this, key, val); },
    del(key) { return relay(this).DELETE(this, key); },
    post(opt_key, args) { return relay(this).POST(this, opt_key, args); },
    invoke(opt_key, ...args) { return relay(this).POST(this, opt_key, args); },
    fapply(args) { return relay(this).POST(this, void 0, args); },
    fcall(...args) { return relay(this).POST(this, void 0, args); }
  }));
  // Temporary compat with the old makeQ.js
  Promise.prototype.send = Promise.prototype.invoke;
  Promise.prototype.delete = Promise.prototype.del;
  Promise.prototype.end = function() {
    this.then(_ => {}, reason => { throw reason; });
  };

  const passByCopyRecords = new WeakSet();

  const reject = Promise.reject.bind(Promise);

  Object.defineProperties(Q, Object.getOwnPropertyDescriptors({
    all: Promise.all.bind(Promise),
    race: Promise.race.bind(Promise),
    reject: reject,
    resolve: Promise.resolve.bind(Promise),
    
    join(p, q) {
      if (Object.is(p, q)) {
        // When p is a pipeline-able promise, this shortcut preserves
        // pipelining.
        return p;
      }
      return Promise.all([p, q]).then(([pp, qq]) => {
        if (Object.is(pp, qq)) {
          return pp;
        } else {
          throw new RangeError("not the same");
        }
      });
    },
    isPassByCopy(record) {
      return Object(record) !== record || passByCopyRecords.has(record);
    },
    passByCopy(record) {
      if (Q.isPassByCopy(record)) { return record; }
      if (Object.isFrozen(record)) {
        throw new TypeError(`already frozen`);
      }
      Object.freeze(record);
      if (!Object.isFrozen(record)) {
        throw new TypeError(`failed to freeze`);
      }
      passByCopyRecords.add(record);
      return record;
    },
    makeRemote(remoteRelay, nextSlotP) {
      // TODO: Use nextSlotP instead of AWAIT_FAR
      const promise = Promise.resolve(remoteRelay.AWAIT_FAR());
      relayToPromise.set(remoteRelay, promise);
      promiseToRelay.set(promise, remoteRelay);
      return promise;
    },
    makeFar(farRelay, nextSlotP) {
      // TODO: Use nextSlotP to indicate partition breakage
      const promise = Promise.resolve(farRelay);
      relayToPromise.set(farRelay, promise);
      promiseToRelay.set(promise, farRelay);
      return promise;
    },

    // Temporary compat with the old makeQ.js
    // shorten
    // isPromise
    // async
    rejected: reject,
    promise(func) { return new Promise(func); },
    delay(millis, opt_answer) {
       return new Promise(resolve => {
         setTimeout(() => { resolve(opt_answer); }, millis);
       });
    },
    memoize(oneArgFuncP, opt_memoMap) {
       var memoMap = opt_memoMap || new WeakMap();

       function oneArgMemo(arg) {
         var resultP = memoMap.get(arg);
         if (!resultP) {
           resultP = Q(oneArgFuncP).fcall(arg);
           memoMap.set(arg, resultP);
         }
         return resultP;
       }
      return cajaVM.constFunc(oneArgMemo);
    },
    defer() {
      var deferred = {};
      deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
      });
      return deferred;
    }
  }));

  global.Q = Q;
  
})(this);
