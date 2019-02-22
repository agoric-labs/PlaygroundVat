import { setInterval } from 'timers';

import Node from 'libp2p';
import TCP from 'libp2p-tcp';
import WS from 'libp2p-websockets';
import SECIO from 'libp2p-secio';
import defaultsDeep from '@nodeutils/defaults-deep';
import pullStream from 'pull-stream';
import pullSplit from 'pull-split';
import Pushable from 'pull-pushable';

class CommsNode extends Node {
  constructor(_options) {
    const defaults = {
      modules: {
        transport: [TCP, WS],
        // streamMuxer: [ MPLEX ],
        connEncryption: [SECIO],
      },
      // config
    };
    super(defaultsDeep(_options, defaults));
  }
}

function asp(numVals, errFirst = false) {
  let r;
  let rx;
  const p = new Promise((resolve, reject) => {
    r = resolve;
    rx = reject;
  });
  function cb(...valsAndErr) {
    let vals;
    let err;
    if (errFirst) {
      [err, ...vals] = valsAndErr;
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

async function connectTo(n, hostID, addresses, manager) {
  console.log(`connectTo(${addresses}`);

  const a = asp(1, true);
  const addr = addresses[0]; // TODO: use them all, somehow
  console.log(`dialing ${addr}`);
  n.dialProtocol(addr, '/vattp-hack/0.1', a.cb);
  // n.dial(addr, a.cb);
  const conn = await a.p;
  // const conn = await promisify(n.dialProtocol)(addr, '/echo/1.0.0.0');

  console.log(`connected: ${conn}`);
  // console.log(`connected: ${conn} ${Object.getOwnPropertyNames(conn.conn.source).join(',')}`);
  const pusher = Pushable(_err => {
    console.log('done');
    // conn.end();
    // doner();
  });
  const c = {
    send(msg) {
      // console.log(`send/push ${msg}`);
      pusher.push(`${msg}`);
    },
  };
  // pusher.end();

  pullStream(
    pusher,
    pullStream.map(line => {
      // console.log(`sending line ${line}`);
      return `${line}\n`;
    }),
    conn,
  );

  let doneResolver;
  const doneP = new Promise((res, _rej) => (doneResolver = res));

  pullStream(
    conn,
    pullSplit('\n'),
    // pullStreams are not arrays
    /* eslint-disable-next-line array-callback-return */
    pullStream.map(line => {
      // console.log(`got line on outbound '${line}'`);
      if (!line) return;
      manager.commsReceived(hostID, line);
    }),
    pullStream.onEnd(_ => doneResolver()),
  );

  return { c, doneP };
}

async function handleConnection(manager, protocol, conn) {
  console.log(`got ${protocol} connection`);
  let hostIDres;
  let hostIDrej;
  const hostIDp = new Promise((res, rej) => {
    hostIDres = res;
    hostIDrej = rej;
  });

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
  pullStream(
    pusher,
    pullStream.map(line => {
      // console.log(`sending line ${line}`);
      return `${line}\n`;
    }),
    conn,
    /* pullStream.collect((err, data) => {
               if (err) { throw err; }
               console.log('received echo:', data.toString());
               } */
  );
  const c = {
    send(msg) {
      // console.log(`send/push ${msg}`);
      pusher.push(`${msg}`);
    },
  };

  manager.connectionMade(hostID, c);

  pullStream(
    conn,
    pullSplit('\n'),
    // pullStreams are not arrays
    /* eslint-disable-next-line array-callback-return */
    pullStream.map(line => {
      // console.log(`got line on inbound '${line}'`);
      if (!line) return;
      manager.commsReceived(hostID, line);
    }),
    pullStream.drain(),
  );
}

export async function createComms(myPeerInfo, getAddressesForHostID) {
  console.log(`createComms`);
  // console.log(`peerInfo is ${myPeerInfo}`);
  let started = false;
  const wanted = new Set();
  const pending = new Set();
  const established = new Map();
  let manager;
  const n = new CommsNode({ peerInfo: myPeerInfo });

  function check() {
    console.log(`startComms.check`, started);
    const wantedHostIDs = Array.from(wanted);
    wantedHostIDs.map(async hostID => {
      if (!established.has(hostID) && !pending.has(hostID)) {
        const addresses = await getAddressesForHostID(hostID);
        pending.add(hostID);
        const p = connectTo(n, hostID, addresses, manager);
        p.then(
          ({ c, doneP }) => {
            pending.delete(hostID);
            established.set(hostID, c);
            manager.connectionMade(hostID, c);
            doneP.then(_ => {
              console.log(`connectionLost ${hostID}`);
              established.delete(hostID);
              manager.connectionLost(hostID);
            });
          },
          rej => {
            console.log(`connectTo failed (${hostID}): ${rej}`);
            pending.delete(hostID);
          },
        );
      }
    });
  }

  return {
    registerManager(m) {
      manager = m;
    },
    async start() {
      started = true;
      if (!manager) {
        console.log('ERR: start called before registerManager');
        throw new Error('start called before registerManager');
      }
      n.on('peer:connect', peerInfo => {
        // never printed
        console.log(`received dial to me from: ${peerInfo.id.toB58String()}`);
      });
      n.handle('/vattp-hack/0.1', (protocol, conn) =>
        handleConnection(manager, protocol, conn),
      );
      const a = asp(0);
      // await n.start();
      n.start(a.cb);
      await a.p;

      // todo: do this in 'vat create', stash all the addresses in
      // BASEDIR/addresses
      console.log('Listener ready, listening on:');
      n.peerInfo.multiaddrs.forEach(ma => {
        // console.log(ma.toString() + '/ipfs/' + id.toB58String());
        console.log(ma.toString());
      });
      setInterval(check, 5 * 1000);
      check();
    },
    wantConnection(hostID) {
      if (!manager) {
        console.log('ERR: wantConnection called before registerManager');
        throw new Error('wantConnection called before registerManager');
      }
      if (wanted.has(hostID)) {
        return;
      }
      wanted.add(hostID);
      if (started) {
        check();
      }
    },
  };
}
