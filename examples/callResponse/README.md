# simple call-response example

Run two commands in separate shells:

* `bin/vat run examples/callResponse/left`
* `bin/vat run examples/callResponse/right`

The left side is configured (with `left/argv.json`) with a sturdyref to the
right side:

```json
{
  "target": { "sturdyref": "QmVJvWAh6QbmXn6D5EFMHi2c1dwB7HiFBFfrNWXSFSRP7b/0" },
  "value": { "string": "marco" }
}
```

The left side source code (`left/source/index.js`) will use this target to
send a `pleaseRespond` message to the right side when it wakes up:

```javascript
export default function(argv) {
  log(`sending '${argv.value}'`);
  Vow.resolve(argv.target).e.pleaseRespond(argv.value)
    .then(res => log(`response was '${res}'`));
  return undefined; // nothing registered as root-sturdyref
}
```

`argv.target` is a `Presence`: a reference to a remote object. Presences can
be compared for equality, but to send any messages to their target, they must
be wrapped in a Vow by using `Vow.resolve(target)`.

We can send message to a Vow by using their `.e` property, which is a special
proxy that converts property lookups into queued remote method calls. So
using `anyvow.e.pleaseRespond(stuff)` means "send the `pleaseRespond`
message, with arguments `[stuff]`, to the remote object that is wrapped by
`anyvow`.

The Vow we use for this purpose doesn't need to be resolved: it might be a
promise for some future object (which might be local, or might be remote).
The messages are queued either way. But if the Vow came from a remote system,
the messages will be queued on that other system, which enables "promise
pipelining" and can reduce round trips significantly.

On the right side, the initialization code creates an object with a
`pleaseRespond` message. It returns this object, which causes it to be
registered as the "root sturdyref" (`left/root-sturdyref`), which we've
copied into the argv table for the left side.

```javascript
export default function(argv) {
  return {
    pleaseRespond(...args) {
      log(`responding to '${args}'`);
      return argv.response;
    }
  };
}
```

The right side gets an argv table that supplies the `response` value:

```json
{
  "response": { "string": "polo" }
}
```

The left side will emit `sending 'marco'`, then queue the message for
delivery. Later, after the right side is running and the connection is
established, the right side will emit `responding to 'marco'`. When the
response comes back, the left side will finish with 'response was 'polo'`.
