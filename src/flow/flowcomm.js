// A simple comm systme using Flows for ordering
'use strict';

const scheduleHack = Promise.resolve(null);

// TODO what if exeption is undefined?
function insist(condition, exception) {
  if (!condition) {
    throw exception;
  }
}

// TODO: remove this in favor of the global deep-freezing def() that SES
// provides. However make sure test-flow.js can still work, which doesn't run
// under SES.
function def(x) {
  return Object.freeze(x);
}

function isSymbol (x) {
  return typeof x === 'symbol';
}

let whichTodoCounter = 0;
const whichTodo = new WeakMap();

// TODO handle errors and broken targets
// TODO what happens to the then result?
function scheduleTodo(target, todo) {
  Promise.resolve(target).then(todo);
}

function isBroken(target) { // todo
  return false;
}

// TODO handle errors
function PendingDelivery(op, args, resultR) {
  const which = whichTodoCounter++;
  const todo = function Delivery(target) {
    //console.log(`SEND [${which}] ${target} . ${op} (#${args.length})`);
    //console.log(`SEND ${op}`);
    if (isBroken(target)) {
      resultR(target); // broken Vow contagion
      return;
    }
    if (Object(target) === target) {
      if (!Reflect.getOwnPropertyDescriptor(target, op)) {
        //console.log(`target[${op}] is missing for ${target}`);
      }
     } else if (typeof target !== 'string') {
      //console.log(`target IS WONKY: ${target}`);
    }
    let res;
    try {
      res = target[op](...args);
    } catch (ex) {
      log(`****#### ${op} ####****`);
      res = Promise.reject(ex); // todo: make this a Vow.reject, once that exists
    }
    // resultR shouldn't ever throw an exception, but just in case let's look
    // at it separately
    resultR(res);
  };
  //log(`PendingDelivery[${which}] ${op}, ${args}`);
  whichTodo[todo] = which;
  // todo.toString = () => `${resultR.name} => <target>.${op}(${args})`;
  todo.remote = () => ({ op, args });
  return todo;
}

// TODO handle errors
function PendingThen(onFulfill, onReject, resultR) {
  const which = whichTodoCounter++;
  const todo = function (target) {
    //log(`THEN [${which}]`);
    let res;
    try {
      res = isBroken(target) ? onReject(target) : onFulfill(target);
    } catch (ex) {
      res = Promise.reject(ex); // todo: Vow.reject
    }
    resultR(res);
  };
  //log(`PendingThen[${which}] ${func}`);
  whichTodo[todo] = which;
  return todo;
}

/**
 * Among objects, all and only promises have handlers.
 */

class UnresolvedHandler {
  constructor() {
    this.forwardedTo = null;
    this.blockedFlows = [];
  }

  // Fulfill the vow. Reschedule any flows that were blocked on this vow.
  fulfill(value) {
    const rec = farVows.get(value);
    const handler = rec ? rec.handler : new FulfilledHandler(value);
    return this.directForward(handler);
  }

  // Fulfill the vow. Reschedule any flows that were blocked on this vow.
  // TODO get rid of resolver argument?
  forwardTo(valueInner) {
    const valueR = shortenForwards(valueInner.resolver, valueInner);
    return this.directForward(valueR);
  }

  directForward(valueR) {
    this.forwardedTo = valueR;
    if (this.blockedFlows.length) {
      // There are waiting flows; move them to the end of the chain
      valueR.processBlockedFlows(this.blockedFlows);
      this.blockedFlows = null;
    }
    return valueR;
  }

  processBlockedFlows(blockedFlows) {
    //console.log(`Appending blocked flow ${blockedFlows}`);

    insist(!this.forwardedTo, "INTERNAL: Must be unforwarded to acept flows.");
    this.blockedFlows.push(...blockedFlows);
  }

  processSingle(todo, flow) {
    // the target of the next message is unresolved so
    // this flow is now waiting for shortTarget
    this.blockedFlows.push(flow);
    return false;
  }
}
def(UnresolvedHandler);

class FulfilledHandler {
  constructor(value) {
    this.forwardedTo = null;
    this.value = value;
  }

  // Fulfill the vow. Reschedule any flows that were blocked on this vow.
  fulfill(value) {
    insist(false, 'Fulfill only applies to unresolved promise');
  }

  // Fulfill the vow. Reschedule any flows that were blocked on this vow.
  forwardTo(valueInner) {
    insist(false, 'Forward only applies to unresolved promise');
  }

  processBlockedFlows(blockedFlows) {
    for (const flow of blockedFlows) {
      //console.log(`Processing blocked flow ${flow}`);
      flow.scheduleUnblocked();
    }
  }

  processSingle(todo, flow) {
    scheduleTodo(this.value, todo);
    return true;
  }
}
def(FulfilledHandler);

class FarRemoteHandler {
  constructor(serializer, vatID, swissnum, presence=null) {
    this.forwardedTo = null;
    this.serializer = serializer;
    this.vatID = vatID;
    this.swissnum = swissnum;
    this.value = presence; // note: other folks test for '.value', so don't rename it
    //this.pendingResolves = 1;
  }

  // Fulfill the vow. Reschedule any flows that were blocked on this vow.
  fulfill(value) {
    insist(false, 'Fulfill only applies to unresolved promise');
  }

  // Fulfill the vow. Reschedule any flows that were blocked on this vow.
  // TODO get rid of resolver argument?
  forwardTo(valueInner, resolver) {
    insist(false, 'Forward only applies to unresolved promise');
  }

  processBlockedFlows(blockedFlows) {
    for (const flow of blockedFlows) {
      flow.scheduleUnblocked();
    }
  }

  processSingle(todo, flow) {
    function isMessageSend(t) {
      if (todo.remote) { // hack
        return true;
      } else {
        return false;
      }
    }
    if (isMessageSend(todo)) {
      const { op, args } = todo.remote();
      // the serializer gets private access to resolutionOf(), which it uses
      // to build the right webkeys

      // construct a new Vow for the result, pointing at a FarHandler to the
      // same vat as our own Presence target

      const resData = this.serializer.allocateSwissStuff();

      // create a synthetic RemoteVow, as if we'd received swissnum from
      // targetvat. We register it with the comms tables so that when the
      // other end sends their {type:'resolve'} message, it will cause this
      // resultVow to resolve, and any queued messages we put into it will be
      // delivered. We choose the swissnum because we're allocating the
      // object, but we do it with a swissbase so we can't deliberately
      // collide with anything currently allocated on the other end

      const resultVow = makeUnresolvedRemoteVow(this.serializer, this.vatID,
                                                resData.swissnum, flow);
      this.serializer.registerRemoteVow(this.vatID, resData.swissnum, resultVow);

      this.serializer.opSend(resData.swissbase, this.vatID, this.swissnum, op, args, resolutionOf);
      return true;
    } else {
      // this is a then() on a RemoteVow, which should cause a round trip to
      // flush all the previous messages, but doesn't actually target the
      // specific object. todo: flow enforcement

      // todo: opThen
      //this.serializer.opThen(this.vatID, this.swissnum);

      scheduleTodo(this.value, todo);
      return true;
    }
  }
}
def(FarRemoteHandler);


class InnerFlow {
  constructor() {
    // a queue of message structured as [targetR, op, args, resultR]
    this.pending = [];
  }

  // add a message to the end of the flow
  // todo shorten and clean up shorten
  enqueue(innerVow, todo) {
    //log('enqueue entering');
    const firstR = innerVow.resolver;
    const shortTarget = shortenForwards(firstR, innerVow);
    if (this.pending.length === 0) {
      //log(`InnerFlow.enqueue found an empty queue`);
      // This will be the first pending action, so it's either ready to schedule or
      // is what this flow will be waiting on
      const processed = shortTarget.processSingle(todo, this);
      if (processed) {
        // fastpath; the action was scheduled immediately since it was ready and the flow was empty
        //log(`InnerFlow.enqueue exiting on fast path`);
        return;
      }
    }
    this.pending.push([shortTarget, todo]);
    //log(`InnerFlow.enqueue exiting with ${this.pending.length} entries`);
    //log(`  e[0] is ${whichTodo.get(this.pending[0][1])}`);
  }

  // The blocking resolver has been resolved. Schedule all unlocked pending flows, in order
  scheduleUnblocked() {
    // TODO add assertion that this always finds at least one resolved promise
    while (this.pending.length > 0) {
      const msg = this.pending[0];
      const [target, todo] = msg;
      const shortTarget = shortenForwards(target);
      const processed = shortTarget.processSingle(todo, this);
      if (processed) {
        // The todo was processed; remove it from pending
        this.pending.shift();
      } else {
        // the target of the next message is unresolved, so break
        break;
      }
    }
  }

  toStringX() {
    return `Flow {
      pending: ${this.pending.join("  \n")}
    }`;
  }
}
def(InnerFlow);

const flowToInner = new WeakMap();

function realInnerFlow(value) {
  const result = flowToInner.get(value);
  insist(result, "Valid instance required");
  return result;
}

const farVows = new WeakMap(); // maps Presence to { vatID, swissnum, handler }

export function makePresence(serializer, vatID, swissnum) {
  const presence = def({});
  const handler = new FarRemoteHandler(serializer, vatID, swissnum, presence);
  const rec = { vatID, swissnum, handler };
  farVows.set(presence, rec);
  return presence;
}

export function makeUnresolvedRemoteVow(serializer, vatID, swissnum, flow=new InnerFlow()) {
  const handler = new FarRemoteHandler(serializer, vatID, swissnum);
  return new Vow(flow, handler);
}

class Flow {
  constructor() {
    flowToInner.set(this, new InnerFlow());
  }

  makeVow(resolveFn) {
    const flow = realInnerFlow(this);
    const innerResolver = new UnresolvedHandler();
    const resultR = makeResolver(innerResolver);
    resolveFn(resultR);
    return new Vow(flow, innerResolver);
  }

}
def(Flow);

// follow a chain of handlers
function shortenForwards(firstResolver, optVow) {
  let nextR = firstResolver;
  let lastR;
  do {
    lastR = nextR;
    nextR = lastR.forwardedTo;
  } while (nextR);
  if (lastR !== firstResolver) {
    // there's a chain to shorten; start from the front again and make all nodes forward to the end of the chain
    let h = firstResolver;
    do {
      const k = h.forwardedTo;
      h.forwardedTo = lastR;
      h = k;
    } while (h !== lastR);
    if (optVow) {
      optVow.resolver = lastR;
    }
  }
  return lastR;
}

function makeResolver(innerResolver) {
  const resolver = function (value) {
    // TODO how do we detect cycles
    // TODO use 'this' for the identity
    const valueInner = getInnerVow(value);
    if (valueInner) {
      // the value is a promise; forward to it
      innerResolver = innerResolver.forwardTo(valueInner);
    } else {
      // value might be a Presence, or local object, or received pass-by-copy
      // object
      innerResolver = innerResolver.fulfill(value);
    }
  };
  // resolver.toString = () => `Resolver{ resolved: ${getHandler(resolver)} }`;
  return def(resolver);
}
def(makeResolver);

const vowToInner = new WeakMap();
const resolverToInner = new WeakMap();

// TODO change to throw TypeError if these aren't present.
function validInnerResolver(value) {
  const result = resolverToInner.get(value);
  insist(result, "Valid instance required");
  return result;
}

function getInnerVow(value) {
  return vowToInner.get(value);
}

export function resolutionOf(value) {
  const inner = getInnerVow(value);
  if (!inner) {
    return undefined;
  }
  const firstR = inner.resolver;
  const shortHandler = shortenForwards(firstR, inner);
  return shortHandler.value;
}

export function isVow(value) {
  return vowToInner.has(value);
}

function validVow(value) {
  const result = vowToInner.get(value);
  insist(result, "Valid instance required");
  return result;
}

class InnerVow {
  constructor(innerFlow, innerResolver) {
    this.flow = innerFlow;
    this.resolver = innerResolver;
    //def(this);
  }
  get(target, op, receiver) {
    return isSymbol(op)
      ? Reflect.get(target, op, receiver)
      : (...args) => {
        const newResolver = new UnresolvedHandler();
        const resultR = makeResolver(newResolver);
        this.flow.enqueue(this, PendingDelivery(op, args, resultR));
        if (0) {
          // ordering hack, want to remove this
          return new Vow(this.flow, newResolver);
        } else {
          return new Vow(new InnerFlow(), newResolver);
        }
      };
  }

  getOwnPropertyDescriptor(target, name, receiver) {
    //console.log(name);
  }

  enqueueThen(onFulfill, onReject) {
    const newResolver = new UnresolvedHandler();
    const resultR = makeResolver(newResolver);
    this.flow.enqueue(this, PendingThen(onFulfill, onReject, resultR));
    if (0) {
      // didn't need the ordering hack here, not sure why
      return new Vow(this.flow, newResolver);
    } else {
      return new Vow(new InnerFlow(), newResolver);
    }
  }
}

class Vow {
  // TODO move the constructor out
  constructor(innerFlow, innerResolver) {
    const inner = new InnerVow(innerFlow, innerResolver);
    vowToInner.set(this, inner);
    // if .e were enumerable, JSON serialization would recurse forever, which
    // makes debugging annoying
    Object.defineProperty(this, 'e', {
      value: new Proxy({}, inner),
      enumerable: false
    });
    //def(this);
  }

  // TODO need second argument for `then`
  then(onFulfill, onReject) {
    const inner = validVow(this);
    return inner.enqueueThen(onFulfill, onReject);
  }

  fork() {
    const old = validVow(this);
    const f = new InnerFlow();
    return new Vow(f, old.resolver);
  }


  static all(answerPs) {
    let countDown = answerPs.length;
    const answers = [];
    if (countDown === 0) { return Vow.resolve(answers); }
    return new Flow().makeVow((resolve) => {
      answerPs.forEach((answerP, index) => {
        Vow.resolve(answerP).then(answer => {
          answers[index] = answer;
          if (--countDown === 0) { resolve(answers); }
        });
      });
    });
  };

  static join(xP, yP) {
    return Vow.all([xP, yP]).then(([x, y]) => {
      if (Object.is(x, y)) {
        return x;
      } else {
        throw new Error("not the same");
      }
    });
  };

  static race(answerPs) {
    return new Flow().makeVow((resolve,reject) => {
      for (let answerP of answerPs) {
        Vow.resolve(answerP).then(resolve,reject);
      };
    });
  };

  static resolve(val) {
    if (isVow(val)) {
      return val;
    }
    // todo this could be more efficient by looking at farVows[val] and
    // grabbing the handler directly
    const f = new Flow();
    return f.makeVow((resolve, reject) => resolve(val));
  }

  static fromFn(fn) {
    return Vow.resolve().then(() => fn());
  }

}
def(Vow);

const asVow = Vow.resolve;

export { Flow, Vow, makeResolver, asVow };
export default Flow;
