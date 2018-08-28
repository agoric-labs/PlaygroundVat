
export default function(argv) {
  log(`sending '${argv.value}'`);
  Vow.resolve(argv.target).e.pleaseRespond(argv.value)
    .then(res => log(`response was '${res}'`));
  return undefined; // nothing registered as root-sturdyref
}
