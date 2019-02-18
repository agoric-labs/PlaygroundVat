/* global Vow */
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
  console.log('starting mintTest');
  const mP = Vow.resolve(mint).e.makeMint();
  const alicePurseP = mP.e.mint(1000, 'alice');
  const mIssuerP = alicePurseP.e.getIssuer();
  const depositPurseP = mIssuerP.e.makeEmptyPurse('deposit');
  const v = depositPurseP.e.deposit(50, alicePurseP.fork()); // hack
  // this ordering should be guaranteed by the fact that this is all in the
  // same Flow
  const aBal = v.then(_ => alicePurseP.e.getBalance());
  const dBal = v.then(_ => depositPurseP.e.getBalance());
  Vow.all([aBal, dBal]).then(bals => {
    console.log('++ balances:', bals);
    console.log('++ DONE');
  });
}

function trivialContractTest(host) {
  console.log('starting trivialContractTest');
  const contractHostP = Vow.resolve(host);

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
  eightP.then(res => {
    console.log('++ eightP resolved to', res, '(should be 8)');
    if (res !== 8) {
      throw new Error(`eightP resolved to ${res}, not 8`);
    }
    console.log('++ DONE');
  });
  return eightP;
}

export function betterContractTestAliceFirst(mint, host, alice, bob) {
  const contractHostP = Vow.resolve(host);
  const moneyMintP = Vow.resolve(mint).e.makeMint();
  const aliceMoneyPurseP = moneyMintP.e.mint(1000);
  const bobMoneyPurseP = moneyMintP.e.mint(1001);

  const stockMintP = Vow.resolve(mint).e.makeMint();
  const aliceStockPurseP = stockMintP.e.mint(2002);
  const bobStockPurseP = stockMintP.e.mint(2003);

  const aliceP = Vow.resolve(alice).e.init(aliceMoneyPurseP, aliceStockPurseP);
  const bobP = Vow.resolve(bob).e.init(bobMoneyPurseP, bobStockPurseP);

  const ifItFitsP = aliceP.e.payBobWell();
  ifItFitsP.then(
    res => {
      console.log('++ ifItFitsP done:', res);
      console.log('++ DONE');
    },
    rej => console.log('++ ifItFitsP failed', rej),
  );
  return ifItFitsP;
}

export function betterContractTestBobFirst(
  mint,
  host,
  alice,
  bob,
  bobLies = false,
) {
  const contractHostP = Vow.resolve(host);
  const moneyMintP = Vow.resolve(mint).e.makeMint();
  const aliceMoneyPurseP = moneyMintP.e.mint(1000, 'aliceMainMoney');
  const bobMoneyPurseP = moneyMintP.e.mint(1001, 'bobMainMoney');

  const stockMintP = Vow.resolve(mint).e.makeMint();
  const aliceStockPurseP = stockMintP.e.mint(2002, 'aliceMainStock');
  const bobStockPurseP = stockMintP.e.mint(2003, 'bobMainStock');

  const aliceP = Vow.resolve(alice).e.init(aliceMoneyPurseP, aliceStockPurseP);
  const bobP = Vow.resolve(bob).e.init(bobMoneyPurseP, bobStockPurseP);

  bobP.e.tradeWell(bobLies).then(
    res => {
      console.log('++ bobP.e.tradeWell done:', res);
      console.log('++ DONE');
    },
    rej => {
      console.log('++ bobP.e.tradeWell error:', rej);
    },
  );
  //  return aliceP.e.tradeWell(bobP);
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
    betterContractTestBobFirst(
      argv.mint,
      argv.host,
      argv.alice,
      argv.bob,
      true,
    );
  }

  return undefined;
}
