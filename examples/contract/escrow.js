/*global Vow def*/
export function escrowExchange(a, b) {  // a from Alice , b from Bob
  function makeTransfer(srcPurseP, dstPurseP, amount) {
    const issuerP = Vow.join(srcPurseP.e.getIssuer(),
                             dstPurseP.e.getIssuer());
    const escrowPaymentP = issuerP.e.withdrawFrom(srcPurseP, amount, "escrow");
    return def({
      phase1() { return escrowPaymentP.then(amount); },
      phase2() { return dstPurseP.e.depositAll(escrowPaymentP); },
      abort() { return srcPurseP.e.depositAll(escrowPaymentP); }
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
    .then(x => Vow.all([aT.phase2(), bT.phase2()]),
          ex => Vow.all([aT.abort(), bT.abort()]));
}
