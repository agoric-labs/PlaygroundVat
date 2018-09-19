# The Agoric "Playground" Vat

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

### Webkeys

Each object has a secret "swissnum", and knowledge of the swissnum is what
provides the authority to send messages to that object. This is the same
approach used by [Foolscap](https://foolscap.lothar.com/) and
[Waterken](http://waterken.sourceforge.net/).

While security on the Internet always depends upon secrets, ideally these
secrets can be sequestered into as small a domain as possible. Webkeys are
the opposite: they are exercised by delivering them to the target vat
(imagine if I asked you to prove that you know a secret by telling me the
secret; if I didn't already know the secret, well, I do now). To do this
safely, we need a confidential channel that is bound to the target Vat,
otherwise a network eavesdropper could learn the swissnums and exercise
authority that was not granted to them. A failure in the confidentiality of
the channel will enable eavesdroppers to violate integrity.

In Foolscap, Waterken, and E's
[VatTP](http://erights.org/elib/distrib/vattp/index.html) layer, channel
confidentiality is achieved with a TLS (or TLS-like) secure-transport
protocol. Asymmetric public keys are used for Vat identity, a key-agreement
protocol is used to establish a symmetric transport key, and an authenticated
encryption mode provides both confidentiality and integrity for the actual
records.

A better approach would use signing keys as the secret. The sender
demonstrates knowledge of the secret by signing the message, and the
receiving Vat verifies the signature before accepting the message for
delivery. The link might also be encrypted, but a failure of confidentiality
will not cause the integrity to be violated.

Webkeys are fundamentally broken, however, in the face of Quorum Vats: each
member host learns the webkey of the target object, and it could create a
Solo Vat (or share the webkey with someone else who runs a Solo Vat) and
unilaterally access the target object. This would violate our intention that
the members of a Quorum Vat should not be able to act alone, but only with
the cooperation of the other members.

A future design will switch to "c-lists", in which each Vat maintains a table
of inbound references. The table is indexed by both sending Vat and a small
integer identifier for each object. This table is initially populated by
outbound messages that contain object references (the local object is
recorded as the value, and a new integer is allocated as the key). It can
also be populated by a special "three-party handoff" protocol which is used
each time an object in one Vat (A) sends a message to a second Vat (B) which
contains a reference to some object living on a third Vat (C). Finally, the
table can be populated by exercising special "sturdyref" URI strings, which
behave like webkeys and enable references to be bootstrapped from outside the
existing reference graph.

### Acks are Unimplemented

Each Vat host is obligated to remember outbound messages (and retransmit them
each time a new network connection is established) until the target Vat
acknowledges receipt, which transfers responsibility for the message to the
recipient. This ACK also generally marks the point at which the receiving Vat
commits to executing a particular message: deterministic execution requires
each Vat to remember their execution history (despite restarts) and never
execute messages in a different order.

The ACK enables the sender to safely forget about outbound messages. It also
interacts with the ordering properties of three-party handoffs (to implement
the [WormholeOp](http://erights.org/elib/distrib/captp/WormholeOp.html)).

Since every message will require an ACK, a simplistic approach would double
the number of network messages. Optimizing this out is valuable, which
requires some careful design work. In addition, Quorum Vats make ACKs
complicated: ACKs are a host-to-host message, but they must be sent only when
the overall Vat has accepted a vat-to-vat message.

So for expediency, ACKs were removed altogether. The current prototype
remembers every outbound message, forever, and re-delivers all of them each
time a new network connection is made. The recipient ignores duplicate
messages.

### Inefficiently Serialized Checkpoints

The current prototype does not serialize the state of the Vat. Instead, it
simply remembers every inbound message by writing them to a file named
`output-transcript`. To pause and resume a Vat, you kill the process, copy
the `output-transcript` file to `input-transcript`, and then restart the
process with `vat run`. The new process will start by executing every message
from `input-transcript`, and since execution is deterministic, this should
result in exactly the same internal state as existed when the process was
killed.

A better approach would persist the state of all objects reachable from
sturdyrefs, transparently, in some sort of database checkpoint. The
checkpoint would need to include all unacknowledged outbound messages, as
well as enough information to reject previously-executed inbound messages.
But it should not need to remember all historical input messages, nor should
it need to re-process all those messages (i.e. neither the size of the
checkpoint nor the runtime of startup should grow without bound).

### Incomplete Promise Pipelining

Our current Flow and messaging implementation does not enable as much
pipelining as we would like. Messages sent to the target of an remote
invocation will be pipelined to that remote Vat, but if that target forwards
its Vow to a third Vat, the messages do not flow through to the third Vat.
Instead, they sit queued on the second Vat until the target has fully
resolved.

In addition, these messages are likely to be delivered in the wrong order
(specifically, messages sent through the original "long" path might arrive
after messages sent later through the "short" path). The ordering properties
of Flows that span Vat boundaries are still being developed, as well as wire
protocols that enable efficient enforcement of those properties. The protocol
must also protect "liveness": one Vat should not be able to prevent progress
of messages in a Flow that is not depending upon that Vat, even when
three-party handoffs are involved.

### Non-Ideal Message-Send Syntax

Code run in this Vat has access to a `Flow` constructor, which augments
Promises with some new useful delivery-ordering properties. Flows provide
`Vows` rather than built-in Promises, and these Vows have a new feature
that enables messages to be sent to their target (both local and remote).

If you know that `fooP` is a Vow, you can send a message `bar()` with
some arguments to its target like this:

```javascript
let resultVow = fooP.e.bar(arg1, arg2)
```

If and when `fooP` eventually resolves to some object `foo`, this will
cause `bar` to be invoked:

```javascript
let result = foo.bar(arg1, arg2)
```

The special `.e` property is a special Proxy that records `.bar` as a method
name, along with the arguments. This enables normal Javascript
method-invocation syntax to be used (vs something awkward that requires the
method name to be provided as a string, e.g. `fooP.invoke('bar', arg1,
arg2)`).

Invocation of this proxy returns a Vow for the result. This Vow can be used
as the target of another method invocation, without waiting for it to
resolve:

```javascript
let directoryP = fsP.e.getDir('music');
let fileP = directoryP.e.getFile('never-gonna-give-you-up.mp3');
playerP.e.play(fileP);
```

This proxy syntax is not perfect: there is no particular reason to use `e`
other than it is short. The proposed syntax for SES is to use an exclamation
point (pronounced "bang"), which will require a parser or source-to-source
transformation function:

```javascript
let resultVow = fooP!bar(arg1, arg2)
```

The motivation for `!` is that `fooP!bar()` is just like `foo.bar()`, but the
"bang" brings the readers attention to the asynchronous nature of its
execution.

(The E language, from which this originates, used a left-arrow: `fooP <-
bar(args)`. However in Javascript this syntax would collide with comparison
and negation: `fooP < -bar(args)`.)


### Incomplete SES Implementation

This Vat uses the SES library to get a object-capability -safe execution
environment. SES does [not yet](https://github.com/Agoric/SES/issues/3) fully
freeze the primordials, which permits several communication channels that
should be forbidden.
