
## Vats, Solo Vats, Quorum Vats

Vats are the container in which objects live. Objects in separate vats are
limited to making asynchronous "**eventual send**" calls to each other. This
insulates the objects against unexpected control-flow hazards like exceptions
and reentrancy.

The only way for an object to make a synchronous (blocking) call to another
object is for the two to share a Vat. In addition to exceptions and
reentrancy hazards, objects are also vulnerable to resource-exhaustion
attacks from their neighbors, like infinite loops and excessive memory
consumption.

We define several different kinds of Vats. In the future we hope to build
specialized Vats (based on zero-knowledge proofs, multi-party computation, or
secure computing elements, all of which may be limited in the kind of code
they can run), but for now we're starting with two types of general-purpose
Vats that can support arbitrary ocap-style programs:

* **Solo Vat**: this runs on a single computer
* **Quorum Vat**: this runs across multiple computers, with a basic consensus
  rule by which downstream vats (receiving messages from the Quorum Vat) can
  determine whether a given message reflects the will of the group, not just
  that of a single member. A message is considered valid if a configured
  threshold of the members agree to the contents.

(of course, for demonstration or testing, the quorum vat might be implemented
as multiple processes on a single computer)

Quorum vats can have improved credibility compared to a solo vat, because
there are more parties that must be willing to agree to the group decision.
This makes the most sense when the individual machines are distributed across
trust domains: if you and your business partners each operate one member of a
quorum vat, you can feel more confident that the joint behavior will match
your expectations.

Objects cannot tell whether they're running on a Solo or a Quorum vat. The
difference lies in the "comms layer" through which the vats communicate.

We define a **Host** as a single process (on a single computer). Solo Vats
use a single host, while quorum vats involve multiple hosts. An object that
"lives" in a quorum vat will be replicated across all the hosts. Those hosts
will receive and act upon exactly the same sequence of messages, and will all
contain exactly the same set of objects. Since Vat computation is a
deterministic function of the inbound messages, all these hosts will produce
exactly the same sequence of outbound messages.

The **Vat ID** identifies a specific Vat, regardless of its type.

## Messages, Encryption, Comms Layers

Each Host has an identity defined by a public key. In the current prototype,
these come from libp2p "Peer IDs", which are base58-encoded SHA256 hashes of
2048-bit RSA public keys, that look like
`QmNtqu3WNhNGPkWkxQDwZd2FPUp43v22YGdx13xMx7RD54`. libp2p establishes
authenticated confidential connections between hosts, so messages arriving at
one host are securely labelled with the host ID of their sender. libp2p
provides a connection-oriented API (dial/listen/accept), but for generality
our comms layer does not depend upon this. We treat each new connection as an
opportunity to (re-)deliver any remaining outbound messages, and retain all
such messages until the receiving end sends an explicit acknowledgement.

Since inbound connections are securely associated with an identity, we use
them for outbound messages to that same host. A convenient side-effect is
that only one side of each connection must have a public IP address, and the
other can live behind a NAT box or firewall without loss of connectivity.

Solo Vats, which use only one host, share a Vat ID with that host. So the
VatID of a solo vat could be
`QmNtqu3WNhNGPkWkxQDwZd2FPUp43v22YGdx13xMx7RD54`.

Quorum Vats, in their current form, contain an explicit and fixed list of
Hosts, and also have a threshold count which says how many of those hosts
must agree to a message for it to be valid. The VatID is a combination of
these strings, encoded in a form that retains the ability to be used in URIs.
So a 2-out-of-3 Quorum VatID could look like:

`q2-QmP1yPTRZLKiB9mNDDBvfSCPbi1mBH2w8uLsurcr2iS47X-QmTxsHYt2a5sWpatR6LTaW4eHR9d4BozAyKMUH89YjFHsE-QmRqcYjecavhxrGm3pXKnAc6PUAouRwCygeoMCjfWE2E4X`

(where the `q` means quorum vat, and the `2` means that at least two hosts
must agree).

Vats (whether Solo or Quorum) exchange Vat Messages. When an object in one
vat invokes a method on an object in a different vat, a Vat Message will be
sent from one to the other.

Vat Messages are internal data structures, just like objects. When a Vat
Message is transmitted, what really emerges is a collection of Host Messages,
sent from the host (or hosts) of the sending vat, to the host (or hosts) of
the receiving vat. The receiving hosts comms layers know the quorum rules,
and only deliver the vat message if the requirements are met.

All Vat Messages include three common fields:

* Sender Vat ID
* Recipient Vat ID
* Message Sequence Number

The **Message Sequence Number** is scoped to a particular sender/recipient
pair, and starts at 0. There is a separate counter for each direction, so
VatA->VatB might be at seqnum 4, while VatB->VatA could be at seqnum 2. The
Message Sequence Number is decided by the sender. Vat Messages for any given
pair are delivered strictly in order of sequence number, with no gaps (if the
target receives messages 1, 3, and 4, it will deliver 1 but withhold the
result until it gets 2 first). The recipient is responsible for maintaining
this ordering, by buffering incoming messages until they can be delivered.
There may be additional (more restrictive) ordering constraints.

There are two types of Vat Messages: **opSend** and **opResolve** (and we
might add **opReject** in the future). "opSend" messages include the target
object identifier, method name, serialized arguments, and optionally a way to
deliver the result of the invocation. "opResolve" messages refer to a
resolver (perhaps the answer of a previous message) and a value to resolve it
to. These are combined with the operation type, and serialized into the Vat
Message.

The **Vat Message ID** is a string which definitively identifies a single Vat
Message. It is nominally a secure hash of the serialized Vat Message, but for
the prototype we simply use the entire serialized form.

The comms layer must look inside the Vat Message to extract the Sender Vat ID
and the sequence number, both of which affect delivery. These sequence
numbers are also used to retransmit unacknowledged messages at the start of
each new connection.

Solo Vats and Quorum Vats are realized on one or more Hosts, each of which
has its own identifier. The network transport uses cryptographic keys held by
these hosts. When a Vat Message needs to be sent between Hosts, it is encoded
into a **Host Message**. 

There are three types of Host Messages: **op**, **ack**, and **decide**. The
first two are sent when the containing Vat wants to send an opSend or
opResolve to a member of some other Vat, or acknowledge the same. These
consist of a type keyword (like ``OP``), and the serialized Vat Message.

The ``DECIDE`` Host Message is used internally among members of a Quorum Vat
to coordinate their actions, and contains a "decision seqnum", a Recipient
Vat ID, and a Vat Message ID, collectively known as the Decision Message. To
help the implementation find the right message, the Decision Message also
includes an alleged Sender Vat ID and Message Sequence Number.

All three types of Host Messages also include cryptographic evidence that the
sending Host approves of the contents. For ``OP`` messages, this indicates
that the host is a member of the Sender Vat and binds this membership to the
generated message. For ``DECIDE`` messages, it shows the host (which must be
the Leader of the Quorum Vat) has committed to a particular order in which to
deliver the Vat Message (referenced by ID).

The prototype uses libp2p encrypted channels, so the "evidence" is simply
that the serialized ``OP`` and Vat Message (or ``DECIDE`` and Decision
Message) appears inside a channel which comes from the Sender Host ID.

A future system will instead use portable signatures, allowing this evidence
to be presented to others (whereas transport-layer security cannot convince
anyone except the other end of the channel). Portable evidence will enable
Quorum Vat members to reliably "gossip" incoming messages to each other,
removing certain equivocation attacks. In this system, the Host Message will
contain the type, the serialized Vat or Decision Message, and a signature
over both made by the Sending Host's private key.

No single Host should be a member of multiple Quorum Vats. We could possibly
accomodate such an arrangement, but it would be confusing at best.

## Arrival Order Non-Determinism

For any given sequence of inbound messages, Vat computation is deterministic.
The only deviation we tolerate is called "arrival order non-determinism", and
is an inevitable consequence of the finite speed of light. The improved
integrity/credibility of a quorum vat comes at the cost of slower operations
to accomodate coordination between the member hosts.

To keep a group of Hosts (members of a Quorum Vat) in sync, we must ensure
they all see the same sequence of messages. The question they must achieve
consensus about is the order in which they will process inbound messages.

## Message Delivery, Input Transcript

Each host has a "Comms Manager" which determines which an inbound Host
Messages can be upgraded to Vat Messages and then executed. Each time this
happens, the Vat Message is written to the durable "input transcript", then
delivered to the Execution Engine, which might make changes to internal state
and/or emit new outbound Vat messages. If/when the Vat is restarted, we
recover the same internal state by replaying everything in the input
transcript.

We allow the outbound messages to be retransmitted, because other Vats will
ignore these replays.

We remember each outbound message until it is acknowledged by the recipient
Vat. This will not happen until that Vat has written the message to its
durable transcript, transferring responsibility from the sender to the
recipient. Deleting messages is a space optimization: the prototype simply
retains all messages forever (which enables us to detect and report
mismatches after delivery).

TODO: there is a confusion here between the target Vat acknowledging the Vat
message, and an individual Host acknowledging the host message. A quorum vat
does not have a single input transcript; rather, the individual hosts each
have one. We're avoiding this question for now by ignoring acks and retaining
all messages forever, but eventually we must figure this out. The more likely
answer is that we retain outbound Host messages until we get an ack from the
specific host we sent it to, but those hosts won't send the ack until they
deliver the Vat message to their execution engine (and transcript). The less
likely answer is that acks are strictly vat-to-vat (not host-to-host), and
must meet a threshold requirement just like opSend and opResolve.

## Quorum Leaders and Followers

The consensus algorithm we use for this prototype is a simple fixed
leader/follower protocol. When the Quorum Vat is first created, one specific
Host is named the Leader, and the rest are Followers. We minimize internal
coordination by declaring the first host of the quorum VatID list as the
leader (although other Vats are generally unaware of the difference: they
send to the Vat as a whole, and don't care about how the internal politics).

Leaders make the decision about which message to deliver. Followers (are
supposed to) receive the same messages as leaders, but they refrain from
acting upon them until the leader announces its ordering decision. Followers
buffer inbound messages until they get delivery approval.

Upstream Vats send Host Messages to every member of the target Vat. Members
send their individual host messages to downstream hosts.

Solo Vats are their own Leaders.

## Scoreboard, Next Seqnum, Threshold, Decision List

Each host, in the receiving comms layer, maintains a data structure named the
**scoreboard** to keep track inbound Host Messages and their delivery to the
execution engine.

This structure is implicitly indexed by Recipient Host ID, because any given
process will only have data for a single Recipient Host (itself). Likewise it
is implicitly indexed by Recipient Vat ID, since a single Host should not be
a member of multiple quorum vats.

The scoreboard is a mapping from Sender Vat ID to a record with three fields:

```
scoreboard[sVatID].nextSeqnum = message-seqnum (integer)
scoreboard[sVatID].msgs[messageSeqnum][msgID] = set(sHostID)
scoreboard[sVatID].threshold = integer
```

The first field records the next acceptable sequence number for a given
(Sender Vat ID, Recipient Vat ID) pair. The comms layer is only allowed to
deliver messages in rigid order, so all lower-numbered messages are
discarded, and all higher-number seqnums are buffered in the hopes of being
delivered later.

The second field tracks which Vat Messages are ready for delivery because we
have seen sufficient evidence that their Sender Vat did in fact mean them to
the sent (i.e. multiple hosts for a Quorum Vat). This section is additionally
indexed by then seqnum, then Sender Host ID. Each entry holds a "message ID",
which is either the full contents of the inner vat message, or a secure hash
of it, so it can be used to tell whether two separate hosts are referring to
the same Vat message or not (if we only hold the hash, we must also retain at
least one copy of the full message so we'll have something to deliver).

The third field remembers the threshold for the Sender Vat ID. For our
current scheme, this is easily parsed out of the VatID, but a future scheme
might require more work. If the upstream vat is a Solo Vat, the threshold
will be 1, and the set of Sender Host IDs could be replaced by a boolean (or
the table of msgIDs could be replaced by a string-or-None Option type).

If the host is a Follower, it maintains a second data structure: the
**decision list**. This is populated by ``decide`` message from the Leader.
``decide`` messages are only accepted if the Sender Host ID matches the first
component of the Recipient Vat ID. (In a future system, host messages may
include a signed cryptographic certificate demonstrating the host's
membership in a Vat, in which case the criteria will be that the Sender Host
ID is mentioned in a certificate that is signed by the Sender Vat ID).

If the host is a Leader (or a Solo Vat), there is no decision list, and
messages are processed as soon as they meet the scoreboard criteria.

```
decisionList = list({decision-seqnum, sVatID, message-seqnum})
```

The decision list is ordered by a "decision seqnum" associated with each
entry. This enables the Leader to deliver ``decide`` messages over a
transport that does not preserve ordering (such as when the connection is
lost and then reestablished). Any ``decide`` message that contains a
``decision-seqnum`` which is already on the list is ignored (after
checking/logging that its contents are identical). We can only deliver the
lowest entry on the decision list, and we remove it from the list upon
delivery.

The comms layer cannot recognize a Vat Message until all the fields in both
data structures approve it. The "nextSeqnum" is updated after each delivery.
The pending messages must be reevaluated after each inbound Host Message
(which might increase a scoreboard item beyond the quorum threshold), or
inbound ``decide`` message (which might make a previously-quorum-ed message
eligible), or actual delivery (which might make the next messageSeqnum
ready). It must loop until no more work can be done, because the arrival of
an older Host Message may unblock multiple Vat Messages in a single step.
