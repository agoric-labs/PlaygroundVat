import { promisify } from 'util';
import { setInterval } from 'timers';

import Node from 'libp2p';
import PeerId from 'peer-id';
import PeerInfo from 'peer-info';
import TCP from 'libp2p-tcp';
import WS from 'libp2p-websockets';
import defaultsDeep from '@nodeutils/defaults-deep';
import pullStream from 'pull-stream';
import pullSplit from 'pull-split';
import Pushable from 'pull-pushable';

class CommsNode extends Node {
  constructor(_options) {
    const defaults = {
      modules: {
        transport: [ TCP,
                     WS ]
      }
      // config
    };
    super(defaultsDeep(_options, defaults));
  }
}

function asp(numVals, errFirst=false) {
  let r, rx;
  const p = new Promise((resolve, reject) => {
    r = resolve;
    rx = reject;
  });
  function cb(...valsAndErr) {
    let vals, err;
    if (errFirst) {
      err = valsAndErr[0];
      vals = valsAndErr.slice(1);
    } else {
      vals = valsAndErr.slice(0, numVals);
      err = valsAndErr[numVals];
    }
    if (err) {
      rx(err);
    } else {
      r(...vals);
    }
  }
  return { p, cb };
}

const pending = new Set();
const connections = new Map();

async function connectTo(n, vatID, addresses, myVatID, vat) {
  console.log(`connect(${addresses}) from ${myVatID}`);

  let a = asp(1, true);
  const addr = addresses[0]; // TODO: use them all, somehow
  n.dialProtocol(addr, '/vattp-hack/0.1', a.cb);
  console.log(`dialing ${addr}`);
  //n.dial(addr, a.cb);
  const conn = await a.p;
  //const conn = await promisify(n.dialProtocol)(addr, '/echo/1.0.0.0');

  console.log(`connected: ${conn}`);
  //console.log(`connected: ${conn} ${Object.getOwnPropertyNames(conn.conn.source).join(',')}`);
  const pusher = Pushable(err => {console.log('done');
                              //conn.end();
                              //doner();
                             });
  pusher.push(`set-vatID ${myVatID}`);
  const c = {
    send(msg) {
      console.log(`send/push ${msg}`);
      pusher.push(`${msg}`);
    }
  };
  //pusher.end();

  pullStream(
    pusher,
    pullStream.map(line => {
      console.log(`sending line ${line}`);
      return line+'\n';
    }),
    conn
  );

  let doneResolver;
  const doneP = new Promise((res, rej) => doneResolver = res);

  pullStream(
    conn,
    pullSplit('\n'),
    pullStream.map(line => {
      console.log(`got line on outbound '${line}'`);
      if (!line)
        return;
      vat.commsReceived(vatID, line);
    }),
    pullStream.onEnd(_ => doneResolver()),
  );

  return { c, doneP };
}

async function handleConnection(vat, protocol, conn) {
  console.log(`got ${protocol} connection`);
  //const vatID = 'VATID??';

  /*conn.getPeerInfo((err, pi) => {
  // I think plain TCP sockets don't have peerinfo
  if (err) {
  console.log(` from ERR ${err}`);
  } else {
  console.log(` from ${pi.id.toB58String()}`);
  }
  });*/
  conn.getObservedAddrs((err, ma) => {
    console.log(` from ${ma}`);
  });

  const pusher = Pushable();
  pullStream(pusher,
             pullStream.map(line => {
               console.log(`sending line ${line}`);
               return line+'\n';
             }),
             conn,
             /*pullStream.collect((err, data) => {
               if (err) { throw err; }
               console.log('received echo:', data.toString());
               }*/);
  const c = {
    send(msg) {
      console.log(`send/push ${msg}`);
      pusher.push(`${msg}`);
    }
  };

  // for now, the first line must start with 'set-vatID ' and then a vatID.
  // We defer connectionMade until we hear what vat the peer is pretending
  // to be
  let vatID;
  //vat.connectionMade(vatID, c);

  pullStream(conn,
             pullSplit('\n'),
             pullStream.map(line => {
               console.log(`got line on inbound '${line}'`);
               if (!line)
                 return;
               if (!vatID) {
                 if (!line.startsWith('set-vatID ')) {
                   throw new Error('first comms line must be "set-vatID $VATID"');
                 }
                 vatID = line.split(' ')[1];
                 console.log(`comms set vatID to ${vatID}`);
                 vat.connectionMade(vatID, c);
               } else {
                 vat.commsReceived(vatID, line);
               }
             }),
             pullStream.drain()
            );

}

export async function startComms(vat, myPeerInfo, myVatID, getAddressesForVatID) {
  console.log(`startComms, myVatID is ${myVatID}`);
  console.log(`peerInfo is ${myPeerInfo}`);
  const n = new CommsNode({ peerInfo: myPeerInfo });
  n.on('peer:connect', (peerInfo) => {
    // never printed
    console.log(`received dial to me from: ${peerInfo.id.toB58String()}`);
  });
  n.handle('/vattp-hack/0.1', (protocol, conn) => handleConnection(vat, protocol, conn));
  let a = asp(0);
  //await n.start();
  n.start(a.cb);
  await a.p;

  // todo: do this in 'vat create', stash all the addresses in BASEDIR/addresses
  console.log('Listener ready, listening on:');
  n.peerInfo.multiaddrs.forEach((ma) => {
    //console.log(ma.toString() + '/ipfs/' + id.toB58String());
    console.log(ma.toString());
  });

  async function check() {
    console.log(`startComms.check`);
    for (let vatID of vat.whatConnectionsDoYouWant()) {
      if (!connections.has(vatID) && !pending.has(vatID)) {
        const addresses = await getAddressesForVatID(vatID);
        pending.add(vatID);
        const p = connectTo(n, vatID, addresses, myVatID, vat);
        p.then(({c, doneP}) => { pending.delete(vatID);
                                 connections.set(vatID, c);
                                 vat.connectionMade(vatID, c);
                                 doneP.then(_ => {
                                   console.log(`connectionLost ${vatID}`);
                                   connections.delete(vatID);
                                   vat.connectionLost(vatID);
                                 });
                               },
               rej => { console.log(`connectTo failed (${vatID})`);
                        pending.delete(vatID);
                      });
      }
    }
  }
  setInterval(check, 5*1000);
}

