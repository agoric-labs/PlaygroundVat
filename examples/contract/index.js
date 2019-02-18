import { makeContractHost } from './makeContractHost';
import { mintMaker } from './makeMint';
import { escrowExchange } from './escrow';
import {
  trivialContractTest,
  betterContractTestAliceFirst,
  betterContractTestBobFirst,
} from './contractTest';

export default function(argv) {
  return {
    trivialContractTest,
    betterContractTestAliceFirst,
    betterContractTestBobFirst,
  };
}
