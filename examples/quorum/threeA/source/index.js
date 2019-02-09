
export default function(argv) {
  const one = Vow.resolve(argv.one);
  return {
    helloThree(msg) {
      log('++ helloThree', msg);
      E(one).forwardedFromThree('we forward');
    },
  };
}
