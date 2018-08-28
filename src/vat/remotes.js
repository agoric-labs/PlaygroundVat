
function makeRemote(vatID) {
  let queuedMessages = [];
  let nextOutboundSeqnum = 0;
  let nextInboundSeqnum = 0;
  let queuedInboundMessages = new Map(); // seqnum -> msg
  let connection;

  const remote = def({

    gotConnection(c, marshal) {
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

    processInboundQueue(deliver, marshal) {
      //log(`processInboundQueue starting`);
      while (true) {
        //log(` looking for ${nextInboundSeqnum} have [${Array.from(queuedInboundMessages.keys())}]`);
        if (queuedInboundMessages.has(nextInboundSeqnum)) {
          const seqnum = nextInboundSeqnum;
          const msg = queuedInboundMessages.get(seqnum);
          queuedInboundMessages.delete(seqnum);
          nextInboundSeqnum += 1;
          //log(` found it, delivering`);
          deliver(vatID, msg);
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

export function makeRemoteManager() {
  const remotes = new Map();

  function getRemote(vatID) {
    if (!remotes.has(vatID)) {
      remotes.set(vatID, makeRemote(vatID));
    }
    return remotes.get(vatID);
  }

  const manager = def({

    gotConnection(vatID, connection, marshal) {
      getRemote(vatID).gotConnection(connection, marshal);
    },

    lostConnection(vatID) {
      getRemote(vatID).lostConnection();
    },

    whatConnectionsDoYouWant() {
      return Array.from(remotes.keys()).filter(vatID => {
        return remotes.get(vatID).haveOutbound();
      });
    },

    // inbound

    queueInbound(vatID, seqnum, msg) {
      getRemote(vatID).queueInbound(seqnum, msg);
    },

    processInboundQueue(vatID, deliver, marshal) {
      getRemote(vatID).processInboundQueue(deliver, marshal);
    },

    // outbound

    nextOutboundSeqnum(vatID) {
      return getRemote(vatID).nextOutboundSeqnum();
    },

    sendTo(vatID, msg) {
      // add to a per-targetVatID queue, and if we have a current connection,
      // send it
      log(`sendTo ${vatID} ${msg}`);
      getRemote(vatID).sendTo(msg);
    },

    ackOutbound(vatID, ackSeqnum) {
      getRemote(vatID).ackOutbound(ackSeqnum);
    },
  });
  return manager;
}
