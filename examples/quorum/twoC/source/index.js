
export default function(argv) {
  const one = Vow.resolve(argv.one);
  E(one).wakeupFromTwo('we say howdy');
  E(argv.three).helloThree("we say hi y'all");
  return {
    helloTwo(msg) {
      log('++ helloTwo', msg);
      E(one).responseFromTwo('we respond');
    },
  };
}
