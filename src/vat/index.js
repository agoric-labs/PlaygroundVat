// this file is evaluated in the SES realm and defines the Vat. It gets two
// endowments: 'module' (used to export everything) and 'log' (which wraps
// console.log). Both of these come from the primal realm, so they must not
// be exposed to guest code.


const msgre = /^msg: (\w+)->(\w+) (.*)$/;

function confineGuestSource(source, endowments) {
  endowments = endowments || {};
  const module = {};
  function guestLog(...args) {
    log(...args);
  }
  const endow = { module, log: guestLog };
  if (endowments) {
    Object.defineProperties(endow,
                            Object.getOwnPropertyDescriptors(endowments));
  }
  SES.confine(source, endow);
  return module.exports;
}


export function makeVat(endowments, myVatID, initialSource, initialSourceHash) {
    const { writeOutput } = endowments;

    const e = confineGuestSource(initialSource);
    writeOutput(`load: ${initialSourceHash}\n`);

    function processOp(op) {
      if (op === '') {
        return;
      }
      if (op.startsWith('load: ')) {
        const arg = /^load: (\w+)$/.exec(op)[1];
        if (arg !== initialSourceHash) {
          throw Error(`err: input says to load ${arg}, but we loaded ${initialSourceHash}`);
        }
        log(`load matches, good`);
      } else if (op.startsWith('msg: ')) {
        const m = msgre.exec(op);
        const fromVat = m[1];
        const toVat = m[2];
        const bodyJson = m[3];
        log(`msg ${fromVat} ${toVat}`);
        if (toVat === myVatID) {
          writeOutput(op);
          writeOutput('\n');
          const body = JSON.parse(bodyJson);
          log(`method ${body.method}`);
          e[body.method](body.args);
        }
      } else {
        log(`unknown op: ${op}`);
      }
    }

    return {
      start(opTranscript) {
        const ops = opTranscript.split('\n');
        for(let op of ops) {
          processOp(op);
        }
      },

      opReceived(op) {
        processOp(op);
      }
    };
  }

