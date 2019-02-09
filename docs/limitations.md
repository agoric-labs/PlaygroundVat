
# Limitations

This prototype is sufficient to experiment with ocap-style contract code.
However, it is not destined to support production environments. The
particular technologies used were selected for quick implementation rather
than their sustainability.

Some of these limitations may be fixed by improvements to be made in this
repository. However many deeper issues will be addressed in a subsequent
prototype, in a different repo, in a non-backwards-compatible fashion.

## Webkeys

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

## Acks are Unimplemented

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

## SES not limited to deterministic subset of JavaScript

The JavaScript language does not have a deterministic spec, giving
implementations [some wiggle
room](https://github.com/tc39/proposal-frozen-realms#how-deterministic)
in how they implement the language. Currently, SES inherits much of
this non-determinism. For example, JavaScript specifies that
`Array.prototype.sort` must use a correct sorting algorithm, but does
not specify which one. These differences are observable. Thus, given
the same starting state and incoming messages, the same JavaScript
program may execute differently on different implementation.

However, JavaScript is deterministic enough that the typical program,
not written to provoke these issues, will execute deterministically
enough for our present prototyping purposes.

## Inefficiently Serialized Checkpoints

The current prototype does not serialize the state of the Vat. Instead, it
simply remembers every inbound message by writing them to a file named
`output-transcript`. To pause and resume a Vat, you kill the process, copy
the `output-transcript` file to `input-transcript`, and then restart the
process with `vat run`. The new process will start by executing every message
from `input-transcript`, and since execution should be deterministic, this
should result in exactly the same internal state as existed when the process
was killed.

A better approach would persist the state of all objects reachable from
sturdyrefs, transparently, in some sort of database checkpoint. The
checkpoint would need to include all unacknowledged outbound messages, as
well as enough information to reject previously-executed inbound messages.
But it should not need to remember all historical input messages, nor should
it need to re-process all those messages (i.e. neither the size of the
checkpoint nor the runtime of startup should grow without bound).

## Incomplete Promise Pipelining

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

## Awkward Message-Send Syntax

Code run in this Vat has access to a `Flow` constructor, which augments
Promises with some new useful delivery-ordering properties. Flows provide
`Vows` rather than built-in Promises, and these Vows have a new feature
that enables messages to be sent to their target (both local and remote).

If you know that `fooP` is a Vow, you can send a message `bar()` with
some arguments to its target like this:

```javascript
const resultVow = E(fooP).bar(arg1, arg2)
```

If and when `fooP` eventually resolves to some object `foo`, this will
cause `bar` to be invoked:

```javascript
const result = foo.bar(arg1, arg2)
```

The special `.e` property is a specialized Proxy that records `.bar` as a
method name, along with the arguments. This enables normal Javascript
method-invocation syntax to be used (vs something awkward that requires the
method name to be provided as a string, e.g. `fooP.invoke('bar', arg1,
arg2)`).

Invocation of this proxy returns a Vow for the result. This Vow can be used
as the target of another method invocation, without waiting for it to
resolve:

```javascript
const directoryP = E(fsP).getDir('music');
const fileP = E(directoryP).getFile('never-gonna-give-you-up.mp3');
E(playerP).play(fileP);
```

This proxy syntax is not perfect: there is no particular reason to use `e`
other than it is short. The proposed syntax for SES is to use an exclamation
point (pronounced "bang"), which will require a parser or source-to-source
transformation function:

```javascript
const resultVow = fooP!bar(arg1, arg2)
```

The motivation for `!` is that `fooP!bar()` is like `foo.bar()`, but the
"bang" brings the readers attention to the asynchronous nature of its
execution.

(The E language, from which this originates, used a left-arrow: `fooP
<- bar(args)`. However in Javascript this syntax would collide with
comparison and negation: `fooP < -bar(args)`. Many message passing
languages and formalisms, from CSP to Pi Calculus to Erlang, use infix
`!` to send its right operand as a message to the destination
designated by its left operand.)


## Incomplete SES Implementation

This Vat uses the SES library to get a object-capability-safe execution
environment. SES does [not yet](https://github.com/Agoric/SES/issues/3) fully
freeze the primordials, which permits several communication channels that
should be forbidden.

## No Resource controls

We currently have nothing like a gas model, nor any clean way to handle
out-of-memory conditions. Rather, for purposes of the prototype, we assume
SES programs only use "reasonable" amounts of resources.

## Incomplete libp2p-js

We use [libp2p](https://libp2p.io/) for networking, specifically the
[js-libp2p](https://github.com/libp2p/js-libp2p) Javascript implementation.
HostIDs are libp2p node identifiers (a base58 hash of an RSA public key).
Libp2p gives us transport-layer encryption with strong identifiers for the
other end of each connection (inbound and outbound), which is critical for
the security of our VatTP message-passing protocol.

However js-libp2p is missing a lot of features that the flagship [Go
implementation](https://github.com/libp2p/go-libp2p) provides. One feature we
would like is the DHT that disseminates host addresses. With that in place,
knowledge of a HostID would be sufficient to reach that host. Since we don't
have it, we need a way to learn a host's multiaddresses before we can connect
to it. Our prototype does this automatically if and only if the Vats are all
running in sibling directories. When running Vats on separate computers, you
must manually copy the address information into each new Vat (somewhat like
an `/etc/hosts` file).

We might address this with embedded address hints, "redirectories", and/or by
running a central server that can distribute address information.

Closely related to this is the NAT-bypassing relay behavior that allows IPFS
servers to work behind firewalls. The consequence of this being absent from
the JS port is that Vat nodes behind a firewall will not be able to accept
connections from other Vats outside that firewall. Once a connection is made,
it is used for messages in both directions, so certain topologies will work
anyways.

js-libp2p defaults to using (2048-bit) RSA keys for the node identities,
which is adequate, but I'd prefer Ed25519 elliptic-curve keys, which are
smaller and much faster. We may rewrite VatTP to use an entirely different
wire protocol, in which messages are individually encrypted and *then* signed
(so the signatures could be checked by third parties). In that case, the
transport-layer encryption would be redundant, and we wouldn't care so much
about the details.

The networking code currently brings up connections on demand: the TCP
connection for each target host is initiated as soon as the first outbound
message is generated for that host. An additional one-second loop is used to
retry any failed connections. This is a bit too aggressive, and should be
changed to use an exponential backoff algorithm, with random jitter to avoid
the "thundering herd" problem. In addition, until we have ACKs, we will try
to make a connection even after all the messages have been delivered. Status
messages are displayed to stdout each time the loop runs, making the console
somewhat noisy (but we should display at least one message when the
connection fails, to help diagnose problems).
