
function makeRemote(vatID, engine, managerWriteInput) {
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
        const ackBodyJson = JSON.stringify({op: 'ack', ackSeqnum: nextInboundSeqnum-1});
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
          managerWriteInput(vatID, msg.bodyJson);
          engine.rxMessage(vatID, msg.bodyJson);
          // deliver() adds the message to our checkpoint, so time to ack it
          if (connection) {
            const ackBodyJson = JSON.stringify({op: 'ack', ackSeqnum: seqnum});
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
      remotes.set(vatID, makeRemote(vatID, engine, managerWriteInput));
    }
    return remotes.get(vatID);
  }

  function commsReceived(senderVatID, bodyJson, marshal) {
    log(`commsReceived ${senderVatID}, ${bodyJson}`);
    const body = marshal.unserialize(bodyJson);
    if (body.op === 'ack') {
      ackOutbound(senderVatID, body.ackSeqnum);
      return;
    }
    if (body.seqnum === undefined) {
      throw new Error(`message is missing seqnum: ${bodyJson}`);
    }
    getRemote(senderVatID).queueInbound(body.seqnum, { body, bodyJson });
    getRemote(senderVatID).processInboundQueue();
  }

  function ackOutbound(vatID, ackSeqnum) {
    getRemote(vatID).ackOutbound(ackSeqnum);
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
    // add to a per-targetVatID queue, and if we have a current connection,
    // send it
    log(`sendTo ${vatID} ${msg}`);
    getRemote(vatID).sendTo(msg);
    managerWriteOutput(vatID, msg);
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

    ackOutbound,
  });
  return manager;
}
