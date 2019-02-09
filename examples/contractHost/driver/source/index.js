/*global Vow*/
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

function mintTest(mint) {
  log('starting mintTest');
  const mP = E(mint).makeMint();
  const alicePurseP = E(mP).mint(1000, 'alice');
  const mIssuerP = E(alicePurseP).getIssuer();
  const depositPurseP = E(mIssuerP).makeEmptyPurse('deposit');
  const v = E(depositPurseP).deposit(50, alicePurseP.fork()); // hack
  // this ordering should be guaranteed by the fact that this is all in the
  // same Flow
  const aBal = v.then(_ => E(alicePurseP).getBalance());
  const dBal = v.then(_ => E(depositPurseP).getBalance());
  Vow.all([aBal, dBal]).then(bals => {
    log('++ balances:', bals);
    log('++ DONE');
  });
}

function trivialContractTest(host) {
  log('starting trivialContractTest');
  const contractHostP = Vow.resolve(host);

  function trivContract(whiteP, blackP) {
    return 8;
  }
  const contractSrc = `${trivContract}`;

  const tokensP = E(contractHostP).setup(contractSrc);

  const whiteTokenP = tokensP.then(tokens => tokens[0]);
  E(contractHostP).play(whiteTokenP, contractSrc, 0, {});

  const blackTokenP = tokensP.then(tokens => tokens[1]);
  const eightP = E(contractHostP).play(blackTokenP, contractSrc, 1, {});
  // check that eightP fulfills with 8.
  // (At the time of this writing, did the right thing under debugger)
  eightP.then(res => {
    log('++ eightP resolved to', res, '(should be 8)');
    if (res !== 8) {
      throw new Error(`eightP resolved to ${res}, not 8`);
    };
    log('++ DONE');
  });
  return eightP;
}

export function betterContractTestAliceFirst(mint, host, alice, bob) {
  const contractHostP = Vow.resolve(host);
  const moneyMintP = E(mint).makeMint();
  const aliceMoneyPurseP = E(moneyMintP).mint(1000);
  const bobMoneyPurseP = E(moneyMintP).mint(1001);

  const stockMintP = E(mint).makeMint();
  const aliceStockPurseP = E(stockMintP).mint(2002);
  const bobStockPurseP = E(stockMintP).mint(2003);

  const aliceP = E(alice).init(aliceMoneyPurseP, aliceStockPurseP);
  const bobP = E(bob).init(bobMoneyPurseP, bobStockPurseP);

  const ifItFitsP = E(aliceP).payBobWell();
  ifItFitsP.then(res => {
    log('++ ifItFitsP done:', res);
    log('++ DONE');
  },
                 rej => log('++ ifItFitsP failed', rej));
  return ifItFitsP;
}

export function betterContractTestBobFirst(mint, host, alice, bob, bobLies=false) {
  const contractHostP = Vow.resolve(host);
  const moneyMintP = E(mint).makeMint();
  const aliceMoneyPurseP = E(moneyMintP).mint(1000, 'aliceMainMoney');
  const bobMoneyPurseP = E(moneyMintP).mint(1001, 'bobMainMoney');

  const stockMintP = E(mint).makeMint();
  const aliceStockPurseP = E(stockMintP).mint(2002, 'aliceMainStock');
  const bobStockPurseP = E(stockMintP).mint(2003, 'bobMainStock');

  const aliceP = E(alice).init(aliceMoneyPurseP, aliceStockPurseP);
  const bobP = E(bob).init(bobMoneyPurseP, bobStockPurseP);

  E(bobP).tradeWell(bobLies).then(
    res => {
      log('++ E(bobP).tradeWell done:', res);
      log('++ DONE');
    },
    rej => {
      log('++ E(bobP).tradeWell error:', rej);
    });
  //  return E(aliceP).tradeWell(bobP);
}

export default function(argv) {
  if (argv.which === 'mint') {
    mintTest(argv.mint);
  } else if (argv.which === 'trivial') {
    trivialContractTest(argv.host, argv.trivContractSrc);
  } else if (argv.which === 'alice-first') {
    betterContractTestAliceFirst(argv.mint, argv.host, argv.alice, argv.bob);
  } else if (argv.which === 'bob-first') {
    betterContractTestBobFirst(argv.mint, argv.host, argv.alice, argv.bob);
  } else if (argv.which === 'bob-first-lies') {
    betterContractTestBobFirst(argv.mint, argv.host, argv.alice, argv.bob, true);
  }

  return undefined;
}
