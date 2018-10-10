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


  // Map from tokenIssuer to sides
  const sides = new WeakMap();
  // Map from tokenIssuer to description
  const descriptions = new WeakMap();

  return def({

    describe(allegedTicketPurseP) {
      return Vow.resolve(allegedTicketPurseP).then(allegedTicketPurse => {
        const allegedTicketIssuer = allegedTicketPurse.getIssuer();
        const ticketIssuerDesc = descriptions.get(allegedTicketIssuer);
        if (ticketIssuerDesc === undefined) {
          throw new TypeError(`wrong ticket issuer`);
        }
        const purseDescription = allegedTicketIssuer.describe(allegedTicketPurse);
        return def({...ticketIssuerDesc, purseDescription});
      });
    },

    redeem(allegedTicketPurseP) {
      return Vow.resolve(allegedTicketPurseP).then(allegedTicketPurse => {
        const allegedTicketIssuer = allegedTicketPurse.getIssuer();
        const side = sides.get(allegedTicketIssuer);
        if (side === undefined) {
          throw new TypeError(`wrong ticket issuer, or used up`);
        }
        const redeemP = allegedTicketIssuer.getExclusive(1, allegedTicketPurse, 'redeemed');
        return Vow.resolve(redeemP).then(_ => {
          sides.delete(allegedTicketIssuer);
          return side;
        });
      });
    },

    setup(contractSrc, terms) {
      contractSrc = `${contractSrc}`;
      // TODO BUG SECURITY: insufficient coercion
      // players must be a normal array of distinct strings
      // terms must be...
      const {players: [...players], ...restTerms} = terms;
      terms = def({players, ...restTerms});

      const f = new Flow();
      const ticketPs = new Map();
      const ticketRs = new Map();
      
      for (const player of players) {
        ticketPs.set(player, f.makeFlow(r => ticketRs.set(player, r)));
      }

      const sideRegistrar = def({

        register(player, side) {
          player = `${player}`;
          const ticketResolver = ticketRs.get(player);
          if (ticketResolver === undefined) {
            throw new TypeError(`unrecognized player ${player}`);
          }
          const ticketPurse = makeMint().mint(1, `ticket for player ${player}`);

          sides.set(player, def(side));
          descriptions.set(player, `player ${player}`);
          ticketResolver(ticketPurse);
        }
      });

      const contractP = Vow.resolve(SES.confineExpr(contractSrc, {Flow, Vow, log}));
      const doneP = contractP.then(contract => contract(terms, sideRegistrar));

      return def(ticketPs);
    }
  });
});
