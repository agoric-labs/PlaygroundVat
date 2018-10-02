/*global Vow def log Nat*/
export const escrowExchange =
  def((contractMgr, {moneyIssuerP, stockIssuerP,
                     moneyNeeded, stockNeeded}) =>
  {
    moneyIssuerP = Vow.resolve(moneyIssuerP);
    stockIssuerP = Vow.resolve(stockIssuerP);

    moneyNeeded = Nat(moneyNeeded);
    stockNeeded = Nat(stockNeeded);
    

    const makeTransfer = (issuerP, srcPurseP, refundPurseP,
                          dstPurseP, amount) =>
    {
                              
      // TODO: Adopt a consistent style about when we do and do not to
      // say Vow.resolve around a possible vow.
      issuerP = Vow.resolve(issuerP);
        
      const escrowPurseP = issuerP.e.getExclusive(amount, srcPurseP,
                                                  "escrow");
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

    let moneySrcResolve;
    const moneySrcP = new Vow(r => moneySrcResolve = r);
    const moneyRefundP = moneyIssuerP.e.makeEmptyPurse();
    const moneyDstP = moneyIssuerP.e.makeEmptyPurse();

    let stockSrcResolve;
    const stockSrcP = new Vow(r => stockSrcResolve = r);
    const stockRefundP = stockIssuerP.e.makeEmptyPurse();
    const stockDstP = stockIssuerP.e.makeEmptyPurse();
    
    const aT = makeTransfer(moneyIssuerP, moneySrcP, moneyRefundP,
                            moneyDstP, moneyNeeded);
    const bT = makeTransfer(stockIssuerP, stockSrcP, stockRefundP,
                            stockDstP, stockNeeded);
    
    const decisionP = Vow.race([Vow.all([aT.phase1(), bT.phase1()]),
                                failOnly(a.cancellationP),
                                failOnly(b.cancellationP)]);
    const completionP = decisionP.then(
      x => Vow.all([aT.phase2(), bT.phase2()]),
      ex => Vow.all([aT.abort(), bT.abort()]));

    const aliceFacet = def({
      buy(moneyPaymentP) {
        moneySrcResolve(moneyPaymentP);
        return def({
          moneyRefundP,
          stockDstP,
          aliceCancel
        });
      }
    });
    const aliceTicketPurse = contractMgr.setupFacet('alice', aliceFacet);

    const bobFacet = def({
      sell(stockOfferedP) {
        stockSrcResolve(stockOfferedP);
        return def({
          stockRefundP,
          moneyDstP,
          bobCancel
        });
      }
    });
    const bobTicketPurse = contractMgr.setupFacet('bob', bobFacet);

    return [aliceTicketPurse, bobTicketPurse];
  });
