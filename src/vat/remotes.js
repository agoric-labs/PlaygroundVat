import { makeScoreboard } from './scoreboard';

function buildAck(ackSeqnum) {
  return JSON.stringify({type: 'ack', ackSeqnum});
}

const OP = 'op ';
const DECIDE = 'decide ';

function parseVatID(vatID) {
  if (vatID.indexOf('-') === -1) {
    return { count: 1,
             members: new Set([vatID]),
             leader: vatID,
           }; // solo vat
  } else {
    const pieces = vatID.split('-');
    if (!pieces[0].startsWith('q')) {
      throw new Error(`unknown VatID type: ${vatID}`);
    }
    const count = Number.from(pieces[0].slice(1));
    return { threshold: count,
             members: new Set(pieces.slice(1)),
             leader: pieces[1],
           };
  }
}

function makeRemoteForVatID(vatID, def, insist, logConflict) {
  let nextOutboundSeqnum = 0;

  // inbound management
  const { threshold, members } = parseVatID(vatID);

  // readyMessage is the next valid message from this sender, if any. It has
  // passed any Quorum Vat membership thresholds, and is waiting for a
  // decision from our own quorum Leader
  let readyMessage;

  function quorumTest(componentIDs) {
    // we pre-filter by fromHostID in gotHostMessage(), so this can be just
    // a simple count
    return componentIDs.size >= threshold;
  }

  const scoreboard = makeScoreboard(quorumTest, def, insist, logConflict);

  function gotHostMessage(fromHostID, msgID, hostMessage) {
    const fromVatID = hostMessage.fromVatID;
    if (hostMessage.seqnum === undefined) {
      throw new Error(`message is missing seqnum: ${hostMessage}`);
    }
    if (!members.has(fromHostID)) {
      log(`not a member`);
      return false; // todo: drop the connection
    }
    if (scoreboard.acceptProtoMsg(fromHostID, hostMessage.seqnum,
                                  msgID, hostMessage)) {
      if (!readyMessage) {
        readyMessage = scoreboard.getMessage();
        return readyMessage;
      }
    }
    return false;
  }

  return {
    nextOutboundSeqnum() {
      const seqnum = nextOutboundSeqnum;
      nextOutboundSeqnum += 1;
      return seqnum;
    },
    gotHostMessage,
    getReadyMessage() {
      return readyMessage;
    },
  };
}

function makeDecisionList(isLeader, getVatRemote, deliver) {
  let nextDecisionSeqnum = 0;
  const decisionList = []; // { decisionSeqnum, fromVatID, vatSeqnum }

  function checkDelivery() {
    while(decisionList.length) {
      const next = decisionList[0];
      const r = getVatRemote(next.fromVatID);
      const m = r.getReadyMessage();
      if (!m || m.seqnum !== next.seqnum) {
        return;
      }
      deliver(next.fromVatID, m);
      decisionList.shift();
    }
  }

  function addMessage(fromVatID, m) {
    if (isLeader) {
      // If we're the Leader (or we're in a Solo Vat, so we're our own Leader),
      // each complete message will arrive here, and we'll add it to the list.
      // In this case, we're the only one adding to the list, so it will always
      // be sorted.
      decisionList.push({ decisionSeqnum: nextDecisionSeqnum,
                          fromVatID: fromVatID,
                          vatSeqnum: m.seqnum });
      nextDecisionSeqnum += 1;
      // todo: notify followers
    }
    // in either case, we now check to see if something can be delivered
    checkDelivery();
  }

  function addDecision(m) {
    // add to the queue if not already there, sort, checkDelivery
    if (isLeader) {
      log(`I am the leader, don't tell me what to do`);
      return;
    }
    for (let d in decisionList) {
      if (d.decisionSeqnum === m.decisionSeqnum) {
        if (d.fromVatID !== m.fromVatID ||
            d.vatSeqnum !== m.vatSeqnum) {
          log(`leader equivocated, says ${JSON.stringify(m)} but previously said ${JSON.stringify(d)}`);
          return;
        }
        // otherwise it is a duplicate, so ignore it
      }
    }
    // todo: be clever, remember the right insertion index instead of sorting
    decisionList.push({ decisionSeqnum: m.decisionSeqnum,
                        fromVatID: m.fromVatID,
                        vatSeqnum: m.vatSeqnum });
    function cmp(a, b) {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }
    decisionList.sort((a,b) => cmp(a.decisionSeqnum, b.decisionSeqnum));
    checkDelivery();
  }

  return {
    addMessage,
    addDecision,
  };

}

export function makeRemoteManager(myVatID, leaderHostID, isLeader,
                                  managerWriteInput, managerWriteOutput,
                                  def, insist, logConflict) {
  const remotes = new Map();
  let engine;
  //let leaderHostID = parseVatID(myVatID).leader;

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
      remotes.set(vatID, makeRemoteForVatID(vatID, def, insist, logConflict));
    }
    return remotes.get(vatID);
  }

  const dl = makeDecisionList(isLeader, getVatRemote, deliver);

  function deliver(fromVatID, m) {
    managerWriteInput(XX);
    engine.rxMessage(fromVatID, m);
    // todo: now send an ack
  }

  function commsReceived(fromHostID, line, marshal) {
    log(`commsReceived ${fromHostID}, ${line}`);
    const hr = getHostRemote(fromHostID);
    // 'line' is one of:
    // * op JSON(vatMessage)
    // * decide JSON(leaderDecision)
    if (line.startsWith(OP)) {
      const hostMessage = JSON.parse(line.slice(OP.length));
      const msgID = line.slice(OP.length); // todo: could be a hash
      const r = getVatRemote(hostMessage.fromVatID);
      const newMessage = r.gotHostMessage(fromHostID, msgID, hostMessage);
      if (newMessage) {
        // there is a new message ready for this sender
        dl.addMessage(hostMessage.fromVatID, newMessage); // does checkDelivery()
      }
      // else either there was an old message ready, or there are no messages
      // ready, so receipt of this host message cannot trigger any deliveries
    } else if (line.startsWith(DECIDE)) {
      if (fromHostID !== leaderHostID) {
        log(`got DECIDE from ${fromHostID} but my leader is ${leaderHostID}, ignoring`);
        // todo: drop connection
        return;
      }
      const decideMessage = JSON.parse(line.slice(DECIDE.length));
      dl.addDecision(decideMessage);
    } else {
      log(`unrecognized line: ${line}`);
      // todo: drop this connection
      return;
    }

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

  function sendTo(vatID, body) {
    if (typeof body !== 'object' || !body.hasOwnProperty('op')) {
      throw new Error('sendTo must be given an object');
    }
    const vatRemote = getVatRemote(vatID);
    const seqnum = vatRemote.nextOutboundSeqnum();
    const vatMessageJson = { fromVatID: myVatID,
                             toVatID: vatID,
                             seqnum: seqnum,
                             msg: body,
                           };
    // we don't need webkey.marshal, this is just plain JSON
    const vatMessage = JSON.stringify(vatMessageJson);
    const hostMessage = `${OP}${vatMessage}`; // future todo: append signature
    log(`sendTo ${vatID} [${seqnum}] ${hostMessage}`);
    managerWriteOutput(hostMessage);

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
