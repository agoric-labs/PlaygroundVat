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

export function escrowExchange(a, b) {
  // a from Alice, b from Bob
  let decide;
  const decisionP = Q.promise(function(resolve) {
    decide = resolve;
  });

  const transfer = function(srcPurseP, dstPurseP, amount) {
    const makeEscrowPurseP = Q.join(
      Q(srcPurseP).invoke('getMakePurse'),
      Q(dstPurseP).invoke('getMakePurse'),
    );
    const escrowPurseP = Q(makeEscrowPurseP).fcall();

    Q(decisionP).then(
      // setup phase 2
      function(_) {
        Q(dstPurseP).invoke('deposit', amount, escrowPurseP);
      },
      function(_) {
        Q(srcPurseP).invoke('deposit', amount, escrowPurseP);
      },
    );

    return Q(escrowPurseP).invoke('deposit', amount, srcPurseP); // phase 1
  };

  const failOnly = function(cancellationP) {
    return Q(cancellationP).then(function(cancellation) {
      throw cancellation;
    });
  };

  decide(
    Q.race([
      Q.all([
        transfer(a.moneySrcP, b.moneyDstP, b.moneyNeeded),
        transfer(b.stockSrcP, a.stockDstP, a.stockNeeded),
      ]),
      failOnly(a.cancellationP),
      failOnly(b.cancellationP),
    ]),
  );
  return decisionP;
}
