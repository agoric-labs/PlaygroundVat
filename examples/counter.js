let count = 0;

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
  }
}

