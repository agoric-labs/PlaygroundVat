let responses = new Set();

function check() {
  if (responses.size >= 3) {
    log('EVERYTHING WORKS');
  };
}

const o = {

  responseFromTwo(msg) {
    log('responseFromTwo', msg);
    responses.add('responseFromTwo');
    check();
  },

  wakeupFromTwo(msg) {
    log('wakeupFromTwo', msg);
    responses.add('wakeupFromTwo');
    check();
  },

  forwardedFromThree(msg) {
    log('forwardedFromThree', msg);
    responses.add('forwardedFromThree');
    check();
  },
};

export default function(argv) {
  Vow.resolve(argv.two).e.helloTwo("morning y'all");
  return o;
}
