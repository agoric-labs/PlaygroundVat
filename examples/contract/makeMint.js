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

let counter = 0;
function makeMint() {
  const m = new WeakMap();
  const maker = def({
    makeEmptyPurse(name) { return mint(0, name); }
  });

  const mint = function(balance, name) {
    const purse = def({
      getBalance: function() { return balance; },
      getPurseMaker() { return maker; },
      makeEmptyPurse(name) { return maker.makeEmptyPurse(name); },
      deposit: function(amount, srcP) {
        counter += 1;
        const c = counter;
        //log(`deposit[${name}]#${c}: bal=${balance} amt=${amount}`);
        return Vow.resolve(srcP).then(src => {
          //log(` dep[${name}]#${c} (post-P): bal=${balance} amt=${amount}`);
          Nat(balance + amount);
          m.get(src)(Nat(amount), c);
          balance += amount;
        });
      }
    });
    const decr = function(amount, c) {
      //log(`-decr[${name}]#${c}: bal=${balance} amt=${amount}`);
      balance = Nat(balance - amount);
    };
    m.set(purse, decr);
    return purse;
  };
  return def({ mint });
}

export const mintMaker = {
  makeMint
};
