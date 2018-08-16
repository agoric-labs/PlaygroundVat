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
// TODO handle errors
function PendingDelivery(op, args, resultR) {
  const which = whichTodoCounter++;
  const todo = function Delivery(target) {
    //log(`SEND [${which}] ${target} . ${op} (#${args.length})`);
    //log(`SEND ${op}`);
    //if (!Reflect.getOwnPropertyDescriptor(target, op)) {
      //log(`target[${op}] is missing for ${target}`);
    //}
    resultR(target[op](...args));
  };
  //log(`PendingDelivery[${which}] ${op}, ${args}`);
  whichTodo[todo] = which;
  // todo.toString = () => `${resultR.name} => <target>.${op}(${args})`;
  return todo;
}

// TODO handle errors
function PendingThen(onFulfill, onReject, resultR) {
  const which = whichTodoCounter++;
  const todo = function (target) {
    //log(`THEN [${which}]`);
    resultR(onFulfill(target));
  };
  //log(`PendingThen[${which}] ${func}`);
  whichTodo[todo] = which;
  return todo;
}

/**
 * Among objects, all and only promises have handlers.
 */
// a reserved internal placeholder that represents an unresolved value
const UNRESOLVED = {};
const FORWARDED = {};
const AT_EDGE = {};

class InnerResolver {
  constructor(value = UNRESOLVED) {
    this.value = value;
    this.forwardedTo = undefined;
    this.blockedFlows = [];
  }

  get isResolved() {
    return this.value !== UNRESOLVED;
  }

  // Fulfill the vow. Reschedule any flows that were blocked on this vow.
  fulfill(value) {
    insist(this.value === UNRESOLVED);
    this.value = value;
    for (const flow of this.blockedFlows) {
      flow.scheduleUnblocked();
    }
    // TODO clear along the way rather than at the end
    this.blockedFlows.length = 0;
  }

  // Fulfill the vow. Reschedule any flows that were blocked on this vow.
  // TODO get rid of resolver argument?
  forwardTo(valueInner, resolver) {
    insist(this.value === UNRESOLVED);

    const valueR = shortenForwards(valueInner.resolver, valueInner);

    this.forwardedTo = valueR;
    const resValue = valueR.value;
    if (resValue === UNRESOLVED) {
      // TODO check that this works
      this.value = FORWARDED;
      if (this.blockedFlows.length) {
        // There are waiting flows; move them to the end of the chain
        valueR.blockedFlows.push(...this.blockedFlows);
        this.blockedFlows.length = 0;
      }
    } if (resValue === FORWARDED) {
      throw "VOW INTERNAL: shortest node must not be forwarded";
    } if (resValue === AT_EDGE) {
      throw "VOW INTERNAL: UNIMPLEMENTED AT_EDGE";
    } else {
      // it's settled; scheduled waiting flows
      this.value = resValue;

      for (const flow of this.blockedFlows) {
        flow.scheduleUnblocked();
      }
      // TODO clear along the way rather than at the end
      this.blockedFlows.length = 0;
    }
  }

  toStringX() {
    return `VowH {
      value: ${this.value},
      blockedFlows: ${this.blockedFlows.join("  \n")}
    }`;
  }
}
def(InnerResolver);

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
      const processed = this.processShort(shortTarget, todo);
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
      const processed = this.processShort(shortTarget, todo);
      if (processed) {
        // The todo was processed; remove it from pending
        this.pending.shift();
      } else {
        // the target of the next message is unresolved, so break
        break;
      }
    }
  }

  processShort(shortTarget, todo) {
    if (shortTarget.isResolved) {
      scheduleTodo(shortTarget.value, todo);
      return true;
    } else {
      // the target of the next message is unresolved so
      // this flow is now waiting for shortTarget
      shortTarget.blockedFlows.push(this);
      return false;
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

class Flow {
  constructor() {
    flowToInner.set(this, new InnerFlow());
  }

  makeVow(resolveFn) {
    const flow = realInnerFlow(this);
    const innerResolver = new InnerResolver();
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
    // TODO how do we detect already-resolved?
    // TODO use 'this' for the identity
    const valueInner = getInnerVow(value);
    if (valueInner) {
      // the value is a promise; forward to it
      innerResolver.forwardTo(valueInner, resolver);
    } else {
      innerResolver.fulfill(value);
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
        const newResolver = new InnerResolver();
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
    console.log(name);
  }

  enqueueThen(onFulfill, onReject) {
    const newResolver = new InnerResolver();
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
    this.e = new Proxy({}, inner);
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
