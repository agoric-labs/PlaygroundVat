/* globals Vow */

const responses = new Set();

function check() {
  if (responses.size >= 3) {
    console.log('++ EVERYTHING WORKS');
  }
}

const o = {
  responseFromTwo(msg) {
    console.log('++ responseFromTwo', msg);
    responses.add('responseFromTwo');
    check();
  },

  wakeupFromTwo(msg) {
    console.log('++ wakeupFromTwo', msg);
    responses.add('wakeupFromTwo');
    check();
  },

  forwardedFromThree(msg) {
    console.log('++ forwardedFromThree', msg);
    responses.add('forwardedFromThree');
    check();
  },
};

export default function(argv) {
  Vow.resolve(argv.two).e.helloTwo("morning y'all");
  return o;
}
