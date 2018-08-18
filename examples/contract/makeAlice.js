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

import { escrowExchange } from './escrow';

function makeAlice(myMoneyPurse, myStockPurse, contractHostP) {
  const escrowSrc = `${escrowExchange}`;
  const myPurse = myMoneyPurse;
  const f = new Flow();

  const check = function(allegedSrc, allegedSide) {
    // for testing purposes, alice and bob are willing to play
    // any side of any contract, so that the failure we're testing
    // is in the contractHost's checking
  };

  const alice = def({
    payBobWell: function(bobP) {
      const paymentP = Vow.resolve(myMoneyPurse).e.makeEmptyPurse();
      const ackP = paymentP.e.deposit(10, myPurse);
      return ackP.then(
        function(_) { return bobP.e.buy('shoe', paymentP); });
    },
    payBobBadly1: function(bobP) {
      const payment = def({ deposit: function(amount, src) {} });
      return bobP.e.buy('shoe', payment);
    },
    payBobBadly2: function(bobP) {
      const paymentP = Vow.resolve(myMoneyPurse).e.makeEmptyPurse();
      const ackP = paymentP.e.deposit(5, myPurse);
      return ackP.then(
        function(_) { return bobP.e.buy('shoe', paymentP); });
    },


    tradeWell: function(bobP) {
      const tokensP = Vow.resolve(contractHostP).e.setup(escrowSrc);
      const aliceTokenP = tokensP.then(tokens => tokens[0]);
      const bobTokenP   = tokensP.then(tokens => tokens[1]);
      Vow.resolve(bobP).e.invite(bobTokenP,   escrowSrc, 1);
      return Vow.resolve(alice).e.invite(aliceTokenP, escrowSrc, 0);
    },

    invite: function(tokenP, allegedSrc, allegedSide) {
      check(allegedSrc, allegedSide);

      let cancel;
      const a = def({
        moneySrcP: Vow.resolve(myMoneyPurse).e.makeEmptyPurse('aliceMoneySrc'),
        stockDstP: Vow.resolve(myStockPurse).e.makeEmptyPurse('aliceStockDst'),
        stockNeeded: 7,
        cancellationP: f.makeVow(function(r) { cancel = r; })
      });
      const ackP = a.moneySrcP.e.deposit(10, myMoneyPurse);

      const doneP = ackP.then(
        function(_) {
          return Vow.resolve(contractHostP).e.play(tokenP, allegedSrc, allegedSide, a);
        });
      return doneP.then(function(_) {
        return a.stockDstP.e.getBalance();
      });
    }
  });
  return alice;
}


export const aliceMaker = {
  makeAlice
};
