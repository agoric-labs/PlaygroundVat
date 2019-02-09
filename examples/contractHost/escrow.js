/*global Vow def*/
function escrowExchange(a, b) {  // a from Alice , b from Bob
  function makeTransfer(srcPurseP, dstPurseP, amount) {
    const issuerP = Vow.join(E(srcPurseP).getIssuer(),
                             E(dstPurseP).getIssuer());
    const escrowPurseP = E(issuerP).makeEmptyPurse("escrow");
    return def({
      phase1() { return E(escrowPurseP).deposit(amount, srcPurseP); },
      phase2() { return E(dstPurseP).deposit(amount, escrowPurseP); },
      abort() { return E(srcPurseP).deposit(amount, escrowPurseP); }
    });
  }

  function failOnly(cancellationP) {
    return Vow.resolve(cancellationP).then(cancellation => {
      throw cancellation;
    });
  }

  const aT = makeTransfer(a.moneySrcP, b.moneyDstP, b.moneyNeeded);
  const bT = makeTransfer(b.stockSrcP, a.stockDstP, a.stockNeeded);
  return Vow.race([Vow.all([aT.phase1(), bT.phase1()]),
                   failOnly(a.cancellationP),
                   failOnly(b.cancellationP)])
    .then( x => Vow.all([aT.phase2(), bT.phase2()]),
           ex => Vow.all([aT.abort(), bT.abort()]));
}
