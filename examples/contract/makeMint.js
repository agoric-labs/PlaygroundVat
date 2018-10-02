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

const makeMint = def(() => {
  // Map from purse or payment to balance
  const ledger = new WeakMap();

  const issuer = def({
    // Make a purse initially holding no rights (the empty set of
    // rights), but able to hold the kinds of rights managed by this
    // issuer.
    makeEmptyPurse(name) { return mint(0, name); },

    // More convenient API for non-fungible goods
    getExclusive(amount, srcP, name) {
      const newPurse = issuer.makeEmptyPurse(name);
      return newPurse.deposit(amount, srcP).then(_ => newPurse);
    },

    // Amounts are data, but are not necessarily numbers. Together
    // with an Issuer identity, an amount describes some set of rights
    // as would be interpreted by that issuer. This asks whether
    // providedAmount describes a set of rights that includes all
    // rights in the set described by neededAmount.
    //
    // The parameter names suggest only one of two major use
    // cases. The other is includes(offeredAmount, takenAmount)
    includes(providedAmount, neededAmount) {
      return Nat(providedAmount) >= Nat(neededAmount);
    }
  });

  const mint = def((initialBalance, name) => {
    const purse = def({
      getIssuer() { return issuer; },
      // An amount describing the set of rights currently in the purse.
      getBalance() { return ledger.get(purse); },
      deposit(amount, srcP) {
        amount = Nat(amount);
        return Vow.resolve(srcP).then(src => {
          const myOldBal = Nat(ledger.get(purse));
          const srcOldBal = Nat(ledger.get(src));
          Nat(myOldBal + amount);
          const srcNewBal = Nat(srcOldBal - amount);

          /////////////////// commit point //////////////////
          // All queries above passed with no side effects.
          // During side effects below, any early exits should be made into
          // fatal turn aborts.
          ///////////////////////////////////////////////////

          ledger.set(src, srcNewBal);
          // In case purse and src are the same, add to purse's updated
          // balance rather than myOldBal above. The current balance must be
          // >= 0 and <= myOldBal, so no additional Nat test is needed.
          // This is good because we're after the commit point, where no
          // non-fatal errors are allowed.
          ledger.set(purse, ledger.get(purse) + amount);
        });
      }
    });
    ledger.set(purse, initialBalance);
    return purse;
  });
  return def({ mint });
});

export const mintMaker = {
  makeMint
};
