# The Agoric "Playground" Vat

[![License][license-image]][license-url]

This repository contains the first prototype of our object-capability-style
Javascript execution environment, otherwise known as a "Vat". You can load
code inside a Vat to create an initial object, and then that object can
create other objects, or communicate with objects in other Vats. All of these
objects are sandboxed and cannot affect the host machine except through
specifically provided "endowments". An executable tool named `vat` is
provided to create and launch these Vats.

See [docs/objcap.md](docs/objcap.md) for an introduction to Vats and
Object-Capabilities. [docs/usage.md](docs/usage.md) contains some brief
instructions on how to use the Vat.

## Features of this Playground Vat

* All code runs in an [SES](https://github.com/Agoric/SES) environment, so
  primordials are frozen to prevent tampering.
* `def()` is available to tamperproof API objects against manipulation by
  callers
* `new Flow()` and `new Flow().makeVow()` are available to create
  Promise-like objects which enable eventual-send and remote message
  delivery, with per-Flow ordering and some amount of promise-pipelining
* Cross-Vat references can be used to send messages to external hosts, with
  full cryptographic protection on the network protocol, provided by libp2p
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
