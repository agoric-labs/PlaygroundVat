# Usage

This prototype is still very rough, and lacks both developer ergonomics and
user-friendliness. Please accept our apologies.

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

Look at the (callResponse example)[../examples/callResponse] for a
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
