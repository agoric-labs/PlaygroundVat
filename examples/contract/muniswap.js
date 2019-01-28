/*global Vow def log Nat makeEscrowExchange f*/
export const makeMuniswap = def(issuerPs => {

  const pursePs = issuerPs.map(i => i.e.makeEmptyPurse());
  
  return def({
    // Provide liquidity. No incentive to do so yet.
    deposit(dstIndex, amount, srcP) {
      return pursePs[dstIndex].e.deposit(amount, srcP);
    },
    // Exchange blue for green
    exchange(blueIndex, blueOffered, blueSrcP,
             greenIndex, greenNeeded, greenDstP, cancellationP) {
      
      return Promise.all([pursePs[blueIndex].e.getBalance(),
                          pursePs[greenIndex].e.getBalance()]).
        then((blueBalance, greenBalance) => {
          const greenAmount = f(blueBalance, greenBalance, blueOffered);
          if (greenAmount < greenNeeded) {
            throw new Error(`Inadequate exchange rate`);
          }
                     
          const escrowExchange = makeEscrowExchange([issuerPs[blueIndex],
                                                     issuerPs[greenIndex]]);
          const clientArg = def({
            srcP: blueSrcP,
            refundP: blueSrcP,
            dstP: greenDstP,
            needed: greenAmount,
            cancellationP
          });
          
          const selfArg = def({
            srcP: pursePs[greenIndex],
            refundP: pursePs[greenIndex],
            dstP: pursePs[blueIndex],
            needed: blueOffered,
            cancellationP: new Vow()
          });

          return escrowExchange(clientArg, selfArg);
        });
    }
  });            
}
