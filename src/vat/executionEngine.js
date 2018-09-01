// the execution engine
import { doSwissHashing } from './swissCrypto';
import { makeResolutionNotifier } from './notifyUponResolution';
import { makeWebkeyMarshal } from './webkey';

export function makeEngine(def,
                           Vow, isVow, Flow,
                           makePresence, makeUnresolvedRemoteVow,
                           handlerOf, resolutionOf,
                           myVatID,
                           manager) {
  const notifyUponResolution = makeResolutionNotifier(log, myVatID, opResolve);

  function allocateSwissStuff() {
    return marshal.allocateSwissStuff();
  }

  function registerRemoteVow(vatID, swissnum, resultVow) {
    marshal.registerRemoteVow(vatID, swissnum, resultVow);
  }

  // todo: queue this until finishTurn
  function opSend(resultSwissbase, targetVatID, targetSwissnum, methodName, args,
                  resolutionOf) {
    const bodyJson = marshal.serialize(def({op: 'send',
                                            resultSwissbase,
                                            targetSwissnum,
                                            methodName,
                                            args,
                                           }),
                                       resolutionOf,
                                       targetVatID);
    manager.sendTo(targetVatID, bodyJson);
  }

  const serializer = {
    opSend,
    notifyUponResolution, allocateSwissStuff, registerRemoteVow,
  };
  const marshal = makeWebkeyMarshal(log,
                                    Vow, isVow, Flow,
                                    makePresence, makeUnresolvedRemoteVow,
                                    myVatID, serializer);
  // marshal.serialize, unserialize, serializeToWebkey, unserializeWebkey

  // temporary, for tests
  const ext = Vow.resolve(makePresence(serializer, 'v2', 'swiss1'));

  function opResolve(targetVatID, targetSwissnum, value) {
    // todo: rename targetSwissnum to mySwissnum? The thing being resolved
    // lives on the sender, not the recipient.
    const bodyJson = marshal.serialize(def({op: 'resolve',
                                            targetSwissnum,
                                            value,
                                           }),
                                       resolutionOf,
                                       targetVatID);
    manager.sendTo(targetVatID, bodyJson);
  }

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
    createPresence(sturdyref) {
      return marshal.createPresence(sturdyref);
    },
    registerTarget(target, swissnum) {
        marshal.registerTarget(target, swissnum, null, resolutionOf);
    },
    // temporary
    marshal,
    serializer,
    ext,
    // tests
    serialize(val, targetVatID) {
      return marshal.serialize(val, resolutionOf, targetVatID);
    },

  };

  return def(engine);
}
