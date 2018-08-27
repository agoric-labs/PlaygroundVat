
function makeRemote(vatID) {
  let queuedMessages = [];
  let nextOutboundSeqnum = 0;
  let nextInboundSeqnum = 0;
  let queuedInboundMessages = new Map(); // seqnum -> msg
  let connection;

  const remote = def({
    queueInbound(seqnum, msg) {
      // todo: remember the first, or the last? bail if they differ?
      log(`queueInbound got ${seqnum}, have [${Array.from(queuedInboundMessages.keys())}], want ${nextInboundSeqnum}`);
      queuedInboundMessages.set(seqnum, msg);
    },
    nextOutboundSeqnum() {
      const seqnum = nextOutboundSeqnum;
      nextOutboundSeqnum += 1;
      return seqnum;
    },

    processInboundQueue(deliver) {
      //log(`processInboundQueue starting`);
      while (true) {
        //log(` looking for ${nextInboundSeqnum} have [${Array.from(queuedInboundMessages.keys())}]`);
        if (queuedInboundMessages.has(nextInboundSeqnum)) {
          const msg = queuedInboundMessages.get(nextInboundSeqnum);
          queuedInboundMessages.delete(nextInboundSeqnum);
          nextInboundSeqnum += 1;
          //log(` found it, delivering`);
          deliver(vatID, msg);
        } else {
          //log(` not found, returning`);
          return;
        }
      }
    },

    gotConnection(c) {
      connection = c;
      for (let msg of queuedMessages) {
        connection.send(msg);
      }
    },

    lostConnection() {
      connection = undefined;
    },

    sendTo(msg) {
      queuedMessages.push(msg);
      if (connection) {
        connection.send(msg);
      }
    },

    haveOutbound() {
      return !!queuedMessages.length;
    },

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
    queueInbound(vatID, seqnum, msg) {
      getRemote(vatID).queueInbound(seqnum, msg);
    },

    processInboundQueue(vatID, deliver) {
      getRemote(vatID).processInboundQueue(deliver);
    },

    gotConnection(vatID, connection) {
      getRemote(vatID).gotConnection(connection);
    },

    lostConnection(vatID) {
      getRemote(vatID).lostConnection();
    },

    whatConnectionsDoYouWant() {
      return Array.from(remotes.keys()).filter(vatID => {
        return remotes.get(vatID).haveOutbound();
      });
    },

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
