Each Vat lives in a "base directory", which contains mutable state for the
Vat. Create these with `bin/vat create BASEDIR`, naming a new non-existent
directory. Then run the vat with `bin/vat run BASEDIR`.

The contents of `BASEDIR` are:

* `id`: the short printable VatID
* `private-id`: private keys needed to claim that ID
* `ports`: a list of multiaddrs, one per line, where this node listens
* `output-transcript` (overwritten each run): lines of JSON, recording all
  inbound messages. We can reconstruct our state by replaying these messages.
* `input-transcript` (optional): if present, each line will delivered as a
  synthetic inbound message at startup, to reconstruct the vat's previous
  state.
* `connections` (optional): lines of `vatID: ADDR ADDR..`, specifying
  outbound connections that should be made at startup
* `source/index.js`: the initial occupant of the Vat. This should be an
  ES6-style module, exporting function names like `foo` and `bar`. These will
  be exposed as if they were methods on a root object.
* `root-sturdyref`: a sturdyref for the root object. Invoking the `foo`
  method on this object will run the `foo()` function exported by
  `source/index.js`.

We don't yet have reconnect-on-failure, so Vats must be carefully launched in
the correct order to make sure that all `connections` can be established. The
first Vat launched should not have any `connections`. This relies upon the
connections being bidirectional. This will eventually get fixed.

As the Vat runs, a transcript of all inbound messages will be written into
`BASEDIR/output-transcript`. To persist the state, after you shut down the
Vat, move `output-transcript` to `input-transcript`. The next time the Vat
starts up, it will replay all the inbound messages from the previous run,
putting it into the same state that it had before shutdown.
