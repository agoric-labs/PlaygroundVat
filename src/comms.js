import { promisify } from 'util';
import { setInterval } from 'timers';

import Node from 'libp2p';
import PeerId from 'peer-id';
import PeerInfo from 'peer-info';
import TCP from 'libp2p-tcp';
import WS from 'libp2p-websockets';
import MPLEX from 'libp2p-mplex';
import SECIO from 'libp2p-secio';
import defaultsDeep from '@nodeutils/defaults-deep';
import pullStream from 'pull-stream';
import pullSplit from 'pull-split';
import Pushable from 'pull-pushable';

class CommsNode extends Node {
  constructor(_options) {
    const defaults = {
      modules: {
        transport: [ TCP,
                     WS ],
        //streamMuxer: [ MPLEX ],
        connEncryption: [ SECIO ],
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

async function connectTo(n, hostID, addresses, myHostID, vat) {
  console.log(`connect(${addresses}) from ${myHostID}`);

  let a = asp(1, true);
  const addr = addresses[0]; // TODO: use them all, somehow
  console.log(`dialing ${addr}`);
  n.dialProtocol(addr, '/vattp-hack/0.1', a.cb);
  //n.dial(addr, a.cb);
  const conn = await a.p;
  //const conn = await promisify(n.dialProtocol)(addr, '/echo/1.0.0.0');

  console.log(`connected: ${conn}`);
  //console.log(`connected: ${conn} ${Object.getOwnPropertyNames(conn.conn.source).join(',')}`);
  const pusher = Pushable(err => {console.log('done');
                              //conn.end();
                              //doner();
                             });
  //pusher.push(`set-hostID ${myHostID}`);
  const c = {
    send(msg) {
      //console.log(`send/push ${msg}`);
      pusher.push(`${msg}`);
    }
  };
  //pusher.end();

  pullStream(
    pusher,
    pullStream.map(line => {
      //console.log(`sending line ${line}`);
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
      //console.log(`got line on outbound '${line}'`);
      if (!line)
        return;
      vat.commsReceived(hostID, line);
    }),
    pullStream.onEnd(_ => doneResolver()),
  );

  return { c, doneP };
}

async function handleConnection(vat, protocol, conn) {
  console.log(`got ${protocol} connection`);
  let hostIDres, hostIDrej;
  const hostIDp = new Promise((res, rej) => { hostIDres = res; hostIDrej = rej; });

  conn.getPeerInfo((err, pi) => {
    if (err) {
      // plain TCP sockets don't have peerinfo
      console.log(` from ERR ${err}`);
      hostIDrej(err);
    } else {
      // but secio connections do
      console.log(` from ${pi.id.toB58String()}`);
      hostIDres(pi.id.toB58String());
    }
  });

  const hostID = await hostIDp;

  conn.getObservedAddrs((err, ma) => {
    console.log(` from ${ma}`);
  });

  const pusher = Pushable();
  pullStream(pusher,
             pullStream.map(line => {
               //console.log(`sending line ${line}`);
               return line+'\n';
             }),
             conn,
             /*pullStream.collect((err, data) => {
               if (err) { throw err; }
               console.log('received echo:', data.toString());
               }*/);
  const c = {
    send(msg) {
      //console.log(`send/push ${msg}`);
      pusher.push(`${msg}`);
    }
  };

  vat.connectionMade(hostID, c);

  pullStream(conn,
             pullSplit('\n'),
             pullStream.map(line => {
               //console.log(`got line on inbound '${line}'`);
               if (!line)
                 return;
               vat.commsReceived(hostID, line);
             }),
             pullStream.drain()
            );

}

export async function startComms(vat, myPeerInfo, myHostID, getAddressesForHostID) {
  console.log(`startComms, myHostID is ${myHostID}`);
  //console.log(`peerInfo is ${myPeerInfo}`);
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
    for (let hostID of vat.whatConnectionsDoYouWant()) {
      if (!connections.has(hostID) && !pending.has(hostID)) {
        const addresses = await getAddressesForHostID(hostID);
        pending.add(hostID);
        const p = connectTo(n, hostID, addresses, myHostID, vat);
        p.then(({c, doneP}) => { pending.delete(hostID);
                                 connections.set(hostID, c);
                                 vat.connectionMade(hostID, c);
                                 doneP.then(_ => {
                                   console.log(`connectionLost ${hostID}`);
                                   connections.delete(hostID);
                                   vat.connectionLost(hostID);
                                 });
                               },
               rej => { console.log(`connectTo failed (${hostID}): ${rej}`);
                        pending.delete(hostID);
                      });
      }
    }
  }
  setInterval(check, 5*1000);
}

