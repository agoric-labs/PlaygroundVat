let count = 0;

let resolver1;
const f = new Flow();
const p1 = f.makeVow((resolve, reject) => resolver1 = resolve);

export default {
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
    ext.e.foo('arg1', 'arg2');
    log(`did call`);
  },

  //log('i am here');
  //log('i got here');

  returnValue(value) {
    return value;
  },

  send(target) {
    Vow.resolve(target).e.foo('arg1', 'arg2');
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

