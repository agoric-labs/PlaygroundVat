// the execution engine
import { doSwissHashing } from './swissCrypto';

export function makeEngine(def, Vow, handlerOf, resolutionOf,
                           myVatID,
                           marshal) {

  function rxSendOnly(message) { // currently just for debugging
    const body = marshal.unserialize(message);
    return doSendInternal(body);
  }

  function doSendInternal(body) {
    const target = marshal.getMyTargetBySwissnum(body.targetSwissnum);
    if (!target) {
      throw new Error(`unrecognized target swissnum ${body.targetSwissnum}`);
    }
    // todo: sometimes causes turn delay, could fastpath if target is
    // resolved
    return Vow.resolve(target).e[body.methodName](...body.args);
  }

  function rxMessage(senderVatID, message) {
    // message is a string, JSON serialized to { op, target, args, answerR }
    // We are strictly given messages in-order from each sender
    const body = marshal.unserialize(message);

    // todo: It does not include seqnum (which must be visible to the manager).
    // sent messages are assigned a seqnum by the manager
    //txMessage(recipientVatID, message)

    log(`op ${body.op}`);
    let done;
    if (body.op === 'send') {
      const res = doSendInternal(body);
      if (body.resultSwissbase) {
        const resolverSwissnum = doSwissHashing(body.resultSwissbase);
        // registerTarget arranges to notify senderVatID when this resolves
        marshal.registerTarget(res, resolverSwissnum, senderVatID, resolutionOf);
        // note: BrokenVow is pass-by-copy, so Vow.resolve(rej) causes a BrokenVow
      } else {
        // else it was really a sendOnly
        log(`commsReceived got sendOnly, dropping result`);
      }
      done = res; // for testing
    } else if (body.op === `resolve`) {
      const h = marshal.getOutboundResolver(senderVatID, body.targetSwissnum, handlerOf);
      //log(`h: ${h}`);
      h.resolve(body.value);
    }
    return done; // for testing, to wait until things are done
  }

  const engine = {
    rxMessage,
    rxSendOnly,
  };

  return def(engine);
}
