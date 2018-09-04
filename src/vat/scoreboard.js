import { insist } from '../insist';

/**
 * A scoreboard is an object that accepts proto messages, where each
 * proto message is already authenticated as being a signed
 * message-with-sequence-number from some component of a composite
 * identity. Each proto message is evidence towards an actual message
 * from that composite identity. When the set of authenticated
 * componentIDs of components agreeing on that message passes the
 * quorumTest predicate of that compositeID, the scoreboard concludes
 * that the composite designated by that compositeID has sent that
 * message.
 *
 * Our caller must only provide us with information that has already
 * been authenticated as a message from that componentID with that
 * sequence number. The msgID must be a value that is one-to-one with
 * the msg, such as a cryptographic hash of the contents of the
 * message. The scoreboard compares these msgIDs with Map and ===, but
 * never compares the messages themselves.
 *
 * The quorumTest predicate must be pure and monotonic. By pure, it
 * should not cause or be sensitive to any effects; it must not modify
 * or remember the set it is passed. By monotonic, if it says true for
 * set X, it must say true for any superset of set X.
 */
export function makeScoreboard(quorumTest, def, logConflict) {

  // map of seqNum to sequence-maps, where a sequence-map is a map
  // from msgID to a record of a `msg` and the set of `componentIDs`
  // that have agreed on that msgID (and therefore presumably on that
  // msg).
  const queue = new Map();

  // The sequence number at the head of the queue
  let currentSeqNum = 0;

  function fetchReadyMsg(seqNum) {
    const seqMap = queue.get(seqNum);
    if (seqMap) {
      for (const [msgID, {msg, componentIDs}] of seqMap) {
        if (quorumTest(componentIDs)) {
          return msg;
        }
      }
    }
    return undefined;
  }

  return def({
    // Return a conservative flag about whether this acceptance might
    // have caused a next message to be ready. If false, then no next
    // message is ready; otherwise maybe.
    acceptProtoMsg(componentID, seqNum, msgID, msg) {
      insist(msg !== undefined, 'msg payload expected');
      let seqMap = queue.get(seqNum);
      if (!seqMap) {
        seqMap = new Map();
        queue.set(seqNum, seqMap);
      }
      let record = seqMap.get(msgID);
      if (!record) {
        record = {
          msg,
          componentIDs: new Set()
        };
        seqMap.set(msgID, record);
        if (seqMap.size > 1) {
          logConflict('Conflicting alleged messages',
                      componentID, seqNum, msgID, msg, seqMap);
        }
      }
      const { componentIDs } = record;
      componentIDs.add(componentID);
      return seqNum === currentSeqNum;
    },

    getNext() {
      /*console.log('queue:');
      for (let q of queue.values()) {
        for (let [k,v] of q.entries()) {
          console.log(' k,v=', k, '=>',  v);
        }}*/

      const msg = fetchReadyMsg(currentSeqNum);
      if (!msg) {
        return undefined;
      }
      // Don't delete these yet, for better diagnostics if we get
      // disagreeing messages.
      // queue.delete(currentSeqNum);
      currentSeqNum += 1;
      return msg;
    }        
  });
}


/**
 * decidedQs are a list of remoteVows for the vatTP-to-capTP upcall
 * interface to the execution engines associated with this leader as
 * well as each of the followers.
 *
 * These mechanisms are not yet able to cope with new followers
 * joining, old followers leaving, change of leader, change of
 * threshold, or any other change to the quorum rules.
 */
function makeConsensusLeader(decidedQs) {

  // map from compositeID to scoreboard
  const scoreboards = new Map();

  function deliverMsg(compositeID, msg) {
    for (const decidedQP of decidedQs) {
      decidedQP.e.deliverMsg(compositeID, msg);
    }
  }
  
  return def({
    acceptProtoMsg(compositeID, componentID, seqNum, msgID, msg) {
      let scoreboard = scoreboards.get(compositeID);
      if (!scoreboard) {
        scoreboard = makeScoreboard(getQuorumTest(compositeID));
        scoreboards.set(compositeID, scoreboard);
      }
      if (scoreboard.acceptProtoMsg(componentID, seqNum, msgID, msg)) {
        // Currently, because we're exhaustive here, we know there's
        // nothing ready on the other scoreboards. Instead, we may
        // want to not be exhaustive in order to do a fairer
        // interleaving of messages from different compositeID
        // sources.
        while (true) {
          const msg = scoreboard.getNext();
          if (!msg) {
            return;
          }
          deliverMsg(compositeID, msg);
        }
      }
    }
  });
}


/* BOGUS. Needs to be at earlier level of abstraction, trafficking in
 * the allegedly signed message as originally received.
export function makeConsensusFollower(leaderP) {
  leaderP = Vow.resolve(leaderP);
  
  return def({
    acceptProtoMsg(compositeID, componentID, seqNum, msgID, msg) {
      // BOGUS Vulnerable HACK! Must forward signed message
      // itself. The receiver must be the one that takes it apart and
      // authenticates that the component is within the composite.
      leaderP.e.acceptProtoMsg(compositeID, componentID, seqNum, msgID, msg);
    }
  });
}
*/
