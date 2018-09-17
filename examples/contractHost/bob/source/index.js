/*global Vow Flow def*/
// Copyright (C) 2013 Google Inc.
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

export default function(argv) {
  const escrowSrc = argv.escrowSrc;
  const contractHostP = Vow.resolve(argv.host);
  const aliceP = Vow.resolve(argv.alice);

  const f = new Flow();

  let initialized = false;
  let myMoneyPurseP;
  let myMoneyIssuerP;
  let myStockPurseP;
  let myStockIssuerP;

  function init(myMoneyPurse, myStockPurse) {
    initialized = true;
    myMoneyPurseP = Vow.resolve(myMoneyPurse);
    myMoneyIssuerP = myMoneyPurseP.e.getIssuer();
    myStockPurseP = Vow.resolve(myStockPurse);
    myStockIssuerP = myStockPurseP.e.getIssuer();
  }

  const check = function(allegedSrc, allegedSide) {
    // for testing purposes, alice and bob are willing to play
    // any side of any contract, so that the failure we're testing
    // is in the contractHost's checking
  };

  const bob = def({
    init,
    /**
     * This is not an imperative to Bob to buy something but rather
     * the opposite. It is a request by a client to buy something from
     * Bob, and therefore a request that Bob sell something. OO naming
     * is a bit confusing here.
     */
    buy: function(desc, paymentP) {
      if (!initialized) {
        log('++ ERR: buy called before init()');
      }
      let amount;
      let good;
      desc = ''+desc;
      switch (desc) {
      case 'shoe': {
        amount = 10;
        good = 'If it fits, ware it.';
        break;
      }
      default: {
        throw new Error('unknown desc: '+desc);
      }
      }

      return myMoneyPurseP.e.deposit(10, paymentP).then(_ => good);
    },

    tradeWell: function(bobLies=false) {
      log('++ bob.tradeWell starting');
      if (!initialized) {
        log('++ ERR: tradeWell called before init()');
      }
      const tokensP = contractHostP.e.setup(escrowSrc);
      const aliceTokenP = tokensP.then(tokens => tokens[0]);
      const bobTokenP   = tokensP.then(tokens => tokens[1]);
      let escrowSrcWeTellAlice = escrowSrc;
      if (bobLies) {
        escrowSrcWeTellAlice += 'NOT';
      }
      const doneP = Vow.all([aliceP.e.invite(aliceTokenP,
                                             escrowSrcWeTellAlice, 0),
                             Vow.resolve(bob).e.invite(bobTokenP,
                                                       escrowSrc, 1)]);
      doneP.then(res => log('++ bob.tradeWell done'),
                 rej => log('++ bob.tradeWell reject', rej));
      return doneP;
    },

    /**
     * As with 'buy', the naming is awkward. A client is inviting
     * this object, asking it to join in a contract instance. It is not
     * requesting that this object invite anything.
     */
    invite: function(tokenP, allegedSrc, allegedSide) {
      if (!initialized) {
        log('++ ERR: invite called before init()');
      }
      log('++ bob.invite start');
      check(allegedSrc, allegedSide);
      log('++ bob.invite passed check');
      let cancel;
      const b = def({
        stockSrcP: myStockIssuerP.e.makeEmptyPurse('bobStockSrc'),
        moneyDstP: myMoneyIssuerP.e.makeEmptyPurse('bobMoneyDst'),
        moneyNeeded: 10,
        cancellationP: f.makeVow(function(r) { cancel = r; })
      });
      const ackP = b.stockSrcP.e.deposit(7, myStockPurseP);

      const doneP = ackP.then(_ => {
        log('++ bob.invite ackP');
        return contractHostP.e.play(tokenP, allegedSrc, allegedSide, b);
      });
      return doneP.then(
        _ => {
          log('++ bob.invite doneP');
          return b.moneyDstP.e.getBalance();
        },
        rej => {
          log('++ bob.invite doneP reject', rej);
        });
    }
  });
  return bob;
}
