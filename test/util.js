
export function makeTranscript() {
  const lines = [];
  const waiters = [];

  return {
    writeOutput(line) {
      lines.push(line);
      const w = waiters.shift();
      if (w) {
        w(line);
      }
    },

    lines,

    wait() {
      return new Promise(r => waiters.push(r));
    },
  };
}

export function funcToSource(f) {
  let code = `${f}`;
  code = code.replace(/^function .* {/, '');
  code = code.replace(/}$/, '');
  return code;
}
