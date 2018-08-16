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
import { mintMaker } from './makeMint';
import { aliceMaker } from './makeAlice';
import { bobMaker } from './makeBob';

export async function mintTest() {
  const mP = Vow.resolve(mintMaker).e.makeMint();
  const alicePurseP = mP.e.mint(1000, 'alice');
  const depositPurseP = alicePurseP.e.makeEmptyPurse('deposit');
  const v = depositPurseP.e.deposit(50, alicePurseP.fork()); // hack
  // this ordering should be guaranteed by the fact that this is all in the
  // same Flow
  const aBal = v.then(() => alicePurseP.e.getBalance());
  const dBal = v.then(() => depositPurseP.e.getBalance());
  return Vow.all([aBal, dBal]);
}

export function trivialContractTest() {
  const contractHostP = Vow.fromFn(makeContractHost);

  function trivContract(whiteP, blackP) {
    return 8;
  }
  const contractSrc = `${trivContract}`;

  const tokensP = Vow.resolve(contractHostP).e.setup(contractSrc);

  const whiteTokenP = tokensP.then(tokens => tokens[0]);
  contractHostP.e.play(whiteTokenP, contractSrc, 0, {});

  const blackTokenP = tokensP.then(tokens => tokens[1]);
  const eightP = contractHostP.e.play(blackTokenP, contractSrc, 1, {});
  // check that eightP fulfills with 8.
  // (At the time of this writing, did the right thing under debugger)
  return eightP;
}

export function betterContractTestAliceFirst() {
  const contractHostP = Vow.fromFn(makeContractHost);
  const moneyMintP = Vow.resolve(mintMaker).e.makeMint();
  const aliceMoneyPurseP = moneyMintP.e.mint(1000);
  const bobMoneyPurseP = moneyMintP.e.mint(1001);

  const stockMintP = Vow.resolve(mintMaker).e.makeMint();
  const aliceStockPurseP = stockMintP.e.mint(2002);
  const bobStockPurseP = stockMintP.e.mint(2003);

  const aliceP = Vow.resolve(aliceMaker).
        e.makeAlice(aliceMoneyPurseP, aliceStockPurseP, contractHostP);
  const bobP = Vow.resolve(bobMaker).
        e.makeBob(bobMoneyPurseP, bobStockPurseP, contractHostP);

  const ifItFitsP = aliceP.e.payBobWell(bobP);
  return ifItFitsP;
}

export function betterContractTestBobFirst(bobLies=false) {
  const contractHostP = Vow.fromFn(makeContractHost);
  const moneyMintP = Vow.resolve(mintMaker).e.makeMint();
  const aliceMoneyPurseP = moneyMintP.e.mint(1000, 'aliceMainMoney');
  const bobMoneyPurseP = moneyMintP.e.mint(1001, 'bobMainMoney');

  const stockMintP = Vow.resolve(mintMaker).e.makeMint();
  const aliceStockPurseP = stockMintP.e.mint(2002, 'aliceMainStock');
  const bobStockPurseP = stockMintP.e.mint(2003, 'bobMainStock');

  const aliceP = Vow.resolve(aliceMaker).
        e.makeAlice(aliceMoneyPurseP, aliceStockPurseP, contractHostP);
  const bobP = Vow.resolve(bobMaker).
        e.makeBob(bobMoneyPurseP, bobStockPurseP, contractHostP);

  return bobP.e.tradeWell(aliceP, bobLies);
//  return aliceP.e.tradeWell(bobP);
}
