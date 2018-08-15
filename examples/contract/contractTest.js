// Copyright (C) 2011 Google Inc.
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
 * @fileoverview Test simple contract code
 * @requires define
 */

import { makeContractHost } from './makeContractHost';
import { makeMint } from './makeMint';
import { makeAlice } from './makeAlice';
import { makeBob } from './makeBob';

export function trivialContractTest() {
  const contractHostP = Q(makeContractHost).fcall();

  function trivContract(whiteP, blackP) {
    return 8;
  }
  const contractSrc = `${trivContract}`;

  const tokensP = Q(contractHostP).invoke('setup', contractSrc);

  const whiteTokenP = Q(tokensP).get(0);
  Q(contractHostP).invoke('play', whiteTokenP, contractSrc, 0, {});

  const blackTokenP = Q(tokensP).get(1);
  const eightP = Q(contractHostP).invoke('play', blackTokenP, contractSrc, 1, {});
  // check that eightP fulfills with 8.
  // (At the time of this writing, did the right thing under debugger)
  return eightP;
}

export function betterContractTestAliceFirst() {
  const contractHostP = Q(makeContractHost).fcall();
  const moneyMintP = Q(makeMint).fcall();
  const aliceMoneyPurseP = Q(moneyMintP).fcall(1000);
  const bobMoneyPurseP = Q(moneyMintP).fcall(1001);

  const stockMintP = Q(makeMint).fcall();
  const aliceStockPurseP = Q(stockMintP).fcall(2002);
  const bobStockPurseP = Q(stockMintP).fcall(2003);

  const aliceP = Q(makeAlice).fcall(aliceMoneyPurseP, aliceStockPurseP,
                                  contractHostP);
  const bobP = Q(makeBob).fcall(bobMoneyPurseP, bobStockPurseP,
                              contractHostP);

  const ifItFitsP = Q(aliceP).invoke('payBobWell', bobP);
  return ifItFitsP;
}

export function betterContractTestBobFirst(bobLies=false) {
  const contractHostP = Q(makeContractHost).fcall();
  const moneyMintP = Q(makeMint).fcall();
  const aliceMoneyPurseP = Q(moneyMintP).fcall(1000);
  const bobMoneyPurseP = Q(moneyMintP).fcall(1001);

  const stockMintP = Q(makeMint).fcall();
  const aliceStockPurseP = Q(stockMintP).fcall(2002);
  const bobStockPurseP = Q(stockMintP).fcall(2003);

  const aliceP = Q(makeAlice).fcall(aliceMoneyPurseP, aliceStockPurseP,
                                  contractHostP);
  const bobP = Q(makeBob).fcall(bobMoneyPurseP, bobStockPurseP,
                              contractHostP);

  return Q(bobP).invoke('tradeWell', aliceP, bobLies);
//  return Q(aliceP).invoke('tradeWell', bobP);
}
