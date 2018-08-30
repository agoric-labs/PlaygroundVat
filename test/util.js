
export function makeTranscript() {
  const lines = [];
  const waiters = [];

  return {
    writeOutput(line) {
      lines.push(line);
      const w = waiters.shift();
      if (w) {
        w(line);
      }
    },

    lines,

    wait() {
      return new Promise(r => waiters.push(r));
    },
  };
}

export function funcToSource(f) {
  let code = `${f}`;
  code = code.replace(/^function .* {/, '');
  code = code.replace(/}$/, '');
  return code;
}

export function makeQueues(t) {
  const queues = new Map();

  function addQueue(a, b) {
    const q = [];
    queues.set(`${a}-${b}`, q);
    const c = {
      send(msg) {
        console.log(`SEND ${a}-${b}`, msg);
        q.push(msg);
      },
    };
    return c;
  }

  function expect(a, b, msg) {
    const q = queues.get(`${a}-${b}`);
    t.ok(q.length);
    //console.log('expect', a, b, q);
    const got = q.shift();
    t.deepEqual(JSON.parse(got), msg);
    return got;
  }

  function expectAndDeliverAck(a, b, targetVat, ackSeqnum) {
    const got = expect(a, b, { ackSeqnum, op: 'ack' });
    targetVat.commsReceived(`vat${a}`, got);
  }

  function expectEmpty(a, b) {
    const q = queues.get(`${a}-${b}`);
    t.equal(q.length, 0);
  }

  return { addQueue, expect, expectAndDeliverAck, expectEmpty };
}
