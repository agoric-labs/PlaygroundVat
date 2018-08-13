// Copyright (C) 2012 Google Inc.
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
define('contract/makeContractHost', ['Q'], function(Q) {
  "use strict";
  var def = cajaVM.def;
  var confine = cajaVM.confine;

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
   * <p>The {@code setup} method returns an array of tokens, one per
   * argument, where each token represents the exclusive right to
   * provide that argument. The initiator would then distribute these
   * tokens to each of the players, together with the alleged source
   * for the game they would be playing, and their alleged side, i.e.,
   * which argument position they are responsible for providing.
   *
   * <pre>
   *   // Contract initiator
   *   var tokensP = Q(contractHostP).send('setup', chessSrc);
   *   var whiteTokenP = Q(tokensP).get(0);
   *   var blackTokenP = Q(tokensP).get(1);
   *   Q(whitePlayer).send('invite', whiteTokenP, chessSrc, 0);
   *   Q(blackPlayer).send('invite', blackTokenP, chessSrc, 1);
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
   *     var outcomeP = Q(contractHostP).send(
   *         'play', tokenP, allegedChessSrc, allegedSide, arg);
   *   }
   * </pre>
   */
  var makeContractHost = function() {
    var m = new WeakMap();

    return def({
      setup: function(contractSrc) {
        contractSrc = ''+contractSrc;
        var tokens = [];
        var argPs = [];
        var resolve;
        var resultP = Q.promise(function(r) { resolve = r; });
        var contract = confine(contractSrc, {Q: Q});

        var addParam = function(i, token) {
          tokens[i] = token;
          var resolveArg;
          argPs[i] = Q.promise(function(r) { resolveArg = r; });
          m.set(token, function(allegedSrc, allegedI, arg) {
            if (contractSrc !== allegedSrc) {
              throw new Error('unexpected contract: '+contractSrc);
            }
            if (i !== allegedI) {
              throw new Error('unexpected side: '+i);
            }
            m.delete(token);
            resolveArg(arg);
            return resultP;
          });
        };
        for (var i = 0; i < contract.length; i++) {
          addParam(i, def({}));
        }
        resolve(Q.all(argPs).then(
          function(args) { return contract.apply(undefined, args); }));
        return tokens;
      },
      play: function(tokenP, allegedSrc, allegedI, arg) { return Q(tokenP).then(
        function(token) { return m.get(token)(allegedSrc, allegedI, arg); }); }
    });
  };

  return makeContractHost;
});
