let count = 0;

module.exports = {
  increment() {
    count += 1;
    log(`count is now ${count}`);
  },

  decrement() {
    count -= 1;
    log(`count is now ${count}`);
  }

};
