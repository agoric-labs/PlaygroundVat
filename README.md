# The Agoric "Playground" Vat

[![License][license-image]][license-url]

This repository contains the first prototype of our object-capability -style
Javascript execution environment, otherwise known as a "Vat".

## What is an Object?

In the Object-Capability world, each "object" is a defensible unit of
behavior. These objects have private state (not directly accessible from
outside), which includes both plain data and references to other objects.
They also have a set of public methods, which accept arguments, trigger the
execution of some private piece of code, and return a Promise for their
result. This private code can examine or modify the private state, and it can
send messages to any object to which it has a reference.

The important rules of object-capability discipline are:

* No Ambient Authority: the only way to affect anything you might care about
  is through an object which owns that thing
* Unforgeable References: there are only two ways to get a reference to some
  object:
  * create that object
  * get it from someone who already has a reference
* No Communication Without References: the only way to interact or share data
  with an object is through messages, which implies there is some path
  between the two objects that are trying to communicate. This prohibits side
  channels and shared ambient mutable state.

Javascript objects, when created in a secure environment like
[SES](https://github.com/Agoric/SES), have these properties.

## What is a Vat?

A "Vat" is a container for some number of objects. Its primary purpose is to
allow objects on different computers to interact with each other.

On a single computer, inter-object messages are simply method invocations.
But between computers, these messages must be serialized into bytes. And on
the open internet, we must use cryptography to maintain the unforgeability of
references against eavesdroppers and Vats which simply try to create
unauthorized messages.

Vats also represent a "termination domain" that partitions
resource-exhaustion attacks. Any code running inside a Vat could go into an
infinite loop, bringing further progress of the Vat to a halt. Likewise the
code might allocate more memory than the host can provide, or use more stack
frames than can fit into memory, both of which could cause the Vat to crash.
However this only affects the one Vat which hosted the troublesome code: all
other Vats with which it might communicate are insulated from the failure.
For this reason, it can be useful to run multiple Vats on a single computer.
Typically each Vat will be associated with a single customer, so if that
(mean) customer intentionally does something to cause a failure, they'll only
be hurting themselves and service can continue unaffected for other (nicer)
customers.

Vats maintain a queue of messages that need to be delivered. This queue is
filled by incoming messages from other Vats. It also holds "eventual sends",
which are local messages that have been deliberately enqueued rather than
being invoked synchronously. This avoids accidental reentrancy and other
forms of "plan interference" hazards.

Vat execution is deterministic, given a previous state and a specific
ordering of input messages. This allows the Vat's state to be checkpointed
and restarted later (perhaps to recover from a host CPU failure, or to
migrate it to a different host entirely). One technique is to wait until the
message queue is empty and then record the entire object graph. Another is to
record the entire sequence of delivered messages and restore the Vat by
simply replaying all of them in the same order.

## Features of this Playground Vat

* All code runs in an [SES](https://github.com/Agoric/SES) environment, so
  primordials are frozen to prevent tampering.
* `def()` is available to tamperproof API objects against manipulation by
  callers
* `new Flow()` and `new Flow().makeVow()` are available to create
  Promise-like objects which enable eventual-send and remote message
  delivery, with per-Flow ordering and some amount of promise-pipelining
* Cross-Vat references can be used to send messages to external hosts, with
  full cryptographic protection on the network protocol
* State checkpoints are implemented by recording all inbound messages (in
  order), enabling deterministic playback after restart.
* "Quorum Vats" replicate computation across multiple hosts. Downstream Vats
  only accept messages from a Quorum Vat if a minimum threshold of component
  hosts sent identical copies of those messages.

## Limitations

This prototype is sufficient to experiment with ocap-style contract code.
However, it is not destined to support production environments. The
particular technologies used were selected for quick implementation rather
than their sustainability.

Some of these limitations may be fixed by improvements to be made in this
repository. However many deeper issues will be addressed in a subsequent
prototype, in a different repo, in a non-backwards-compatible fashion.

Please see [docs/limitations.md](docs/limitations.md) for a complete list.

## Bug Disclosure

Despite this not being ready for production use, we'd like to get into the
practice of responsible disclosure. If you find a security-sensitive bug that
should not be revealed publically until a fix is available, please send email
to `security` at (@) `agoric.com`. To encrypt, please use my (@warner)
personal GPG key [A476E2E6 11880C98 5B3C3A39 0386E81B
11CAA07A](http://www.lothar.com/warner-gpg.html) . Keybase users can also
send messages to `@agoric_security`, or share code and other log files via
the Keybase encrypted file system
(`/keybase/private/agoric_security,$YOURNAME`).

For non-security bugs, use the
[regular Issues page](https://github.com/Agoric/PlaygroundVat/issues).



[license-image]: https://img.shields.io/badge/License-Apache%202.0-blue.svg
[license-url]: LICENSE
