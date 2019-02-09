let count = 0;

let resolver1;
const f = new Flow();
const p1 = f.makeVow((resolve, reject) => resolver1 = resolve);

const o = {
  increment() {
    count += 1;
    log(`count is now ${count}`);
    return count;
  },

  decrement() {
    count -= 1;
    log(`count is now ${count}`);
    return count;
  },

  doCall() {
    log(`doing call`);
    E(ext).foo('arg1', 'arg2');
    log(`did call`);
  },

  //log('i am here');
  //log('i got here');

  returnValue(value) {
    return value;
  },

  send(target) {
    E(target).respond('arg1', 'arg2')
      .then(res => log(`send response was ${res}`));
  },

  respond(...args) {
    log(`responding, ${args}`);
    return 'my response';
  },

  wait() {
    //log('in wait');
    return p1;
  },

  fire(arg) {
    //log('in fire');
    resolver1(arg);
    //log(' ran resolver');
  },
};

export default function(argv) {
  return o;
}
