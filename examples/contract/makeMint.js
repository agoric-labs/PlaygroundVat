/*global Vow Flow def Nat*/
// Copyright (C) 2012 Google Inc.
// Copyright (C) 2018 Agoric
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

function makeMint() {
  // Map from purse or payment to balance
  // TODO Replace all uses of WeakMap for private state with a PrivateState
  // wrapper that distinguishes init from set, and bundles in this insistBrand.
  const ledger = new WeakMap();
  function insistBrand(holder) {
    if (!ledger.has(holder)) {
      throw new Error(`not a purse or payment of this currency`);
    }
  }

  function transferNow(src, dest, amount = ledger.get(src)) {
    insistBrand(src);
    insistBrand(dest);
    Nat(amount);
    // Just checking for possible overflow. Bitints should never fail this.
    Nat(ledger.get(dest) + amount);
    const srcNewBal = Nat(ledger.get(src) - amount);
    /////////////////// commit point //////////////////
    // All queries above passed with no side effects.
    // During side effects below, any early exits should be made into
    // fatal turn aborts.
    ledger.set(src, srcNewBal);
    // In case dest and src are the same, add to dest's updated
    // balance rather than the original balance. The current balance
    // must be >= 0 and <= the original balance, so no additional
    // Nat test is needed.
    // This is good because we're after the commit point, where no
    // non-fatal errors are allowed.
    ledger.set(dest, ledger.get(dest) + amount);
    return amount;
  }

  const issuer = def({
    makeEmptyPurse(name) { return mint(0, name); },

    // srcP can be either a purse or a payment. If it contains a balance of
    // at least `amount`, then that is moved to a fresh payment, which is
    // returned. The more normal way to make a payment is `purse.withdraw`.
    // The `withdrawFrom` method on issuer enables an escrow exchange to get
    // an exclusive payment from an issuer that Alice and Bob agree on.
    withdrawFrom(srcP, amount, name) {
      name = String(name);
      return Vow.resolve(srcP).then(src => {
        const payment = def({
          toString() { return `payment ${name}`; },
          getBalance: function() { return ledger.get(payment); },
          getIssuer() { return issuer; }
        });
        ledger.set(payment, 0);
        transferNow(src, payment, amount);
        return payment;
      });
    },
    withdrawAllFrom(srcP, name) {
      return issuer.withdrawFrom(srcP, undefined, name);
    }
  });

  const mint = function(initialBalance, name) {
    name = String(name);
    const purse = def({
      toString() { return `purse ${name}`; },
      getBalance: function() { return ledger.get(purse); },
      getIssuer() { return issuer; },
      withdraw(amount, name) {
        return issuer.withdrawFrom(purse, amount, name);
      },
      withdrawAll(name) {
        return purse.withdrawFrom(undefined, name);
      },
      // srcP can currently be either a purse or a payment, but it really
      // should be a payment
      deposit: function(amount, srcP) {
        return Vow.resolve(srcP).then(src => {
          return transferNow(src, purse, amount);
        });
      },
      depositAll(srcP) {
        return purse.deposit(undefined, srcP);
      }
    });
    ledger.set(purse, initialBalance);
    return purse;
  };
  return def({ mint });
}

export const mintMaker = {
  makeMint
};
