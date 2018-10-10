/*global SES Vow Flow def log Nat*/
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

export const makeContractHost = def(() => {

// TODO Kludge. Do not include this by copying the source.
const makeMint = def(() => {

  // Map from purse to balance.
  const ledger = new WeakMap();
  // Map from purse to description, which must not be undefined.
  const descriptions = new WeakMap();

  const issuer = def({

    // Iff this is a purse of the this issuer, return its
    // description. Otherwise return undefined. Thus, if the returned
    // result is not undefined, you can trust the allegedPurse as much
    // as you trust this issuer.
    describePurse(allegedPurse) {
      const desc = descriptions.get(allegedPurse);
      if (desc === undefined) {
        throw new TypeError(`not a purse of this issuer`);
      }
      return desc;
    },
    
    // Make a purse initially holding no rights (the empty set of
    // rights), but able to hold the kinds of rights managed by this
    // issuer.
    makeEmptyPurse(description) { return mint(0, description); },

    // More convenient API for non-fungible goods
    getExclusive(amount, srcP, description) {
      const newPurse = issuer.makeEmptyPurse(description);
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

  const mint = def((initialBalance, description) => {
    initialBalance = Nat(initialBalance);
    description = `${description}`;
    
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
    descriptions.set(purse, description);
    return purse;
  });
  return def({ mint });
});


  // Map from tokenIssuer to exercise function.
  const m = new WeakMap();
  // Map from tokenIssuer to description
  const descriptions = new WeakMap();

  return def({

    describe(allegedTicketPurse) {
      const allegedIssuer = allegedTicketPurse.getIssuer();
      const issuerDesc = descriptions.get(allegedIssuer);
      if (issuerDesc === undefined) {
        throw new TypeError(`wrong token issuer`);
      }
      const purseDescription = allegedIssuer.describe(allegedTicketPurse);
      return def({...issuerDesc, purseDescription});
    },
    
    setup(contractSrc, terms, ...setupArgs) {
      contractSrc = `${contractSrc}`;
      // TODO BUG SECURITY: insufficient coercion
      // players must be a normal array of distinct strings
      // terms must be...
      const {players: [...players], ...restTerms} = terms;
      terms = def({players, ...restTerms});
      
      const tokenPurses = [];
      const argPs = [];
      let resolve;
      const f = new Flow();
      const resultP = f.makeVow(r => resolve = r);
      const makeContract = SES.confineExpr(contractSrc, {Flow, Vow, log});

      const addParam = (side, tokenPurse) => {
        const tokenIssuer = tokenPurse.getIssuer();
        tokenPurses[side] = tokenPurse;
        let resolveArg;
        argPs[side] = f.makeVow(r => resolveArg = r);

        const exerciseFunc = def(arg => {
          m.delete(tokenIssuer);
          descriptions.delete(tokenIssuer);
          resolveArg(arg);
          return resultP;
        });
        m.set(tokenIssuer, exerciseFunc);
        descriptions.set(tokenIssuer, def({
          contractSrc,
          terms,
          side
        }));
      };
      players.forEach((player, i) => {
        addParam(i, makeMint().mint(1, `player ${i}: ${player}`));
      });
      return Vow.resolve(makeContract(terms, ...setupArgs)).then(contract => {
        Vow.all(argPs).then(args => resolve(contract(...args)));
        // Don't return the tokenPurses until and unless we succeeded at
        // making the contract instance.
        return tokenPurses;
      });
    },
    play(allegedTokenPurseP, arg) {
      return Vow.resolve(allegedTokenPurseP).e.getIssuer().then(tokenIssuer => {
        const exerciseFunc = m.get(tokenIssuer);
        if (!exerciseFunc) { throw new TypeError(`invalid issuer`); }
        const redeemPurseP = tokenIssuer.getExclusive(
          1, allegedTokenPurseP, `thrown away redeem purse`);
        return redeemPurseP.then(_ => exerciseFunc(arg));
      });
    }
  });
});
