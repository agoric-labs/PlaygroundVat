/*global log Vow Flow def Nat*/

export default function(argv) {
  log(`sending '${argv.value}'`);
  E(argv.target).pleaseRespond(argv.value)
    .then(res => {
      log(`response was '${res}'`);
      argv.exit(0, 'demo complete');
    });
  return undefined; // nothing registered as root-sturdyref
}
