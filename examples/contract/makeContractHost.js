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

  const joinAll = def((xs, ys) => {
    if (xs.length !== ys.length) {
      throw new RangeError(`different lengths: ${xs} vs ${ys}`);
    }
    return xs.map((x, i) => Vow.join(x, ys[i]));
  });   

  // joinCommon is given a list of promises for common argument lists,
  // one per player. It immediately returns a promise for the common
  // argument list they all agree on, to be provided to contract maker
  // to create the contract. Because this needs to be provided by each
  // player, it should only contain authority that all players may have.

  // To agree, the common argument list provided by all the players
  // must have the same length. For each common argument, We test that
  // they agree using Vow.join.
  const joinCommon = def(commonPs => (
    Vow.all(commonPs).then(allegedlyCommon => {
      if (allegedlyCommon.length === 0) { return []; }
      return Vow.all(allegedlyCommon.reduce(joinAll));
    })));
  
  const m = new WeakMap();

  return def({
    setup(contractMakerSrc, numPlayers) {
      contractMakerSrc = `${contractMakerSrc}`;
      numPlayers = Nat(numPlayers);
      const tokens = [];
      const commonPs = [];
      const argPs = [];
      let resolve;
      const f = new Flow();
      const resultP = f.makeVow(r => resolve = r);
      const makeContract = SES.confineExpr(contractMakerSrc, {Flow, Vow, log});

      const addParam = (i, token) => {
        tokens[i] = token;
        let resolveCommon;
        commonPs[i] = f.makeVow(r => resolveCommon = r);
        let resolveArg;
        argPs[i] = f.makeVow(r => resolveArg = r);

        m.set(token, (allegedSrc, allegedCommon, allegedI, arg) => {
          if (contractMakerSrc !== allegedSrc) {
            throw new Error(`unexpected contract maker: ${contractMakerSrc}`);
          }
          if (i !== allegedI) {
            throw new Error(`unexpected side: ${i}`);
          }
          m.delete(token);
          resolveCommon(allegedCommon);
          resolveArg(arg);
          return resultP;
        });
      };
      for (let i = 0; i < numPlayers; i++) {
        addParam(i, def({}));
      }
      joinCommon(commonPs).then(common => {
        const contract = makeContract(...common);
        Vow.all(argPs).then(args => resolve(contract(...args)));
      });
      return tokens;
    },
    play(tokenP, allegedSrc, allegedCommon, allegedI, arg) {
      return Vow.resolve(tokenP).then(
        token => m.get(token)(allegedSrc, allegedCommon, allegedI, arg));
    }
  });
});
