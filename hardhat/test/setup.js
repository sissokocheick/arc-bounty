// Hardhat 3 exposes ethers via a network connection, not on the bare HRE.
// `ethers()` returns the lazily-initialized instance; `ethersObj` is the same
// object, for matchers that take it as an argument.
import hre from "hardhat";

let _ethers;

export async function ethers() {
  if (_ethers === undefined) {
    const connection = await hre.network.getOrCreate();
    _ethers = connection.ethers;
  }
  return _ethers;
}

export { _ethers as ethersObj };
