function buildAck(ackSeqnum) {
  return JSON.stringify({type: 'ack', ackSeqnum});
}

function vatIDToHostIDs(vatID) {
  if (vatID.indexOf('-') === -1) {
    return [vatID]; // solo vat
  } else {
    const pieces = vatID.split('-');
    if (!pieces[0].startsWith('q')) {
      throw new Error(`unknown VatID type: ${vatID}`);
    }
    return vatID.slice(1);
  }
}

function makeRemoteForVatID(vatID) {
  let nextOutboundSeqnum = 0;
  let hostIDs = vatIDToHostIDs(vatID);

  return {
    nextOutboundSeqnum() {
      const seqnum = nextOutboundSeqnum;
      nextOutboundSeqnum += 1;
      return seqnum;
    },
    hostIDs,
  };
}


function makeRemoteForHostID(hostID, engine, managerWriteInput) {
  let queuedMessages = [];
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
          managerWriteInput(hostID, seqnum, msg);
          engine.rxMessage(hostID, msg);
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

    sendHostMessage(msg) {
      queuedMessages.push(msg);
      if (connection) {
        connection.send(msg);
      }
    },

    // inbound acks remove outbound messages from the pending queue

    ackOutbound(hostID, ackSeqnum) {
      queuedMessages = queuedMessages.filter(m => m.seqnum !== ackSeqnum);
    },

  });
  return remote;
}

export function makeRemoteManager(myVatID,
                                  managerWriteInput, managerWriteOutput) {
  const remotes = new Map();
  let engine;

  function getHostRemote(hostID) {
    if (!remotes.has(hostID)) {
      if (!engine) {
        throw new Error('engine is not yet set');
      }
      remotes.set(hostID, makeRemoteForHostID(hostID, engine, managerWriteInput));
    }
    return remotes.get(hostID);
  }

  function getVatRemote(vatID) {
    if (!remotes.has(vatID)) {
      if (!engine) {
        throw new Error('engine is not yet set');
      }
      remotes.set(vatID, makeRemoteForVatID(vatID));
    }
    return remotes.get(vatID);
  }

  function commsReceived(senderHostID, hostMessageJson, marshal) {
    log(`commsReceived ${senderHostID}, ${hostMessageJson}`);
    const r = getHostRemote(senderHostID);
    const hostMessage = JSON.parse(hostMessageJson);
    

    if (hostMessage.type === 'ack') {
      r.ackOutbound(hostMessage.ackSeqnum);
      return;
    }
    if (hostMessage.seqnum === undefined) {
      throw new Error(`message is missing seqnum: ${hostMessageJson}`);
    }
    // todo: hostMessage.targetVatID is the composite target, use it to select
    // the scoreboard to populate, and check that senderHostID is a member
    r.queueInbound(hostMessage.seqnum, hostMessage.msg);
    r.processInboundQueue();
  }

  function gotConnection(hostID, connection) {
    getHostRemote(hostID).gotConnection(connection);
  }

  function lostConnection(hostID) {
    getHostRemote(hostID).lostConnection();
  }

  function whatConnectionsDoYouWant() {
    return Array.from(remotes.keys()).filter(hostID => {
      return remotes.get(hostID).haveOutbound();
    });
  }

  function sendTo(vatID, msg) {
    if (typeof msg !== 'string') {
      throw new Error('sendTo must be given a string');
    }
    const vatRemote = getVatRemote(vatID);
    const seqnum = vatRemote.nextOutboundSeqnum();
    log(`sendTo ${vatID} [${seqnum}] ${msg}`);

    const hostMessageJson = { type: 'op',
                              senderVatID: myVatID,
                              targetVatID: vatID,
                              seqnum: seqnum,
                              msg: msg,
                            };
    // we don't need webkey.marshal, this is just plain JSON
    const hostMessage = JSON.stringify(hostMessageJson);
    managerWriteOutput(vatID, seqnum, hostMessage);

    for (let hostID of vatRemote.hostIDs) {
      // now add to a per-targetHostID queue, and if we have a current
      // connection, send it
      getHostRemote(hostID).sendHostMessage(hostMessage);
    }
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
    sendTo,
  });
  return manager;
}
