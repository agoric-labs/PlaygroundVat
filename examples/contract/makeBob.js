// Copyright (C) 2013 Google Inc.
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


define('contract/makeBob', ['Q', 'contract/escrowExchange'],
       function(Q, escrowExchange) {
  "use strict";
  var def = cajaVM.def;

  var makeBob = function(myMoneyPurse, myStockPurse, contractHostP) {
    var escrowSrc = ''+escrowExchange;
    var myPurse = myMoneyPurse;

    var check = function(allegedSrc, allegedSide) {
      // for testing purposes, alice and bob are willing to play
      // any side of any contract, so that the failure we're testing
      // is in the contractHost's checking
    };

    var bob = def({
      /**
       * This is not an imperative to Bob to buy something but rather
       * the opposite. It is a request by a client to buy something from
       * Bob, and therefore a request that Bob sell something. OO naming
       * is a bit confusing here.
       */
      buy: function(desc, paymentP) {
        var amount;
        var good;
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

        return (myPurse.send('deposit', 10, paymentP)).then(
          function(_) { return good; });
      },


      tradeWell: function(aliceP) {
        var tokensP = Q(contractHostP).send('setup', escrowSrc);
        var aliceTokenP = Q(tokensP).get(0);
        var bobTokenP   = Q(tokensP).get(1);
               Q(aliceP).send('invite', aliceTokenP, escrowSrc, 0);
        return Q(bob   ).send('invite', bobTokenP,   escrowSrc, 1);
      },

      /**
       * As with 'buy', the naming is awkward. A client is inviting
       * this object, asking it to join in a contract instance. It is not
       * requesting that this object invite anything.
       */
      invite: function(tokenP, allegedSrc, allegedSide) {
        check(allegedSrc, allegedSide);
        var cancel;
        var b = Q.passByCopy({
          stockSrcP: Q(myStockPurse).send('makePurse'),
          moneyDstP: Q(myMoneyPurse).send('makePurse'),
          moneyNeeded: 10,
          cancellationP: Q.promise(function(r) { cancel = r; })
        });
        var ackP = Q(b.stockSrcP).send('deposit', 7, myStockPurse);

        var decisionP = Q(ackP).then(
          function(_) {
            return Q(contractHostP).send(
              'play', tokenP, allegedSrc, allegedSide, b);
          });
        return Q(decisionP).then(function(_) {
          return Q.delay(3000);
        }).then(function(_) {
          return Q(b.moneyDstP).send('getBalance');
        });
      }
    });
    return bob;
  };
  return makeBob;
});
