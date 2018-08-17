#! /usr/bin/env node

import { promisify } from 'util';
import yargs from 'yargs';

import Node from 'libp2p';
import PeerId from 'peer-id';
import PeerInfo from 'peer-info';
import TCP from 'libp2p-tcp';
import WS from 'libp2p-websockets';
import defaultsDeep from '@nodeutils/defaults-deep';
import pullStream from 'pull-stream';

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

export async function connect(addr) {
  const id = await promisify(PeerId.create)();
  console.log(`id: ${id}`);
  const myPI = new PeerInfo(id);
  myPI.multiaddrs.add('/ip4/0.0.0.0/tcp/0');
  console.log(`myPI is ${myPI}`);
  const n = new VatNode({ peerInfo: myPI });
  n.handle('/echo/1.0.0', (protocol, conn) => {
    console.log(`got echo, ${protocol}, ${conn}`);
  });

  //const target = new PeerId(addr);
  let a = asp(0);
  console.log("n.start()");
  n.start(a.cb);
  await a.p;
  console.log(`dialer node is started`);
  a = asp(1, true);
  n.dialProtocol(addr, '/echo/1.0.0', a.cb);
  //n.dial(addr, a.cb);
  const conn = await a.p;
  //const conn = await promisify(n.dialProtocol)(addr, '/echo/1.0.0.0');

  console.log(`connected: ${conn} ${Object.getOwnPropertyNames(conn.conn.source).join(',')}`);
  pullStream(pullStream.values(['line\n', 'line2\n']),
             conn);
  a = asp(1);
  await a.p;


  return {};
}

export async function main() {
  yargs
    .command('run <addr>', 'connect to a vat server', (y) => {
      y.positional('addr', {
        type: 'string',
        describe: 'initial object sourcefile'
      });
    }, (args) => {
      connect(args.addr);
    })
    .parse();
  // done
}
