Each Vat lives in a "base directory", which contains mutable state for the
Vat. Create these with `bin/vat create <port>`, which allocates a VatID,
creates a new directory named after that VatID, and populates it with state.
Later, you run vat by chdiring into the new base directory and running
`bin/vat run`. You can also name the base directory directly with `bin/vat
run <basedir>`.

The contents of `BASEDIR` are files with the following names:

* `id`: the short printable VatID
* `private-id`: private keys needed to claim that ID
* `listen-ports`: a list of multiaddrs, one per line, where this node
  listens, typically `/ip4/0.0.0.0/tcp/$PORT`
* `addresses`: a list of multiaddrs, one per line, which other nodes can use
  to connect to this one. At creation this is set to
  `/ip4/$HOSTNAME/tcp/$PORT`, but this can be changed later. It is not read
  by the node that lives in this basedir, but other nodes might read it
  through the `locator` feature described below.
* `output-transcript` (overwritten each run): lines of JSON, recording all
  inbound messages. We can reconstruct our state by replaying these messages.
* `input-transcript` (optional): if present, each line will delivered as a
  synthetic inbound message at startup, to reconstruct the vat's previous
  state.
* `source/index.js`: the initial occupant of the Vat. This should be an
  ES6-style module, exporting function names like `foo` and `bar`. These will
  be exposed as if they were methods on a root object.
* `root-sturdyref`: a sturdyref for the root object. Invoking the `foo`
  method on this object will run the `foo()` function exported by
  `source/index.js`.

In addition, `BASEDIR/locator` is used to locate connection hints for other
Vats by computing a value named `$LOCATORDIR`. If `BASEDIR/locator` is a
file, the contents are read and treated as pathname relative to `BASEDIR`
(`LOCATORDIR = join(BASEDIR, read(join(BASEDIR, 'locator')))`). If this is a
directory (or a symlink to a directory), it is used directly (`LOCATORDIR =
join(BASEDIR, 'locator')`). The connection hints for VatID `XYZ` are read
from `$LOCATORDIR/$VATID/ports`. The default value is `..`, so making all
your vats in a shared parent directory will enable them to find each other.

Vats run a loop, once per second, to initiate connections to any other Vat
for which they have pending messages, using `$LOCATORDIR`.

As the Vat runs, a transcript of all inbound messages will be written into
`BASEDIR/output-transcript`. To persist the state, after you shut down the
Vat, move `output-transcript` to `input-transcript`. The next time the Vat
starts up, it will replay all the inbound messages from the previous run,
putting it into the same state that it had before shutdown.

This transcript will include messages sent to other vats. As the transcript
is executed, the messages are compared, and any deviation will throw a
consistency error.


## client

`vat client <sturdy-ref>|<sturdy-ref-filename> <method> <args..>`

This creates a new ephemeral vat. It tries to open the `<sturdy-ref>`
argument as a filename: if successful, it reads the sturdyref from that file.
If not, it assumes the argument is itself a sturdyref.

The client vat connects to the given target and invokes `<method>` on it. The
`<args..>` strings are converted as follows:

* if the argument can be turned into a Number, and that Number turns back
  into the same string, it will be delivered as as Number
* if the argument starts with `<`, the rest of the argument is treated as a
  filename, and the contents of that file are decoded as UTF-8, and the
  resulting unicode string is delivered as the argument
* otherwise the argument value itself is decoded as UTF-8 and the resulting
  unicode string is delivered

(TODO: our wire protocol needs to support binary data)

(TODO: escapes for sending `1234` or `<hello>` as a string)

The client waits until the result comes back, then prints this result with
`JSON.stringify()`. The client then exits.
