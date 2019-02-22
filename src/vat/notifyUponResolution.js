export function makeResolutionNotifier(_myVatID, opResolve) {
  const resolutionNotifiers = new WeakMap(); // vow -> { swissnum, Set(vatID) }

  function notifyUponResolution(value, targetVatID, swissnum) {
    // console.log(`notifyUponResolution for my ${myVatID} ${swissnum} to ${targetVatID}`);
    if (targetVatID === null) {
      return;
    }

    function notify(id, notifySwissnum, result) {
      // console.log('  to', id, swissnum);
      opResolve(id, notifySwissnum, result);
    }

    if (!resolutionNotifiers.has(value)) {
      // let c = `${myVatID}-${nurCount++}`;
      // console.log(' nUR adding', c);
      const rec = {
        followers: new Set(),
        resolved: false,
        // c,
      };
      resolutionNotifiers.set(value, rec);
      /* eslint-disable-next-line no-inner-declarations */
      function done(result) {
        rec.resolved = true;
        // todo: there's probably a race here, if somehow opResolve reenters
        // into notifyUponResolution and adds a new follower. Unlikely but
        // untidy.

        // TODO: notification order depends upon Set iteration, will this
        // cause nondeterminism? OTOH, these messages are strictly sent to
        // different vats, so it isn't observable by a single outside vat
        const followersArray = Array.from(rec.followers);
        followersArray.forEach(id => notify(id, swissnum, result));
      }
      value.then(done, done);
    }
    const rec = resolutionNotifiers.get(value);

    if (rec.followers.has(targetVatID)) {
      return;
    }
    rec.followers.add(targetVatID);

    if (rec.resolved) {
      // done() already fired, this late follower needs to catch up
      /* eslint-disable-next-line no-inner-declarations */
      function notifyNow(result) {
        notify(targetVatID, swissnum, result);
      }
      value.then(notifyNow, notifyNow);
    }
  }

  return notifyUponResolution;
}
