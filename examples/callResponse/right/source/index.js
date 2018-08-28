export default function(argv) {
  return {
    pleaseRespond(...args) {
      log(`responding to '${args}'`);
      return argv.response;
    }
  };
}
