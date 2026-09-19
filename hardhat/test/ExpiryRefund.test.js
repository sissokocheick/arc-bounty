// The audit found a trapped escrow: a task whose deadline passes while work
// sits under review could never be refunded. cancelTask used to revert
// AlreadySubmitted unconditionally. Now the deadline is what decides — inside
// the window the submission still binds, past it the creator reclaims.
//
//   npx hardhat test test/ExpiryRefund.test.js

import { expect } from "chai";
import { ethers as ethersAsync } from "./setup.js";

describe("TaskBoard expiry refund", function () {
  let owner, worker;
  let board;

  const DAY = 86400n;
  const ONE = 1_000_000_000_000_000_000n;

  before(async function () {
    const e = await ethersAsync();
    [owner, worker] = await e.getSigners();
    const Board = await e.getContractFactory("TaskBoard");
    board = await Board.deploy(e.ZeroAddress);
    await board.waitForDeployment();
  });

  it("still locks the escrow while the window is open", async function () {
    const e = await ethersAsync();
    // Other suites advance the shared chain clock and leave it in the future,
    // so the host's Date.now() cannot be trusted here — ask the chain instead.
    const now = (await e.provider.getBlock("latest")).timestamp;
    const reward = ONE / 200n;
    await board.connect(owner).postTask("live task", "desc", BigInt(now) + DAY, {
      value: reward,
    });
    await board
      .connect(worker)
      .submitWork(0, "https://proof.example");
    // Under review, inside the window: no refund.
    await expect(
      board.connect(owner).cancelTask(0),
    ).to.be.revertedWithCustomError(board, "AlreadySubmitted");
  });

  it("lets the creator reclaim once the deadline has passed", async function () {
    const e = await ethersAsync();
    await e.provider.send("evm_increaseTime", [Number(2n * DAY)]);
    await e.provider.send("evm_mine", []);

    const before = await e.provider.getBalance(owner.address);
    const tx = await board.connect(owner).cancelTask(0);
    const receipt = await tx.wait();
    const gas = receipt.gasUsed * receipt.gasPrice;

    const gained = (await e.provider.getBalance(owner.address)) - before;
    expect(gained + gas).to.equal(ONE / 200n);

    const t = await board.getTask(0);
    expect(t.cancelled).to.equal(true);
    expect(t.completed).to.equal(false);
  });

  it("pays out normally if the creator approves late instead", async function () {
    const e = await ethersAsync();
    // Time only moves forward here (as on Arc), so compute the deadline from
    // the chain's own clock rather than the host's.
    const blk = await e.provider.getBlock("latest");
    const now = blk.timestamp;
    const reward = ONE / 200n;
    await board.connect(owner).postTask("late task", "desc", BigInt(now) + DAY, {
      value: reward,
    });
    await board
      .connect(worker)
      .submitWork(1, "https://proof.example");
    await e.provider.send("evm_increaseTime", [Number(3n * DAY)]);
    await e.provider.send("evm_mine", []);

    const before = await e.provider.getBalance(worker.address);
    await board.connect(owner).approveWork(1);
    const gained = (await e.provider.getBalance(worker.address)) - before;
    expect(gained).to.equal(reward);
  });
});
