// TODO what if exeption is undefined?
export function insist(condition, exception) {
  if (!condition) {
    throw exception;
  }
}

export function insistFn(arg) {
  if (typeof arg !== 'function' && arg !== undefined) {
    throw new Error(`function expected: ${typeof arg}: ${arg}`);
  }
  return arg;
}
