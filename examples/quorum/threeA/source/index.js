
export default function(argv) {
  const one = Vow.resolve(argv.one);
  return {
    helloThree(msg) {
      log('helloThree', msg);
      one.e.forwardedFromThree('we forward');
    },
  };
}
