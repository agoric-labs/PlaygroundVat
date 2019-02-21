import {
  trivialContractTest,
  betterContractTestAliceFirst,
  betterContractTestBobFirst,
} from './contractTest';

export default function(_argv) {
  return {
    trivialContractTest,
    betterContractTestAliceFirst,
    betterContractTestBobFirst,
  };
}
