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


define('contract/makeAlice', ['Q', 'contract/escrowExchange'],
       function(Q, escrowExchange) {
  "use strict";
  var def = cajaVM.def;

  var makeAlice = function(myMoneyPurse, myStockPurse, contractHostP) {
    var escrowSrc = ''+escrowExchange;
    var myPurse = myMoneyPurse;

    var check = function(allegedSrc, allegedSide) {
      // for testing purposes, alice and bob are willing to play
      // any side of any contract, so that the failure we're testing
      // is in the contractHost's checking
    };

    var alice = def({
      payBobWell: function(bobP) {
        var paymentP = Q(myMoneyPurse).send('makePurse');
        var ackP = Q(paymentP).send('deposit', 10, myPurse);
        return ackP.then(
          function(_) { return bobP.send('buy', 'shoe', paymentP); });
      },
      payBobBadly1: function(bobP) {
        var payment = def({ deposit: function(amount, src) {} });
        return bobP.send('buy', 'shoe', payment);
      },
      payBobBadly2: function(bobP) {
        var paymentP = Q(myMoneyPurse).send('makePurse');
        var ackP = Q(paymentP).send('deposit', 5, myPurse);
        return ackP.then(
          function(_) { return bobP.send('buy', 'shoe', paymentP); });
      },


      tradeWell: function(bobP) {
        var tokensP = Q(contractHostP).send('setup', escrowSrc);
        var aliceTokenP = Q(tokensP).get(0);
        var bobTokenP   = Q(tokensP).get(1);
               Q(bobP ).send('invite', bobTokenP,   escrowSrc, 1);
        return Q(alice).send('invite', aliceTokenP, escrowSrc, 0);
      },

      invite: function(tokenP, allegedSrc, allegedSide) {
        check(allegedSrc, allegedSide);

        var cancel;
        var a = Q.passByCopy({
          moneySrcP: Q(myMoneyPurse).send('makePurse'),
          stockDstP: Q(myStockPurse).send('makePurse'),
          stockNeeded: 7,
          cancellationP: Q.promise(function(r) { cancel = r; })
        });
        var ackP = Q(a.moneySrcP).send('deposit', 10, myMoneyPurse);

        var decisionP = Q(ackP).then(
          function(_) {
            return Q(contractHostP).send(
              'play', tokenP, allegedSrc, allegedSide, a);
          });
        return Q(decisionP).then(function(_) {
          return Q.delay(3000);
        }).then(function(_) {
          return Q(a.stockDstP).send('getBalance');
        });
      }
    });
    return alice;
  };
  return makeAlice;
});
