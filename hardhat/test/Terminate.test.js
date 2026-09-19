// Exercises terminate(): the owner closes the vault, gets paid everything that
// remains, and every path that used to move money is then frozen for good.
// A closed vault keeps its audit trail — it is still proof of what the agent
// did, just no longer a live budget.
//
//   npx hardhat test test/Terminate.test.js

import { expect } from "chai";
import { ethers as ethersAsync } from "./setup.js";

describe("AgentVault termination", function () {
  let owner, agent, merchant;
  let vault;

  before(async function () {
    const e = await ethersAsync();
    [owner, agent, merchant] = await e.getSigners();
    const Vault = await e.getContractFactory("AgentVault");
    vault = await Vault.deploy(agent.address, "ARC-1");
    await vault.waitForDeployment();
  });

  it("pays the owner out and marks the vault terminated", async function () {
    const e = await ethersAsync();
    const ONE = e.parseEther("1");

    await vault.fund({ value: ONE / 20n });
    await vault.setPolicy(ONE / 200n, ONE / 20n, false);
    // The agent spends once, so the closed vault still has a history.
    await vault
      .connect(agent)
      .spend(merchant.address, ONE / 500n, "research");

    const before = await e.provider.getBalance(owner.address);

    const tx = await vault.terminate();
    const receipt = await tx.wait();
    const gas = receipt.gasUsed * receipt.gasPrice;

    // 0.05 funded - 0.002 spent = 0.048 returned to the owner.
    const paid = (await e.provider.getBalance(owner.address)) - before;
    expect(paid + gas).to.equal((ONE * 48n) / 1000n);

    expect(await vault.terminated()).to.equal(true);
    expect(await vault.terminatedAt()).to.be.gt(0n);
    expect(await e.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });

  it("freezes every path that used to move money", async function () {
    const e = await ethersAsync();
    const ONE = e.parseEther("1");

    await expect(
      vault.connect(agent).spend(merchant.address, ONE / 1000n, "after"),
    ).to.be.revertedWithCustomError(vault, "VaultTerminated");

    // Not even a top-up: a terminated vault would trap the funds.
    await expect(
      vault.fund({ value: ONE / 100n }),
    ).to.be.revertedWithCustomError(vault, "VaultTerminated");

    // A bare transfer hits receive(), which now refuses the money rather than
    // trapping it in a vault nobody can spend from.
    let trapped = false;
    try {
      await owner.sendTransaction({
        to: await vault.getAddress(),
        value: ONE / 100n,
      });
      trapped = true;
    } catch {
      /* expected: the vault refuses the deposit */
    }
    expect(trapped).to.equal(false);
  });

  it("keeps the audit trail readable", async function () {
    const e = await ethersAsync();
    const ONE = e.parseEther("1");
    expect(await vault.totalSpent()).to.equal(ONE / 500n);
    expect(await vault.spendCount()).to.equal(1n);
  });

  it("is one-way, and only the owner can do it", async function () {
    await expect(vault.terminate()).to.be.revertedWithCustomError(
      vault,
      "VaultTerminated",
    );
    await expect(vault.connect(agent).terminate()).to.be.revertedWithCustomError(
      vault,
      "OnlyOwner",
    );
  });
});
