export default function(argv) {
  return {
    pleaseRespond(...args) {
      console.log(`responding to '${args}'`);
      return argv.response;
    },
  };
}
