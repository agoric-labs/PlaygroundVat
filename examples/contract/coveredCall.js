/*global Vow def log Nat*/
export const makeCoveredCall = def((
  [moneyIssuerP,
   stockIssuerP,
   timerP,
   deadline,
   strikePrice,
   numShares],
  stockSrcP) => {

// TODO Kludge. Do not include this by copying the source.
const makeEscrowExchange = def(([moneyIssuerP, stockIssuerP]) => (
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

    moneyIssuerP = Vow.resolve(moneyIssuerP);
    stockIssuerP = Vow.resolve(stockIssuerP);
    timerP = Vow.resolve(timerP);
    
    deadline = Nat(deadline);
    strikePrice = Nat(strikePrice);
    numShares = Nat(numShares);
    const exerciseCost = strikePrice * numShares;
    
    const escrowExchange = makeEscrowExchange([moneyIssuerP, stockIssuerP]);

    const stockEscrowP = stockIssuerP.e.getExclusive(numShares, stockSrcP,
                                                     'stock escrow');

    // According to the contract code, the contract instance doesn't
    // even exist until and unless we have agreement on the terms and
    // we have succeeded at escrowing numShares of stock from the
    // stockSrcP provided in the setup args (typically by Bob).
    
    return stockEscrowP.then(
      _ => def((buyer, seller) => {  // buyer from Alice , seller from Bob

        const aliceArg = def({
          moneySrcP: buyer.moneySrcP,
          moneyRefundP: buyer.moneyRefundP,
          stockDstP: buyer.stockDstP,
          stockNeeded: numShares,
          cancellationP: new Vow()
        });

        let cancel;
        const bobArg = def({
          stockSrcP: stockEscrowP,
          stockRefundP: seller.stockRefundP,
          moneyDstP: seller.moneyDstP,
          moneyNeeded: exerciseCost,
          // TODO is new Vow ok?
          cancellationP: new Vow(r => { cancel = r; })
        });

        timerP.delayUntil(deadline).then(_ => cancel(`expired`));

        return escrowExchange(aliceArg, bobArg);
      }));
  });
