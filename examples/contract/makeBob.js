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

import { escrowExchange } from './escrowExchange';

export function makeBob(myMoneyPurse, myStockPurse, contractHostP) {
  const escrowSrc = `${escrowExchange}`;
  const myPurse = myMoneyPurse;

  const check = function(allegedSrc, allegedSide) {
    // for testing purposes, alice and bob are willing to play
    // any side of any contract, so that the failure we're testing
    // is in the contractHost's checking
  };

  const bob = def({
    /**
     * This is not an imperative to Bob to buy something but rather
     * the opposite. It is a request by a client to buy something from
     * Bob, and therefore a request that Bob sell something. OO naming
     * is a bit confusing here.
     */
    buy: function(desc, paymentP) {
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

      return (myPurse.invoke('deposit', 10, paymentP)).then(
        function(_) { return good; });
    },

    tradeWell: function(aliceP, bobLies=false) {
      const tokensP = Q(contractHostP).invoke('setup', escrowSrc);
      const aliceTokenP = Q(tokensP).get(0);
      const bobTokenP   = Q(tokensP).get(1);
      let escrowSrcWeTellAlice = escrowSrc;
      if (bobLies) {
        escrowSrcWeTellAlice += 'NOT';
      }
      return Q.all([Q(aliceP).invoke('invite', aliceTokenP, escrowSrcWeTellAlice, 0),
                    Q(bob).invoke('invite', bobTokenP, escrowSrc, 1)]);
    },

    /**
     * As with 'buy', the naming is awkward. A client is inviting
     * this object, asking it to join in a contract instance. It is not
     * requesting that this object invite anything.
     */
    invite: function(tokenP, allegedSrc, allegedSide) {
      check(allegedSrc, allegedSide);
      let cancel;
      const b = Q.passByCopy({
        stockSrcP: Q(myStockPurse).invoke('makePurse'),
        moneyDstP: Q(myMoneyPurse).invoke('makePurse'),
        moneyNeeded: 10,
        cancellationP: Q.promise(function(r) { cancel = r; })
      });
      const ackP = Q(b.stockSrcP).invoke('deposit', 7, myStockPurse);

      const decisionP = Q(ackP).then(
        function(_) {
          return Q(contractHostP).invoke(
            'play', tokenP, allegedSrc, allegedSide, b);
        });
      return Q(decisionP).then(function(_) {
        return Q.delay(3000);
      }).then(function(_) {
        return Q(b.moneyDstP).invoke('getBalance');
      });
    }
  });
  return bob;
}
