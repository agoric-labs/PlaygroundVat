/* global Vow */

export default function(argv) {
  const one = Vow.resolve(argv.one);
  one.e.wakeupFromTwo('we say howdy');
  Vow.resolve(argv.three).e.helloThree("we say hi y'all");
  return {
    helloTwo(msg) {
      console.log('++ helloTwo', msg);
      one.e.responseFromTwo('we respond');
    },
  };
}
