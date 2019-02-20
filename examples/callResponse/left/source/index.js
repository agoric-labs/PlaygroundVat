/* global Vow */

export default function(argv) {
  console.log(`sending '${argv.value}'`);
  Vow.resolve(argv.target)
    .e.pleaseRespond(argv.value)
    .then(res => {
      console.log(`response was '${res}'`);
      argv.exit(0, 'demo complete');
    });
  return undefined; // nothing registered as root-sturdyref
}
