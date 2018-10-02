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

/**
 * @fileoverview Simple AMD module exports a {@code makeContractHost}
 * function, which makes a contract host, which makes and runs a
 * contract. Requires SES and its simple AMD loader.
 * @requires define, WeakMap, Q, cajaVM
 * @author Mark S. Miller erights@gmail.com
 */

/**
 * A contract host as a mutually trusted third party for honestly
 * running whatever smart contract code its customers agree on.
 *
 * <p>When mutually suspicious parties wish to engage in a joint
 * contract, if they can agree on a contract host to be run the
 * following code honestly, agree on the code that represents their
 * smart contract, and agree on which side of the contract they each
 * play, then they can validly engage in the contract.
 *
 * <p>The {@code contractSrc} is assumed to be the source code for a
 * closed SES function, where each of the parties to the contract is
 * supposed to provide their respective fulfilled arguments. Once
 * all these arguments are fulfilled, then the contract is run.
 *
 * <p>There are two "roles" for participating in the protocol:
 * contract initiator, who calls the contract host's {@code setup}
 * method, and contract participants, who call the contract host's
 * {@code play} method. For example, let's say the contract in
 * question is the board manager for playing chess. The initiator
 * instantiates a new chess game, whose board manager is a two
 * argument function, where argument zero is provided by the player
 * playing "white" and argument one is provided by the player
 * playing "black".
 *
 * <p>The {@code setup} method returns an array of numPlayer tokens,
 * one per argument, where each token represents the exclusive right
 * to provide that argument. The initiator would then distribute these
 * tokens to each of the players, together with the alleged source for
 * the game they would be playing, and their alleged side, i.e., which
 * argument position they are responsible for providing.
 *
 * <pre>
 *   // Contract initiator
 *   var tokensP = Q(contractHostP).invoke('setup', chessSrc, 2);
 *   var whiteTokenP = Q(tokensP).get(0);
 *   var blackTokenP = Q(tokensP).get(1);
 *   Q(whitePlayer).invoke('invite', whiteTokenP, chessSrc, 0);
 *   Q(blackPlayer).invoke('invite', blackTokenP, chessSrc, 1);
 * </pre>
 *
 * <p>Each player, on receiving the token, alleged game source, and
 * alleged argument index, would first decide (e.g., with the {@code
 * check} function below) whether this is a game they would be
 * interested in playing. If so, the redeem the token to
 * start playing their side of the game -- but only if the contract
 * host verifies that they are playing the side of the game that
 * they think they are.
 *
 * <pre>
 *   // Contract participant
 *   function invite(tokenP, allegedChessSrc, allegedSide) {
 *     check(allegedChessSrc, allegedSide);
 *     var outcomeP = Q(contractHostP).invoke(
 *         'play', tokenP, allegedChessSrc, allegedSide, arg);
 *   }
 * </pre>
 */

export const makeContractHost = def(() => {

// Kludge. Do not include this by copying the source.
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
      const newPurse = issuer.makeEmptyPurse();
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


  const joinAll = def((xs, ys) => {
    if (xs.length !== ys.length) {
      throw new RangeError(`different lengths: ${xs} vs ${ys}`);
    }
    return Vow.all(xs.map((x, i) => Vow.join(x, ys[i])));
  });   

  // Map from tokenIssuer to exercise function.
  const m = new WeakMap();

  return def({
    setup(contractMakerSrc, numPlayers, terms, ...setupArgs) {
      contractMakerSrc = `${contractMakerSrc}`;
      numPlayers = Nat(numPlayers);
      const tokenPurses = [];
      const argPs = [];
      let resolve;
      const f = new Flow();
      const resultP = f.makeVow(r => resolve = r);
      const makeContract = SES.confineExpr(contractMakerSrc, {Flow, Vow, log});

      const addParam = (i, tokenPurse) => {
        const tokenIssuer = tokenPurse.getIssuer();
        tokenPurses[i] = tokenPurse;
        let resolveArg;
        argPs[i] = f.makeVow(r => resolveArg = r);

        m.set(tokenIssuer, (allegedSrc, allegedTerms, allegedI, arg) => {
          if (contractMakerSrc !== allegedSrc) {
            throw new Error(`unexpected contract maker: ${contractMakerSrc}`);
          }
          if (i !== allegedI) {
            throw new Error(`unexpected side: ${i}`);
          }
          return joinAll(terms, allegedTerms).then(
            _ => {
              m.delete(tokenIssuer);
              resolveArg(arg);
              return resultP;
            });
        });
      };
      for (let i = 0; i < numPlayers; i++) {
        addParam(i, makeMint().mint(1, `singleton token ${i}`));
      }
      return Vow.resolve(makeContract(terms, ...setupArgs)).then(contract => {
        Vow.all(argPs).then(args => resolve(contract(...args)));
        // Don't return the tokenPurses until and unless we succeeded at
        // making the contract instance.
        return tokenPurses;
      });
    },
    play(allegedTokenPurseP, allegedSrc, allegedTerms, allegedI, arg) {
      return Vow.resolve(allegedTokenPurseP).e.getIssuer().then(tokenIssuer => {
        const exerciseFunc = m.get(tokenIssuer);
        if (!exerciseFunc) { throw new TypeError(`invalid issuer`); }
        const redeemPurseP = tokenIssuer.getExclusive(
          1, allegedTokenPurseP, `thrown away redeem purse`);
        return redeemPurseP.then(_ => exerciseFunc(
          allegedSrc, allegedTerms, allegedI, arg));
      });
    }
  });
});
