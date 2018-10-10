/*global Vow def*/
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

async function mintTest() {
  const mP = Vow.resolve(mintMaker).e.makeMint();
  const alicePurseP = mP.e.mint(1000, 'alice');
  const mIssuerP = alicePurseP.e.getIssuer();
  const depositPurseP = mIssuerP.e.makeEmptyPurse('deposit');
  const v = depositPurseP.e.deposit(50, alicePurseP.fork()); // hack
  // this ordering should be guaranteed by the fact that this is all in the
  // same Flow
  const aBal = v.then(_ => alicePurseP.e.getBalance());
  const dBal = v.then(_ => depositPurseP.e.getBalance());
  return Vow.all([aBal, dBal]);
}

export function trivialContractTest() {
  const contractHostP = Vow.fromFn(makeContractHost);

  const trivContract = ({five, two}, registrar) => {
    const wSide = def({
      play(one) {
        return one => five + two + one;
      }
    });
    registrar.register('w', wSide);
    registrar.register('b', def({play(_){}}));
  };
  
  const contractSrc = `${trivContract}`;

  const tokensP = contractHostP.e.setup(
    contractSrc, {players: ['w', 'b'], five:5, two:2});

  const whiteTokenP = tokensP.e.get('w');
  const whiteSideP = contractHostP.e.redeem(whiteTokenP);
  const eightP = whiteSideP.e.play(1);

  const blackTokenP = tokensP.e.get('b');
  const blackSideP = contractHostP.e.redeem(blackTokenP);
  const blackOutcomeP = blackSideP.e.play({});

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

export default function(argv) {
  return { mintTest, trivialContractTest,
           betterContractTestAliceFirst,
           betterContractTestBobFirst,
         };
}
