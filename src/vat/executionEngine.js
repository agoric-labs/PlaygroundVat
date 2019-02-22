// the execution engine

/* eslint-disable-next-line import/no-extraneous-dependencies */
import harden from '@agoric/harden';
import { doSwissHashing } from './swissCrypto';
import { makeWebkeyMarshal } from './webkey';

export function makeEngine(
  hash58,
  Vow,
  isVow,
  Flow,
  makePresence,
  makeUnresolvedRemoteVow,
  handlerOf,
  resolutionOf,
  myVatID,
  myVatSecret,
  manager,
) {
  function allocateSwissStuff() {
    /* eslint-disable-next-line no-use-before-define */
    return marshal.allocateSwissStuff();
  }

  function registerRemoteVow(vatID, swissnum, resultVow) {
    /* eslint-disable-next-line no-use-before-define */
    marshal.registerRemoteVow(vatID, swissnum, resultVow);
  }

  // todo: queue this until finishTurn
  function opSend(
    resultSwissbase,
    targetVatID,
    targetSwissnum,
    methodName,
    args,
    /* eslint-disable-next-line no-shadow */
    resolutionOf,
  ) {
    /* eslint-disable-next-line no-use-before-define */
    const argsS = marshal.serialize(harden(args), resolutionOf);
    const body = harden({
      op: 'send',
      targetSwissnum,
      methodName,
      argsS,
      resultSwissbase,
    });
    manager.sendTo(targetVatID, body);
  }

  function opWhen(targetVatID, targetSwissnum) {
    const body = harden({ op: 'when', targetSwissnum });
    manager.sendTo(targetVatID, body);
  }

  const serializer = {
    opSend,
    opWhen,
    allocateSwissStuff,
    registerRemoteVow,
  };

  const marshal = makeWebkeyMarshal(
    hash58,
    Vow,
    isVow,
    Flow,
    makePresence,
    makeUnresolvedRemoteVow,
    myVatID,
    myVatSecret,
    serializer,
  );
  // marshal.serialize, unserialize, serializeToWebkey, unserializeWebkey

  // temporary, for tests
  const ext = Vow.resolve(makePresence(serializer, 'v2', 'swiss1'));

  function opResolve(targetVatID, targetSwissnum, value) {
    // todo: rename targetSwissnum to mySwissnum? The thing being resolved
    // lives on the sender, not the recipient.
    const valueS = marshal.serialize(harden(value), resolutionOf);
    const body = harden({ op: 'resolve', targetSwissnum, valueS });
    manager.sendTo(targetVatID, body);
  }

  function doSendInternal(opMsg) {
    const target = marshal.getMyTargetBySwissnum(opMsg.targetSwissnum);
    if (!target) {
      throw new Error(`unrecognized target, swissnum=${opMsg.targetSwissnum}`);
    }
    if (!opMsg.argsS) {
      throw new Error('opMsg is missing .argsS');
    }
    const args = marshal.unserialize(opMsg.argsS);
    // todo: sometimes causes turn delay, could fastpath if target is
    // resolved
    return Vow.resolve(target).e[opMsg.methodName](...args);
  }

  function rxSendOnly(opMsg) {
    // currently just for tests
    return doSendInternal(opMsg);
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
        marshal.registerTarget(res, resolverSwissnum, resolutionOf);
        // note: BrokenVow is pass-by-copy, so Vow.resolve(rej) causes a BrokenVow
      } else {
        // else it was really a sendOnly
        console.log(`commsReceived got sendOnly, dropping result`);
      }
      done = res; // for testing
    } else if (opMsg.op === 'when') {
      const v = marshal.getMyTargetBySwissnum(opMsg.targetSwissnum);
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
      const h = marshal.getOutboundResolver(
        senderVatID,
        opMsg.targetSwissnum,
        handlerOf,
      );
      // console.log(`h: ${h}`);
      // console.log('found target');
      let value;
      try {
        value = marshal.unserialize(opMsg.valueS);
      } catch (ex) {
        console.log('exception in unserialize of:', opMsg.valueS);
        console.log(ex);
        throw ex;
      }
      // console.log('found value', value);
      h.resolve(value);
      // console.log('did h.resolve');
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
      marshal.registerTarget(target, swissnum, resolutionOf);
    },
    // temporary
    marshal,
    serializer,
    ext,
    // tests
    serialize(val) {
      return marshal.serialize(val, resolutionOf);
    },
  };

  return harden(engine);
}
