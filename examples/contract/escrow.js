/*global Vow def log*/
export const makeEscrowExchange = def(({moneyIssuerP, stockIssuerP}) => (
  def((a, b) => {  // a from Alice , b from Bob

    const makeTransfer = (issuerP, srcPurseP, refundPurseP,
                          dstPurseP, amount) => {

      // TODO: Adopt a consistent style about when we do and do not to
      // say Vow.resolve around a possible vow.
      issuerP = Vow.resolve(issuerP);
      
      const escrowPurseP = issuerP.e.getExclusive(amount, srcPurseP, "escrow");
      return def({
        phase1() { return escrowPurseP; },
        phase2() { return dstPurseP.e.deposit(amount, escrowPurseP); },
        abort() { return refundPurseP.e.deposit(amount, escrowPurseP); }
      });
    };

    const failOnly = cancellationP => (
      Vow.resolve(cancellationP).then(cancellation => {
        throw cancellation;
      }));

    const aT = makeTransfer(moneyIssuerP, a.moneySrcP, a.moneyRefundP,
                            b.moneyDstP, b.moneyNeeded);
    const bT = makeTransfer(stockIssuerP, b.stockSrcP, a.stockRefundP,
                            a.stockDstP, a.stockNeeded);
    return Vow.race([Vow.all([aT.phase1(), bT.phase1()]),
                     failOnly(a.cancellationP),
                     failOnly(b.cancellationP)])
      .then(x => Vow.all([aT.phase2(), bT.phase2()]),
            ex => Vow.all([aT.abort(), bT.abort()]));
  })));
