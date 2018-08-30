
export function makeResolutionNotifier(log, myVatID, opResolve) {
  const resolutionNotifiers = new WeakMap(); // vow -> { swissnum, Set(vatID) }

  let nurCount = 60;
  function notifyUponResolution(value, targetVatID, swissnum) {
    //log(`notifyUponResolution for my ${myVatID} ${swissnum} to ${targetVatID}`);
    if (targetVatID === null) {
      return;
    }

    function notify(id, swissnum, result) {
      //log('  to', id, swissnum);
      opResolve(id, swissnum, result);
    }

    if (!resolutionNotifiers.has(value)) {
      //let c = `${myVatID}-${nurCount++}`;
      //log(' nUR adding', c);
      const rec = { followers: new Set(),
                    resolved: false,
                    //c,
                  };
      resolutionNotifiers.set(value, rec);
      function done(result) {
        rec.resolved = true;
        // todo: there's probably a race here, if somehow opResolve reenters
        // into notifyUponResolution and adds a new follower. Unlikely but
        // untidy.
        for (let id of rec.followers) {
          // TODO: notification order depends upon Set iteration, will this
          // cause nondeterminism? OTOH, these messages are strictly sent to
          // different vats, so it isn't observable by a single outside vat
          notify(id, swissnum, result);
        }
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
      function notifyNow(result) {
        notify(targetVatID, swissnum, result);
      }
      value.then(notifyNow, notifyNow);
    }
  }

  return notifyUponResolution;
}
