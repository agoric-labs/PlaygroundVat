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

export function makeAlice(myMoneyPurse, myStockPurse, contractHostP) {
  const escrowSrc = `${escrowExchange}`;
  const myPurse = myMoneyPurse;

  const check = function(allegedSrc, allegedSide) {
    // for testing purposes, alice and bob are willing to play
    // any side of any contract, so that the failure we're testing
    // is in the contractHost's checking
  };

  const alice = def({
    payBobWell: function(bobP) {
      const paymentP = Q(myMoneyPurse).invoke('makePurse');
      const ackP = Q(paymentP).invoke('deposit', 10, myPurse);
      return ackP.then(
        function(_) { return bobP.invoke('buy', 'shoe', paymentP); });
    },
    payBobBadly1: function(bobP) {
      const payment = def({ deposit: function(amount, src) {} });
      return bobP.invoke('buy', 'shoe', payment);
    },
    payBobBadly2: function(bobP) {
      const paymentP = Q(myMoneyPurse).invoke('makePurse');
      const ackP = Q(paymentP).invoke('deposit', 5, myPurse);
      return ackP.then(
        function(_) { return bobP.invoke('buy', 'shoe', paymentP); });
    },


    tradeWell: function(bobP) {
      const tokensP = Q(contractHostP).invoke('setup', escrowSrc);
      const aliceTokenP = Q(tokensP).get(0);
      const bobTokenP   = Q(tokensP).get(1);
      Q(bobP ).invoke('invite', bobTokenP,   escrowSrc, 1);
      return Q(alice).invoke('invite', aliceTokenP, escrowSrc, 0);
    },

    invite: function(tokenP, allegedSrc, allegedSide) {
      check(allegedSrc, allegedSide);

      let cancel;
      const a = Q.passByCopy({
        moneySrcP: Q(myMoneyPurse).invoke('makePurse', 'aliceMoneySrc'),
        stockDstP: Q(myStockPurse).invoke('makePurse', 'aliceStockDst'),
        stockNeeded: 7,
        cancellationP: Q.promise(function(r) { cancel = r; })
      });
      const ackP = Q(a.moneySrcP).invoke('deposit', 10, myMoneyPurse);

      const decisionP = Q(ackP).then(
        function(_) {
          return Q(contractHostP).invoke(
            'play', tokenP, allegedSrc, allegedSide, a);
        });
      return Q(decisionP).then(function(_) {
        return Q.delay(3000);
      }).then(function(_) {
        return Q(a.stockDstP).invoke('getBalance');
      });
    }
  });
  return alice;
}
