import harden from '@agoric/harden';
import { makeScoreboard } from './scoreboard';
import { insist } from '../insist';
import { vatMessageIDHash } from './swissCrypto';
import { parseVatID } from './id';

function buildAck(ackSeqnum) {
  return JSON.stringify({ type: 'ack', ackSeqnum });
}

const OP = 'op ';
const DECIDE = 'decide ';

export function makeRemoteForVatID(vatID, logConflict) {
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

  const scoreboard = makeScoreboard(quorumTest, logConflict);

  function getReadyMessage() {
    if (!readyMessage) {
      readyMessage = scoreboard.getNext();
    }
    return readyMessage;
  }

  function consumeReadyMessage() {
    readyMessage = undefined;
  }

  function gotHostMessage(evidence, msgID, hostMessageAndWire) {
    const { hostMessage, wireMessage } = hostMessageAndWire;
    const fromVatID = hostMessage.fromVatID;
    if (hostMessage.seqnum === undefined) {
      throw new Error(`message is missing seqnum: ${hostMessage}`);
    }

    // evidence check: does this message come from a real member host?
    if (!members.has(evidence.fromHostID)) {
      console.log(
        `not a member`,
        Array.from(members.values()),
        evidence.fromHostID,
      );
      return undefined; // todo: sulk a bit, maybe drop the connection
    }
    const fromHostID = evidence.fromHostID;

    if (
      scoreboard.acceptProtoMsg(fromHostID, hostMessage.seqnum, msgID, {
        id: msgID,
        hostMessage,
        wireMessage,
      })
    ) {
      return getReadyMessage();
    }
    return undefined;
  }

  return {
    nextOutboundSeqnum() {
      const seqnum = nextOutboundSeqnum;
      nextOutboundSeqnum += 1;
      return seqnum;
    },
    hostIDs: members,
    gotHostMessage,
    getReadyMessage,
    consumeReadyMessage,
  };
}

export function makeDecisionList(
  myVatID,
  isLeader,
  followers,
  getReadyMessages,
  deliver,
  sendDecisionTo,
) {
  let nextLeaderSeqnum = 0;
  let nextDeliverySeqnum = 0;
  const decisionList = []; // each entry contains:
  // toVatID: always equal to myVatID (else we'd have rejected it)
  // decisionSeqnum
  // vatMessageID (nominally a hash of the Vat Message)
  // and other debug* fields
  //
  // for now vatMessageID is just a serialization of the whole thing

  function checkDelivery() {
    // console.log('decisionList:', decisionList);
    while (decisionList.length) {
      // console.log('looking for', nextDeliverySeqnum);
      const next = decisionList[0];
      if (next.decisionSeqnum !== nextDeliverySeqnum) {
        // we received decisions out of order, wait for the right one
        // console.log(' seqnum bail');
        return;
      }
      let found = false;
      for (const [vatID, sm, consume] of getReadyMessages()) {
        // console.log(' looking at', sm);
        // console.log(' comparing ', next.vatMessageID);
        if (sm.id === next.vatMessageID) {
          // console.log('  delivering');
          decisionList.shift();
          consume();
          nextDeliverySeqnum = next.decisionSeqnum + 1;
          deliver(vatID, sm.hostMessage, sm.wireMessage);
          found = true;
          break;
        }
      }
      if (!found) {
        return;
      }
    }
  }

  function addMessage(sm) {
    if (isLeader) {
      // If we're the Leader (or we're in a Solo Vat, so we're our own Leader),
      // each complete message will arrive here, and we'll add it to the list.
      // In this case, we're the only one adding to the list, so it will always
      // be sorted.
      const dm = {
        toVatID: myVatID,
        decisionSeqnum: nextLeaderSeqnum,
        vatMessageID: sm.id,
        // these are for debugging
        debug_fromVatID: sm.hostMessage.fromVatID,
        debug_vatSeqnum: sm.hostMessage.seqnum,
      };
      decisionList.push(dm);
      nextLeaderSeqnum += 1;
      // notify followers
      for (const hostID of followers) {
        sendDecisionTo(hostID, dm);
      }
    }
    // in either case, we now check to see if something can be delivered
    checkDelivery();
  }

  function addDecision(dm) {
    // dm is { toVatID, decisionSeqnum, vatMessageID, debug_fromVatID,
    // debug_vatSeqnum }

    // vatMessageID is authoritative, debug_* are alleged and ignored

    // add to the queue if not already there, sort, checkDelivery
    if (isLeader) {
      console.log(`I am the leader, don't tell me what to do`);
      return;
    }

    if (dm.toVatID !== myVatID) {
      console.log(
        `Leader is talking to the wrong vat: I am ${myVatID}, to=${dm.toVatID}`,
      );
      return;
    }

    if (dm.decisionSeqnum < nextDeliverySeqnum) {
      // got stale decision, ignore it
      return;
    }

    for (const d in decisionList) {
      if (d.decisionSeqnum === dm.decisionSeqnum) {
        if (d.vatMessageID !== dm.vatMessageID) {
          console.log(
            `leader equivocated, says ${JSON.stringify(
              dm,
            )} but previously said ${JSON.stringify(d)}`,
          );
          return;
        }
        // otherwise it is a duplicate, so ignore it
      }
    }

    // todo: be clever, remember the right insertion index instead of sorting
    decisionList.push(dm);
    function cmp(a, b) {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }
    decisionList.sort((a, b) => cmp(a.decisionSeqnum, b.decisionSeqnum));
    checkDelivery();
  }

  return {
    addMessage,
    addDecision,
    debug_getDecisionList() {
      return decisionList;
    },
    debug_getNextLeaderSeqnum() {
      return nextLeaderSeqnum;
    },
    debug_getNextDeliverySeqnum() {
      return nextDeliverySeqnum;
    },
  };
}

export function makeRemoteManager(
  myVatID,
  myHostID,
  comms,
  managerWriteInput,
  managerWriteOutput,
  logConflict,
  hash58,
) {
  const vatRemotes = new Map();
  const hostRemotes = new Map();
  let engine;
  const parsed = parseVatID(myVatID);
  const leaderHostID = parsed.leader;
  const isLeader = leaderHostID === myHostID;
  const followers = parsed.followers;

  function getHostRemote(hostID) {
    if (!hostRemotes.has(hostID)) {
      if (!engine) {
        throw new Error('engine is not yet set');
      }
      hostRemotes.set(
        hostID,
        makeRemoteForHostID(hostID, comms, managerWriteInput),
      );
    }
    return hostRemotes.get(hostID);
  }

  function getVatRemote(vatID) {
    if (!vatRemotes.has(vatID)) {
      vatRemotes.set(vatID, makeRemoteForVatID(vatID, logConflict));
    }
    return vatRemotes.get(vatID);
  }

  function* getReadyMessages() {
    for (const [vatID, r] of vatRemotes.entries()) {
      const sm = r.getReadyMessage();
      if (sm) {
        yield [vatID, sm, r.consumeReadyMessage];
      }
    }
  }

  function sendDecisionTo(toHostID, decisionMessageJson) {
    const decisionMessage = JSON.stringify(decisionMessageJson);
    // future todo: append signature
    const wireMessage = `${DECIDE}${decisionMessage}`;
    getHostRemote(toHostID).sendHostMessage(wireMessage);
  }

  const dl = makeDecisionList(
    myVatID,
    isLeader,
    followers,
    getReadyMessages,
    deliver,
    sendDecisionTo,
  );

  function deliver(fromVatID, hostMessage, wireMessage) {
    // todo: retain the serialized form, for the transcript

    // create a form that's more useful for logging, by JSON-parsing the
    // argument string. The real delivery uses marshal.unserialize, which
    // converts various @qclass things into special types. For logging we
    // want to leave those as @qclass things.
    {
      const copy = JSON.parse(JSON.stringify(hostMessage)); // deep copy
      if (copy.opMsg && copy.opMsg.argsS) {
        copy.opMsg.args = JSON.parse(copy.opMsg.argsS);
        delete copy.opMsg.argsS;
      }
      if (copy.opMsg && copy.opMsg.valueS) {
        copy.opMsg.value = JSON.parse(copy.opMsg.valueS);
        delete copy.opMsg.valueS;
      }
      console.log('DELIVER', fromVatID, JSON.stringify(copy, null, 2));
    }

    managerWriteInput(fromVatID, wireMessage);
    engine.rxMessage(fromVatID, hostMessage.opMsg);
    // todo: now send an ack
  }

  function commsReceived(fromHostID, wireMessage) {
    // console.log(`commsReceived ${fromHostID}, ${wireMessage}`);
    const hr = getHostRemote(fromHostID);
    // 'wireMessage' is one of:
    // * op JSON(vatMessage)
    // * decide JSON(leaderDecision)
    if (wireMessage.startsWith(OP)) {
      const hostMessage = JSON.parse(wireMessage.slice(OP.length));
      const hostMessageAndWire = { hostMessage, wireMessage };
      const msgID = vatMessageIDHash(wireMessage.slice(OP.length), hash58);
      // todo: assert that toVatID === myVatID
      const toVatID = hostMessage.toVatID;
      const fromVatID = hostMessage.fromVatID;
      const r = getVatRemote(fromVatID);
      const evidence = { fromHostID }; // todo future: cert chain

      const newMessage = r.gotHostMessage(evidence, msgID, hostMessageAndWire);
      if (newMessage) {
        // there is a new message ready for this sender
        dl.addMessage(newMessage); // does checkDelivery()
      }
      // else either there was an old message ready, or there are no messages
      // ready, so receipt of this host message cannot trigger any deliveries
    } else if (wireMessage.startsWith(DECIDE)) {
      if (fromHostID !== leaderHostID) {
        console.log(
          `got DECIDE from ${fromHostID} but my leader is ${leaderHostID}, ignoring`,
        );
        // todo: drop connection
        return;
      }
      const decisionMessage = JSON.parse(wireMessage.slice(DECIDE.length));
      dl.addDecision(decisionMessage);
    } else {
      console.log(`unrecognized wireMessage: ${wireMessage}`);
      // todo: drop this connection
    }
  }

  function connectionMade(hostID, connection) {
    getHostRemote(hostID).connectionMade(connection);
  }

  function connectionLost(hostID) {
    getHostRemote(hostID).connectionLost();
  }

  function sendTo(vatID, body) {
    if (typeof body !== 'object' || !body.hasOwnProperty('op')) {
      throw new Error('sendTo must be given an object');
    }
    const vatRemote = getVatRemote(vatID);
    const seqnum = vatRemote.nextOutboundSeqnum();
    const vatMessageJson = {
      fromVatID: myVatID,
      toVatID: vatID,
      seqnum,
      opMsg: body,
    };
    // we don't need webkey.marshal, this is just plain JSON
    const vatMessage = JSON.stringify(vatMessageJson);
    const wireMessage = `${OP}${vatMessage}`; // future todo: append signature
    {
      const copy = JSON.parse(vatMessage);
      if (copy.opMsg && copy.opMsg.argsS) {
        copy.opMsg.args = JSON.parse(copy.opMsg.argsS);
        delete copy.opMsg.argsS;
      }
      if (copy.opMsg && copy.opMsg.valueS) {
        copy.opMsg.value = JSON.parse(copy.opMsg.valueS);
        delete copy.opMsg.valueS;
      }
      console.log('SEND', JSON.stringify(copy, null, 2));
    }
    // console.log(`sendTo ${vatID} [${seqnum}] ${wireMessage}`);
    managerWriteOutput(wireMessage);

    for (const hostID of vatRemote.hostIDs) {
      // now add to a per-targetHostID queue, and if we have a current
      // connection, send it. The HostRemote will tell comms if it wants a
      // new connection.
      getHostRemote(hostID).sendHostMessage(wireMessage);
    }
  }

  const manager = harden({
    setEngine(e) {
      engine = e;
    },

    connectionMade,
    connectionLost,

    // inbound
    commsReceived,

    // outbound
    sendTo,
  });
  return manager;
}

// this is just for outbound messages, but todo future maybe acks too
function makeRemoteForHostID(hostID, comms, managerWriteInput) {
  let queuedMessages = [];
  const nextInboundSeqnum = 0;
  const queuedInboundMessages = new Map(); // seqnum -> msg
  let connection;

  const remote = harden({
    connectionMade(c) {
      connection = c;
      if (nextInboundSeqnum > 0) {
        // I'm using JSON.stringify instead of marshal.serialize because that
        // now requires extra stuff like target vatID, in case the thing
        // being serialized includes unresolved Vows, and for opAck we know
        // we don't need that
        const ackBodyJson = buildAck(nextInboundSeqnum);
        connection.send(ackBodyJson);
      }
      for (const msg of queuedMessages) {
        connection.send(msg);
      }
    },

    connectionLost() {
      connection = undefined;
    },

    // inbound

    // outbound

    sendHostMessage(msg) {
      queuedMessages.push(msg);
      if (connection) {
        connection.send(msg);
      } else {
        comms.wantConnection(hostID);
      }
    },

    // inbound acks remove outbound messages from the pending queue

    ackOutbound(hostID, ackSeqnum) {
      queuedMessages = queuedMessages.filter(m => m.seqnum !== ackSeqnum);
    },
  });
  return remote;
}
