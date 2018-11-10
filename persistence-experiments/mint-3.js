/* global Nat def Vow */

let old = false;

function makeMint() {
  // Map from purse or payment to balance
  const ledger = new WeakMap();
  
  const issuer = def({
    makeEmptyPurse() {
      return mint(0);
    }
  });
  
  const mint = function(initialBalance) {
    const purse = def({
      getBalance: function() {  
        if (old) {
          ledger.set(ledger.get(purse) * 100);
        }
        return ledger.get(purse);
      },
      getIssuer() { return issuer; },
      deposit: function(amount, srcP) {
        amount = Nat(amount);
        return Vow.resolve(srcP).then(src => {
          const myOldBal = Nat(ledger.get(purse));
          const srcOldBal = Nat(ledger.get(src));
          if (old) {
            myOldBal *= 100;
            srcOldBal *= 100;
          }
          Nat(myOldBal + amount);
          const srcNewBal = Nat(srcOldBal - amount);
          if (old) {
            srcNewBal /= 100;
          }
          ledger.set(src, srcNewBal);
          ledger.set(purse, ledger.get(purse) + amount);
        });
      }
    });
    ledger.set(purse, initialBalance);
    return purse;
  };
  return def({ mint });
}

makeMint
