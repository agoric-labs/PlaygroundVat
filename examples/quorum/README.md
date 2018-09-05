# Quorum Vat example

This directory defines three Vats:

* `one`: a Solo Vat
* `two`: a 2-of-3 Quorum Vat, spread over hosts `twoA`, `twoB`, `twoC`
* `three`: a 3-of-3 Quorum Vat, spread over hosts `threeA`, `threeB`,
  `threeC`

When `one` wakes up, it sends a message to `two`, which prints it. Each host
will print a note to stdout upon receipt. You should see three such messages,
one from each `two` host. `two` will respond to `one`'s message.

When `two` wakes up, it sends a message to `one`, which prints it to stdout.
You should see one such message printed by `one` after the threshold is
reached, which will after the second member of `two` is started.

When `two` wakes up, it also sends a message to `three`. When the components
of `three` receive this message, they will forward it to `one`. You should
see `one` print a single message at this point.

`one` prints an "everything works" message after it receives all three
messages: the response from `two`, the wakeup message from `two`, and the
forwarded message from `three`.

This exercises solo->quorum, quorum->quorum, and quorum->solo.

## Running

Make sure you can run `bin/vat` from the top of the source tree (you'll need
to do `npm install` first, and possibly change the `#!` "shbang" line to
point at your copy of `node`).

Then run `./start.sh`, which will launch all the vats.

Then a command like `watch 'grep ++ out/*'` will show the most important
stdout messages from all vats. Wait for one to say `EVERYTHING WORKS`.

Use `killall node` to shut down all hosts (as well as killing off any other
Node.js programs on your computer).

Delete the `out/` directory before running again, since the `start.sh` script
will try to recreate it each time.

## Testing

If you edit `start.sh` to comment out the launch of host `twoC`, the demo
will work anyways, because vat `two` has a quorum threshold of 2. The
contributions of hosts `twoA` and `twoB` are sufficient.

If you comment out the launch of host `threeC` instead, the demo will fail
(in particular the `++ forwardedFromThree` message will never appear on vat
`one`), because vat `three` has a quorum threshold of 3: all three hosts are
required.
