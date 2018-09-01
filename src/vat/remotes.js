function buildAck(ackSeqnum) {
  return JSON.stringify({type: 'ack', ackSeqnum});
}

function makeRemoteForVatID(vatID, engine, managerWriteInput) {
  let queuedMessages = [];
  let nextOutboundSeqnum = 0;
  let nextInboundSeqnum = 0;
  let queuedInboundMessages = new Map(); // seqnum -> msg
  let connection;

  const remote = def({

    gotConnection(c) {
      connection = c;
      if (nextInboundSeqnum > 0) {
        // I'm using JSON.stringify instead of marshal.serialize because that
        // now requires extra stuff like target vatID, in case the thing
        // being serialized includes unresolved Vows, and for opAck we know
        // we don't need that
        const ackBodyJson = buildAck(nextInboundSeqnum);
        connection.send(ackBodyJson);
      }
      for (let msg of queuedMessages) {
        connection.send(msg);
      }
    },

    lostConnection() {
      connection = undefined;
    },

    // inbound

    queueInbound(seqnum, msg) {
      // todo: remember the first, or the last? bail if they differ?
      log(`queueInbound got ${seqnum}, have [${Array.from(queuedInboundMessages.keys())}], want ${nextInboundSeqnum}`);
      queuedInboundMessages.set(seqnum, msg);
    },

    processInboundQueue() {
      //log(`processInboundQueue starting`);
      while (true) {
        //log(` looking for ${nextInboundSeqnum} have [${Array.from(queuedInboundMessages.keys())}]`);
        if (queuedInboundMessages.has(nextInboundSeqnum)) {
          const seqnum = nextInboundSeqnum;
          const msg = queuedInboundMessages.get(seqnum);
          queuedInboundMessages.delete(seqnum);
          nextInboundSeqnum += 1;
          //log(` found it, delivering`);
          managerWriteInput(vatID, seqnum, msg);
          engine.rxMessage(vatID, msg);
          // deliver() adds the message to our checkpoint, so time to ack it
          if (connection) {
            const ackBodyJson = buildAck(seqnum);
            connection.send(ackBodyJson);
          }
        } else {
          //log(` not found, returning`);
          return;
        }
      }
    },

    // outbound

    haveOutbound() {
      return !!queuedMessages.length;
    },

    nextOutboundSeqnum() {
      const seqnum = nextOutboundSeqnum;
      nextOutboundSeqnum += 1;
      return seqnum;
    },

    sendTo(msg) {
      queuedMessages.push(msg);
      if (connection) {
        connection.send(msg);
      }
    },

    // inbound acks remove outbound messages from the pending queue

    ackOutbound(vatID, ackSeqnum) {
      queuedMessages = queuedMessages.filter(m => m.seqnum !== ackSeqnum);
    },

  });
  return remote;
}

export function makeRemoteManager(managerWriteInput, managerWriteOutput) {
  const remotes = new Map();
  let engine;

  function getRemote(vatID) {
    if (!remotes.has(vatID)) {
      if (!engine) {
        throw new Error('engine is not yet set');
      }
      remotes.set(vatID, makeRemoteForVatID(vatID, engine, managerWriteInput));
    }
    return remotes.get(vatID);
  }

  function commsReceived(senderVatID, payloadJson, marshal) {
    log(`commsReceived ${senderVatID}, ${payloadJson}`);
    const r = getRemote(senderVatID);
    const payload = JSON.parse(payloadJson);
    if (payload.type === 'ack') {
      r.ackOutbound(payload.ackSeqnum);
      return;
    }
    if (payload.seqnum === undefined) {
      throw new Error(`message is missing seqnum: ${payloadJson}`);
    }
    // todo: payload.targetVatID is the composite target, use it to select
    // the scoreboard to populate, and check that senderVatID is a member
    r.queueInbound(payload.seqnum, payload.msg);
    r.processInboundQueue();
  }

  function gotConnection(vatID, connection) {
    getRemote(vatID).gotConnection(connection);
  }

  function lostConnection(vatID) {
    getRemote(vatID).lostConnection();
  }

  function whatConnectionsDoYouWant() {
    return Array.from(remotes.keys()).filter(vatID => {
      return remotes.get(vatID).haveOutbound();
    });
  }

  function nextOutboundSeqnum(vatID) {
    return getRemote(vatID).nextOutboundSeqnum();
  }

  function sendTo(vatID, msg) {
    if (typeof msg !== 'string') {
      throw new Error('sendTo must be given a string');
    }
    const seqnum = getRemote(vatID).nextOutboundSeqnum();
    log(`sendTo ${vatID} [${seqnum}] ${msg}`);
    const payloadJson = { type: 'op',
                          targetVatID: vatID,
                          seqnum: seqnum,
                          msg: msg };
    // we don't need webkey.marshal, this is just plain JSON
    const payload = JSON.stringify(payloadJson);
    // now add to a per-targetVatID queue, and if we have a current
    // connection, send it
    getRemote(vatID).sendTo(payload);
    managerWriteOutput(vatID, seqnum, payload);
  }

  const manager = def({
    setEngine(e) {
      engine = e;
    },

    gotConnection,
    lostConnection,
    whatConnectionsDoYouWant,

    // inbound
    commsReceived,

    // outbound
    nextOutboundSeqnum,
    sendTo,
  });
  return manager;
}
