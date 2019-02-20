#! /usr/bin/env node

import { promisify } from 'util';
import fs from 'fs';
import yargs from 'yargs';

import Node from 'libp2p';
import PeerId from 'peer-id';
import PeerInfo from 'peer-info';
import TCP from 'libp2p-tcp';
import WS from 'libp2p-websockets';
import defaultsDeep from '@nodeutils/defaults-deep';
import pullStream from 'pull-stream';
import pullSplit from 'pull-split';
import Pushable from 'pull-pushable';

class VatNode extends Node {
  constructor(_options) {
    const defaults = {
      modules: {
        transport: [TCP, WS],
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

export async function connect(myVatID, addr, commandfile) {
  console.log(`connect(${addr}), ${commandfile}`);
  const id = await promisify(PeerId.create)();
  console.log(`id: ${id}`);
  const myPI = new PeerInfo(id);
  myPI.multiaddrs.add('/ip4/0.0.0.0/tcp/0');
  console.log(`myPI is ${myPI}`);
  const n = new VatNode({ peerInfo: myPI });
  n.handle('/echo/1.0.0', (protocol, conn) => {
    console.log(`got echo, ${protocol}, ${conn}`);
  });

  // const target = new PeerId(addr);
  let a = asp(0);
  console.log('n.start()');
  n.start(a.cb);
  await a.p;
  console.log(`dialer node is started`);
  a = asp(1, true);
  n.dialProtocol(addr, '/vattp-hack/0.1', a.cb);
  // n.dial(addr, a.cb);
  const conn = await a.p;
  // const conn = await promisify(n.dialProtocol)(addr, '/echo/1.0.0.0');

  console.log(
    `connected: ${conn} ${Object.getOwnPropertyNames(conn.conn.source).join(
      ',',
    )}`,
  );
  pullStream.values([
    'line1\n',
    'line2\n',
    'msg: v2->v1 {"method": "increment", "args": []}\n',
  ]);
  let doner;
  const donep = new Promise((resolve, _reject) => (doner = resolve));
  const s2 = Pushable(_err => {
    console.log('done');
    // conn.end();
    doner();
  });
  s2.push(`set-vatID ${myVatID}`);
  if (commandfile) {
    const opTranscript = fs.readFileSync(commandfile).toString('utf8');
    const ops = opTranscript.split('\n');
    ops.forEach(op => {
      if (op) {
        s2.push(op);
      }
    });
  }
  s2.end();
  pullStream(
    // source,
    s2,
    pullStream.map(line => {
      console.log(`sending line ${line}`);
      return `${line}\n`;
    }),
    conn,
  );

  pullStream(
    conn,
    pullSplit('\n'),
    // eslint-disable-next-line array-callback-return
    pullStream.map(line => {
      console.log(`rx '${line}'`);
    }),
    pullStream.drain(),
  );

  console.log('awaiting donep');
  await donep;

  // await promisify(n.stop)(); // TypeError: Cannot read property '_modules' of undefined
  a = asp(0);
  n.stop(a.cb);
  await a.p;

  return {};
}

export async function main() {
  yargs
    .command(
      'run <myVatID> <addr> [commandfile]',
      'connect to a vat server',
      _y => {},
      args => {
        connect(
          args.myVatID,
          args.addr,
          args.commandfile,
        );
      },
    )
    .parse();
  // done
}
