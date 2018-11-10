/* global Nat def Vow */

function makeMint() {
  // Map from purse or payment to balance
  const ledger = new WeakMap();
  
  const issuer = def({
    makeEmptyPurse() { return mint(0); }
  });
  
  const mint = def({
    getIssuer() { return issuer; },
    mint(initialBalance) {
      const purse = def({
        getBalance: function() { 
          return ledger.get(purse);
        },
        getIssuer() { return issuer; },
        deposit: function(amount, srcP) {
          amount = Nat(amount);
          return Vow.resolve(srcP).then(src => {
            const myOldBal = Nat(ledger.get(purse));
            const srcOldBal = Nat(ledger.get(src));
            Nat(myOldBal + amount);
            const srcNewBal = Nat(srcOldBal - amount);
            ledger.set(src, srcNewBal);
            ledger.set(purse, ledger.get(purse) + amount);
          });
        }
      });
      ledger.set(purse, initialBalance);
      return purse;
    }
  });
  return mint;
}

makeMint
