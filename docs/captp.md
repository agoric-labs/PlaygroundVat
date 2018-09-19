# CapTP (the new/prototype version)

This documents the approach we currently use (in our protype) for the
equivalent of E's **CapTP** layer. This layer managers promises, resolution,
messaging, and serialization. It does no cryptography or network IO: that is
left up to the equivalent of VatTP (roughly src/vat/remotes.js and
src/comms.js).

We do not yet do Promise Pipelining. Messages sent to an unresolved Vow are
queued on the sending Vat until the Vow is resolved.

## The Ask-Tell Spectrum

Vats create Vows, which can:

* Eventually resolve, to some object on some Vat (not necessarily the same
  Vat which originally created the Vow), using the `.then()` syntax.
* Act as arguments in messages, or as the return value of a message
* Act as the target of a message, which (if pipelining were implemented)
  would cause the messages to flow to the "best current home" of the Vow,
  where they will accumulate in the hopes of being near the Vow's resolution.
  Since we don't yet do pipelining, all messages wait on the sender's Vat
  until resolution.

When a Vow is sent to a different Vat, the recipient frequently (but not
always) wants to know when (and to what) the Vow might eventually resolve.
There is a design spectrum available to us which controls how these
resolution messages are delivered. The two ends are roughly labelled "Ask"
and "Tell".

E's CapTP layer implements the "Tell" end of this spectrum. On this side, the
sender of a Promise (E's name for a Vow) is obligated to make sure the
recipient learns about the resolution. E does this by telling the recipient
to create a **Redirector** along with the Promise. The sender retains a
reference to this Redirector, and when it hears about improvements in the
Promise's resolution status (which might be forwarding to a new "best current
home", or a complete and final resolution), it will send this information
along to the Redirector. All Promises have a Redirector, and sending a
Promise to a new Vat creates a link between the original Redirector and the
newly-created one. All the Redirectors for a given Vow thus form a spanning
tree through which notifications are delivered.

The "Ask" end of the spectrum instead delivers Vows without thought to how
the recipient is going to get resolution information, in fact without knowing
whether the recipient cares to get such information at all. Instead, the
*recipient* is obligated to find the home of the Vow and ask it directly to
be notified if and when the Vow is resolved. Resolved Vows are sent in
exactly the same way as unresolved Vows, but the recipient might turn around
and subscribe to resolution reports immediately, and they'll receive it on
the next message.

This incurs more network messages, and more roundtrips (for the resolved-vow
case), but is simpler to implement, and good enough for the prototype.

## Our Old Implementation

Our previous prototype (ca. 06-Sep-2018) implemented a moderate form of the
"Tell" end, expressed within our webkey (as opposed to c-list) approach. In
that version, sending a Vow to a different Vat obligates the sender to
remember to notify that recipient about the Vow's resolution. This is
implemented with a `.then()` on the Vow, with a callback that delivers an
`opResolve` message to the target Vat. `opResolve` is only honored when it
comes *from* the "Home Vat" of the Vow, since that's the only Vat with the
authority to resolve the Vow.

This interacts badly with third-party Vows. If Carol creates a Vow and sends
it to Alice, Carol will remember that Alice needs to be notified when it
resolves. If Alice then sends that Vow to Bob, Alice does not have the
authority to make claims about its resolution (only Carol does). Carol does
not know that Bob needs to be notified. The only solution here is to have
Alice first wrap Carol's Vow in one of her own, then send the wrapper to Bob.
In this approach, Vats can only ever send "my vow", or "your vow", but never
"their vow".

It also interferes with the cache of serialized messages. A single Vow must
be serialized differently when sending to different Vats: sending it home
should use the serialization that was cached when it arrived, but sending it
to a third party requires wrapping.

## The New Implementation

The current approach uses the far end of the "Ask" spectrum. All Vows are
serialized identically, with a type marker, a "Home Vat" ID, and a swissnum.
The serialization code does not know or care which target Vat will receive
the message it creates.

The receiving side, upon receiving the serialization of a Vow it has not seen
before, sends a special **opWhen** message to the "Home Vat" of this Vow
(which might be the sending Vat, or some other Vat). The `opWhen` includes
the swissnum of the Vow in question.

The Home Vat, upon receiving the `opWhen`, looks up the target Vow and uses
`.then()` to register a callback that will be run when it resolves, closing
over the ID of the Vat which sent the `opWhen`. The callback sends an
`opResolve` to that Vat, citing the Vow's swissnum, and serializing the
resolution (which must be a Presence or a pass-by-copy object, not another
Vow). `opResolve` does not include a Vat ID, because the VatTP layer
provides the identity of the sending Vat along with the message, and
`opResolve` can only resolve Vows owned by the sending Vat. When
`opResolve` is received, the recipient looks up the local resolver by
sending VatID and swissnum, and invokes it with the value.

Each Vat's serialization layer maintains a pair of tables: a WeakMap from
values to serialization record (which includes the webkey: VatID and
swissnum), and a Map from webkey to value. These ensure that a given outbound
object is serialized the same way each time (the swissnum is allocated
exactly once, the first time the object is serialized), and that local
objects roundtrip to the identical object. This also ensures that incoming
objects will be serialized outbound with the same webkey that was used
inbound, so they will roundtrip correctly back to their home.

These tables also serve to ensure that the `opWhen` is only sent once for
any given Vow. When a new (remote) Vow arrives from afar, its webkey is not
found in the table, so a new local Vow (with a FarRemoteHandler) is created,
and the `opWhen` is sent. If the same Vow arrives a second time (perhaps
from some other source), the webkey will already be in the table, so it
deserializes to the same Vow, and no new `opWhen` is sent.

It also protects the Vat against accidentally sending `opWhen` for its own
Vows. The first time the local Vow meets the serialization code will be in an
argument or return value, and at that point it will be assigned a swissnum
and put in the table. If this Vow is returned from a remote Vat, it will be
found in the table, bypassing the `opWhen` send.

## Upsides

Outbound serialization does not care what the target Vat is: it doesn't need
to populate a table that tracks who must be notified (this only occurs upon
receipt of an `opWhen`). Outbound objects are serialized the same way no
matter where they are being sent.

Outbound serialization does not care whether a Vow is resolved or not. This
required a private `resolutionOf()` hook in the old implementation, and
caused the serialized form to change depending upon exactly when it was
serialized. This interfered with object identity when a Vow was sent to one
Vat before resolution, a second Vat after resolution, and the two Vats then
compared notes.

Inbound serialization does not care what the source Vat is. (It *does* need
to pay attention to the objects being deserialized, and react to new Vows,
but that reaction uses the Vow's *Home Vat*, rather than the source Vat of
the enclosing message).

Sending a remotely-hosted Vow to a third party does not require interaction
with that Vow's home Vat. This advantage will go away when we move away from
webkeys/swissnums to a C-List protocol, since there will be no
globally-meaningful swissnum for the Vow. Handing the reference to the third
party will require a conversation with the home Vat (but hopefully no
roundtrips), to allocate and then claim an entry in the handoff table.

## Downsides

We must keep track of which Vats have registered an interest in each Vow. I
think we can rely upon each (correctly functioning) Vat to send at most one
`opWhen` request, so we can just attach a `.then()` to the Vow, with a
callback that sends an `opResolve` to the interested Vat. If we must
tolerate Vats sending multiple `opWhen`s, we will need a Set inside the
(now mutable) serialization record to track which ones were already added.

Sending a resolved Vow in a method argument incurs an extra roundtrip before
the recipient can `.then()` those arguments. We could optimize this by
preemptively sending an `opResolve` right away, as long as we remember that
we've done this and refrain from doing it multiple times. This will require a
Set of VatIDs to which we've sent and `opResolve`, in the serialization
record, such that receipt of an `opWhen` will not trigger a second
`opResolve` to the same Vat.

## Deferring opWhen

It is easiest to send `opWhen` upon receipt, rather than waiting. We need
to learn about resolution for two reasons:

* Until we do Promise Pipelining, messages sent to a Vow are queued locally
  until the Vow is resolved, then sent to the target of that resolution. If
  there are (or might be) messages queued, we need to know when it resolves
* Explicit `.then()` calls run their callback function when resolution
  occurs.

By implementing Promise Pipelining, we might remove the first case: if the
"current best home" of the Vow is remote, all messages will be forwarded to
that remote Vat, and nothing will be queued locally, so we don't need to know
when it resolves.

So there may be a future optimization opportunity, to reduce the total number
of messages sent over the wire. We could defer sending the `opWhen()` until
either a message was queued, or `.then()` is called.

A lot of code uses Vows to queue messages, but doesn't actually care when it
resolves:

```javascript
function foo(remoteVow) {
  const x = remoteVow.e.bar(1);
  const y = x.e.baz(2);
  return y.e.buz(3);
}
```

In that example, a lot of messages are queued up, but `.then()` is never
used. Since the original `remoteVow` has a "current best home" on some
remote Vat, all the subsequent Vows will "live" there too, and the
`bar`/`baz`/`buz` messages will be forwarded to that location. When
`foo()` finishes, nothing on the local Vat is left holding a reference to
the intermediate Vows, so nothing can run `.then()` on them. It should be
safe to appreciate their invaluable assistance in coordinating the outbound
messages and then forget about them. No resolution notification is necessary,
and both the `opWhen` and `opResolve` messages can be skipped.
