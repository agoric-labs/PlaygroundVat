
export function makeResolutionNotifier(log, myVatID, opResolve) {
  const resolutionNotifiers = new WeakMap(); // vow -> { swissnum, Set(vatID) }

  let nurCount = 60;
  function notifyUponResolution(value, targetVatID, swissnum) {
    //log(`notifyUponResolution for my ${myVatID} ${swissnum} to ${targetVatID}`);
    if (targetVatID === null) {
      return;
    }
    if (!resolutionNotifiers.has(value)) {
      let c = `${myVatID}-${nurCount++}`;
      //log(' nUR adding', c);
      const followers = new Set();
      resolutionNotifiers.set(value, { swissnum, followers, c });
      function notify(result) {
        //log(' nUR.notify', c, result);
        for (let id of followers) {
          //log('  to', id, swissnum);
          opResolve(id, swissnum, result);
        }
      }
      value.then(notify, notify);
    }
    //log(` adding ${targetVatID} to ${resolutionNotifiers.get(value).c}`);
    resolutionNotifiers.get(value).followers.add(targetVatID);
  }

  return notifyUponResolution;
}
