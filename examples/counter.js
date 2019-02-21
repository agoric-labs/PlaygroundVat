/* global Flow Vow */

let count = 0;

let resolver1;
const f = new Flow();
const p1 = f.makeVow((resolve, _reject) => (resolver1 = resolve));

const o = {
  increment() {
    count += 1;
    console.log(`count is now ${count}`);
    return count;
  },

  decrement() {
    count -= 1;
    console.log(`count is now ${count}`);
    return count;
  },

  doCall() {
    console.log(`doing call`);
    ext.e.foo('arg1', 'arg2');
    console.log(`did call`);
  },

  // console.log('i am here');
  // console.log('i got here');

  returnValue(value) {
    return value;
  },

  send(target) {
    Vow.resolve(target)
      .e.respond('arg1', 'arg2')
      .then(res => console.log(`send response was ${res}`));
  },

  respond(...args) {
    console.log(`responding, ${args}`);
    return 'my response';
  },

  wait() {
    // console.log('in wait');
    return p1;
  },

  fire(arg) {
    // console.log('in fire');
    resolver1(arg);
    // console.log(' ran resolver');
  },
};

export default function(_argv) {
  return o;
}
