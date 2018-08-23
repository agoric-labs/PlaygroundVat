import { promisify } from 'util';

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

function asp(numVals) {
  let r, rx;
  const p = new Promise((resolve, reject) => {
    r = resolve;
    rx = reject;
  });
  function cb(...valsAndErr) {
    const vals = valsAndErr.slice(0, numVals);
    const err = valsAndErr[numVals];
    if (err) {
      rx(err);
    } else {
      r(...vals);
    }
  }
  return { p, cb };
}

export async function makeComms(vinfoJson, vat) {
  const id = await promisify(PeerId.createFromJSON)(JSON.parse(vinfoJson));
  //const peer = await PeerInfo.create();
  console.log(`id: ${id}`);
  const peer = new PeerInfo(id);
  peer.multiaddrs.add('/ip4/127.0.0.1/tcp/5001');
  console.log(`peer is ${peer}`);

  const n = new CommsNode({ peerInfo: peer,
                        });
  n.on('peer:connect', (peerInfo) => {
    // never printed
    console.log(`received dial to me from: ${peerInfo.id.toB58String()}`);
  });
  n.handle('/vattp-hack/0.1', (protocol, conn) => {
    console.log(`got ${protocol} connection`);
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

    pullStream(conn,
               pullSplit('\n'),
               pullStream.map(line => {
                 console.log(`got line '${line}'`);
                 if (line) {
                   const sender = null;
                   vat.commsReceived(sender, line);
                 }
               }),
               pullStream.drain()
              );

    const push = Pushable();
    vat.registerPush(push);
    pullStream(push, conn,
               /*pullStream.collect((err, data) => {
                 if (err) { throw err; }
                 console.log('received echo:', data.toString());
               }*/);

  });
  let a = asp(0);
  //await n.start();
  n.start(a.cb);
  await a.p;

  console.log('Listener ready, listening on:');
  n.peerInfo.multiaddrs.forEach((ma) => {
    //console.log(ma.toString() + '/ipfs/' + id.toB58String());
    console.log(ma.toString());
  });
 return {};
}
