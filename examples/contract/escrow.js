export function escrowExchange(a, b) {  // a from Alice , b from Bob
  function makeTransfer(srcPurseP, dstPurseP, amount) {
    const makeEscrowPurseP = Q.join(srcPurseP.invoke("getMakePurse"),
                                    dstPurseP.invoke("getMakePurse"));
    const escrowPurseP = makeEscrowPurseP.fcall("escrow");
    return def({
      phase1() { return escrowPurseP.invoke("deposit", amount, srcPurseP); },
      phase2() { return dstPurseP.invoke("deposit", amount, escrowPurseP); },
      abort() { return srcPurseP.invoke("deposit", amount, escrowPurseP); }
    });
  }

  function failOnly(cancellationP) {
    Q(cancellationP).then(cancellation => { throw cancellation; });
  }

  const aT = makeTransfer(a.moneySrcP, b.moneyDstP, b.moneyNeeded);
  const bT = makeTransfer(b.stockSrcP, a.stockDstP, a.stockNeeded);
  return Q.race([Q.all([aT.phase1(), bT.phase1()]),
                 failOnly(a.cancellationP),
                 failOnly(b.cancellationP)])
    .then( x => Q.all([aT.phase2(), bT.phase2()]),
           ex => Q.all([aT.abort(), bT.abort()]));
};
