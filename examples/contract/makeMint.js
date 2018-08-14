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


export function makeMint() {
  const m = new WeakMap();
  const makePurse = function() { return mint(0); };

  const mint = function(balance) {
    const purse = def({
      getBalance: function() { return balance; },
      makePurse: makePurse,
      getMakePurse() { return makePurse; },
      deposit: function(amount, srcP) {
        return Q(srcP).then(function(src) {
          Nat(balance + amount);
          m.get(src)(Nat(amount));
          balance += amount;
        }); }
    });
    const decr = function(amount) { balance = Nat(balance - amount); };
    m.set(purse, decr);
    return purse;
  };
  return def(mint);
}

