// Our swissnums need to be deterministic across multiple executions of a
// single Vat (with the same input transcript), so we can replay an input
// transcript and get the same output transcript. But they must also be
// unguessable by any code outside of the Vat implementation. So we generate
// them by hashing together a "vat secret" and a counter.

// The vat secret is a hash of the node's "private-id" file (a JSON
// serialized object that contains the private key). Because we're lazy, we
// use the same hash58() function that we use elsewhere, which produces a
// 128-bit base58 string (instead of a full 256-bit binary Buffer). Since
// that's fixed-length, it is safe to merely concatenate it with a decimal
// string containing the counter (which happens to start with "1", because
// "0" is reserved for the "root sturdyref" generated during "vat create").

// We prepend a "comment" to our swissnums: anything before the last hyphen
// is a comment. When comparing swissnums, we compare everything, including
// the comment. But when hashing swissnums, we parse out the comment, hash
// the non-comment part, then glue back on an amended comment that is derived
// from the initial comment. This lets developers see the relationship
// between swissnums when looking at debug traces. This would make for a
// pretty ugly specification, but swissnums are a placeholder anyways and
// will be removed entirely when we switch to c-lists.

// We create a "swissbase" when creating an opSend for a remote Vat to invoke
// a method on their object. We create a synthetic Promise for the results,
// pretending that the target Vat created one and sent it to us. The swissnum
// for that Promise must not collide with anything else on the target Vat,
// but we need to know its value ahead of time. To accomplish this, we send a
// preimage (the "swissbase") in the opSend. We hash this in the same way
// that the target Vat does, giving us both the same resulting swissnum.
// Swissbases are created with a comment of "bNN", and get hashed into a
// string with a comment that starts with "hbNN-".

// We don't hash things more than once

// vatsecret   =         WHMV2quAubLYGoFtXtpEao (=hash58('vat secret'))
// swiss1      =       1-QJLaesBjzmJURkMeDUBanr (='1-'+hash58(vatsecret))
// swiss2      =       2-8j3hwtrXHPLuG4tDPbMSQm
// swissbase3  =      b3-8ETwGG3NFZMskqWBorEhe2
// hash sb3    = hb3-8ET-9vy5vpgVHi9H4PJCNYKxas

export function makeSwissnum(vatSecret, count, hash58) {
  const preimage = `${vatSecret}${count}`;
  return `${count}-${hash58(preimage)}`;
}

export function makeSwissbase(vatSecret, count, hash58) {
  return `b${makeSwissnum(vatSecret, count, hash58)}`;
}

export function doSwissHashing(base, hash58) {
  const commentEnd = base.lastIndexOf('-');
  const citation = base.slice(0, commentEnd + 4);
  const newComment = `h${citation}`;

  const nonComment = base.slice(commentEnd + 1);
  const newSwiss = hash58(nonComment);

  return `${newComment}-${newSwiss}`;
}

export function vatMessageIDHash(vatMessageString, hash58) {
  const preimage = `msgID-hash-of-${vatMessageString}`;
  return hash58(preimage);
}
