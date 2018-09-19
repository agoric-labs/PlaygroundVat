# Usage

This prototype is still very rough, and lacks both developer ergonomics and
user-friendliness. Please accept our apologies.

Run `npm install` from the top of the source tree to install all the
dependencies. The `bin/vat` command is then available to be run. You might
want to add the `bin/` directory to your `$PATH` to reduce typing later.

## The 'vat' command

`vat create` is used to make a new Vat "base directory", which creates the
encryption keys and the Vat ID. This takes arguments to assign the IP address
and TCP port where it will be reachable, as well as the name of the base
directory to create. See [vat-basedir](vat-basedir.md) for details.

You can then edit the files in the new basedir. `$BASEDIR/source/index.js` is
the most important one: it defines the initial code to be executed inside the
Vat, which returns the "root object". At launch, that is the only object in
existence. To accomplish anything useful with the Vat, that initial object
must accept messages and possibly create new objects. The initial object will
be reachable through the URI written into `$BASEDIR/root-sturdyref`.

You can split your initial code into multiple ES6 modules, imported by
`index.js`.

The other file to edit is `$BASEDIR/argv.json`, which specifies the arguments
passed into the initial code. `argv.json` defines a table of named arguments
(not a list, despite the "v" in the name implying a vector). These arguments
can be plain numbers or strings, the contents of named files, or a few
special endowments like the ability to terminate the Vat process (useful for
clients and demos that do one job and then shut down).

They can also provide "sturdyrefs" (and in fact are currently the only way to
provide sturdyrefs) to Vat code, which is necessary to establish a connection
to an object in some other Vat. References can be sent as arguments in
messages, or as the return value of a message, but to bootstrap the process,
at least one Vat must have an `argv` that includes a sturdyref.

Look at the [callResponse example](../examples/callResponse) for a
demonstration.

Once you've created and edited the Vat, you can launch it with `vat run` from
within the base directory (or `vat run BASEDIR`) from outside. This will
create the execution environment (a SES Root Realm), construct the `argv`
table, rollup the initial code into a single string, evaluate that string
inside the new realm, invoke it with the `argv` table, and then register the
object it returns at the root sturdyref. Any messages sent during startup to
sturdyrefs in the `argv` table will trigger outbound connections, and those
messages will be delivered once the outbound connections are established. At
that point the Vat settles into the event loop: inbound connections are
accepted and can deliver messages to the root object, the root object can
create new objects and share them through other messages, and connections are
brought up as needed to communicate with new Vats introduced through still
more messages.

## Vat Restart

Each time an inbound message is accepted, a line is written to
`$BASEDIR/output-transcript`. This can be used to restart a Vat after e.g. a
machine reboots:

* shut down the vat by sending SIGINT to the `vat run` process
* copy the `output-transcript` to `input-transcript`
* start the Vat again with `vat run`

The Vat will execute the initial code as usual, then process all messages
from input transcript before accepting network connections. This process is
deterministic: it will generate the same outbound messages as the earlier run
(which will be ignored as duplicates by other Vats).

To ensure deterministic execution, do not change the code in
`$BASEDIR/source/` between runs.

## Logging

A `log()` function is available to Vat code. Unfortunately `console.log()`
does not work there yet (we're
[trying](https://github.com/Agoric/PlaygroundVat/issues/5) to fix that).

## Examples

[examples/callResponse](../examples/callResponse) contains a simple example
with two Vats. The "left" vat sends a message at startup, the "right" vat
responds to that message, and finally the left vat logs the result.

To run it, navigate to the `examples/callResponse` directory and open two
shells (one for each Vat). In one shell, run `vat left`. Run `vat right` in
the other shell.

You should see the left vat create a TCP connection to the right vat, send
the first message, receive the second message, then exit.

## Experimenting With Contract Code

The [`examples/contractHost`](../examples/contractHost) directory contains
the examples from our [Distributed Electronic Rights in
JavaScript](https://storage.googleapis.com/pub-tools-public-publication-data/pdf/40673.pdf)
paper. There are five Vats involved: Alice, bob, Mint, Host, and Driver. The
"driver" Vat drives the process: change the `which` argument in
`driver/argv.json` to control which variant to exercise. The `start.sh`
script will launch all five vats at the same time (but you will need to kill
the resulting processes yourself when done).

## Quorum Vats

Quorum Vats are created from a collection of Solo Vats with the [`vat
convert-to-quorum`](vat-basedir.md#quorum-vats) tool. For a preconfigured
example, look in [examples/quorum](../examples/quorum).

## Running Vats on Separate Computers

The examples in `examples/` rely upon all the communicating Vats sharing a
common parent directory: they look in sibling directories to find the network
addresses of the hosts they are asked to contact. To run Vats on different
computers, you will need to copy this address information into a nearby
directory so the comms layer can find it. We hope to remove this limitation
eventually, via some kind of address-discovery mechanism (possibly using
libp2p's DHT feature, once is it available in javascript).
