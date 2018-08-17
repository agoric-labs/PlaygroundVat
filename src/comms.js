import { promisify } from 'util';

import Node from 'libp2p';
import PeerId from 'peer-id';
import PeerInfo from 'peer-info';
import TCP from 'libp2p-tcp';
import WS from 'libp2p-websockets';
import defaultsDeep from '@nodeutils/defaults-deep';
import pullStream from 'pull-stream';
import pullSplit from 'pull-split';

class VatNode extends Node {
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

export async function makeComms(vinfoJson) {
  const id = await promisify(PeerId.createFromJSON)(JSON.parse(vinfoJson));
  //const peer = await PeerInfo.create();
  console.log(`id: ${id}`);
  const peer = new PeerInfo(id);
  peer.multiaddrs.add('/ip4/127.0.0.1/tcp/5001');
  console.log(`peer is ${peer}`);
    
  const n = new VatNode({ peerInfo: peer,
                        });
  n.on('peer:connect', (peerInfo) => {
    console.log(`received dial to me from: ${peerInfo.id.toB58String()}`);
  });
  n.handle('/echo/1.0.0', (protocol, conn) => {
    console.log(`got echo, ${protocol}, ${conn}`);
    pullStream(conn, pullSplit('\n'),
               pullStream.map(line => {
                 console.log(`got line ${line}`);
               }));
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
