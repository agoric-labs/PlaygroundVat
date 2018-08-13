let count = 0;

module.exports = {
  increment() {
    count += 1;
    log(`count is now ${count}`);
  },

  decrement() {
    count -= 1;
    log(`count is now ${count}`);
  },

  doCall() {
    log(`doing call`);
    ext.invoke('methname', 'arg1', 'arg2');
    log(`did call`);
  }
};
