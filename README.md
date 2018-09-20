# The Agoric "Playground" Vat

[![Build Status][travis-svg]][travis-url]
[![dependency status][deps-svg]][deps-url]
[![dev dependency status][dev-deps-svg]][dev-deps-url]
[![License][license-image]][license-url]

This repository contains a proof-of-concept implementation for our
distributed smart contracts system. Contracts are written in SES, a
secure subset of JavaScript. SES programs are deployed in _vats_, a
runtime that operates consistently across single "solo" machines,
permissioned/quorum clusters, or public blockchains. This proof-of-concept
demonstrates the "solo" and "quorum" vats executing in independent
machines and processes, communicating securely using ocap protocols.

The example contracts are taken from [Distributed Electronic Rights in
JavaScript](https://ai.google/research/pubs/pub40673). The SES runtime
is enhanced so that it runs deterministically, and supports replicated
consensus execution, in which a quorum of replicas must agree upon an order of
incoming messages. The secure data connections are implemented using libp2p.

## How to use it

You can load code inside a Vat to create an initial object, and then
that object can create other objects, or communicate with objects in
other Vats. All of these objects are sandboxed and cannot affect the
host machine except through specifically provided "endowments". An
executable tool named `vat` is provided to create and launch these Vats.

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


[travis-svg]: https://travis-ci.com/Agoric/PlaygroundVat.svg?branch=master
[travis-url]: https://travis-ci.com/Agoric/PlaygroundVat
[coveralls-svg]: https://coveralls.io/repos/github/Agoric/PlaygroundVat/badge.svg
[coveralls-url]: https://coveralls.io/github/Agoric/PlaygroundVat
[deps-svg]: https://david-dm.org/Agoric/PlaygroundVat.svg
[deps-url]: https://david-dm.org/Agoric/PlaygroundVat
[dev-deps-svg]: https://david-dm.org/Agoric/PlaygroundVat/dev-status.svg
[dev-deps-url]: https://david-dm.org/Agoric/PlaygroundVat?type=dev
[license-image]: https://img.shields.io/badge/License-Apache%202.0-blue.svg
[license-url]: LICENSE
