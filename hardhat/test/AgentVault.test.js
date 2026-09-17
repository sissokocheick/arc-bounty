import { expect } from "chai";
import { ethers as ethersAsync } from "./setup.js";

describe("AgentVault", function () {
  let owner, agent, merchant, scammer;
  let vault;

  const DAY = 86400n;

  before(async function () {
    const e = await ethersAsync();
    [owner, agent, merchant, scammer] = await e.getSigners();
    const Vault = await e.getContractFactory("AgentVault");
    vault = await Vault.deploy(agent.address, "ARC-1");
    await vault.waitForDeployment();
  });

  async function roll(days) {
    const e = await ethersAsync();
    await e.provider.send("evm_increaseTime", [Number(days * DAY)]);
    await e.provider.send("evm_mine", []);
  }

  it("starts with sensible defaults and no spending power", async function () {
    const e = await ethersAsync();
    const ONE = e.parseEther("1");
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.agent()).to.equal(agent.address);
    expect(await vault.spendCount()).to.equal(0n);
    // No policy set yet: daily budget 0 => the agent cannot spend anything.
    await expect(
      vault.connect(agent).spend(merchant.address, ONE, "api call")
    ).to.be.revertedWithCustomError(vault, "ExceedsDailyBudget");
  });

  it("funds the vault in native USDC", async function () {
    const e = await ethersAsync();
    const tx = vault.connect(owner).fund({ value: e.parseEther("100") });
    await expect(tx).to.emit(vault, "Funded");
    await expect(tx).to.changeEtherBalance(e, vault, e.parseEther("100"));
  });

  it("enforces the per-spend cap", async function () {
    const e = await ethersAsync();
    await vault.connect(owner).setPolicy(e.parseEther("1"), e.parseEther("100"), false);
    await expect(
      vault.connect(agent).spend(merchant.address, e.parseEther("2"), "over cap")
    ).to.be.revertedWithCustomError(vault, "ExceedsPerSpendCap");
  });

  it("lets the agent spend within cap and logs a reason", async function () {
    const e = await ethersAsync();
    const ONE = e.parseEther("1");
    await expect(vault.connect(agent).spend(merchant.address, ONE, "news api"))
      .to.emit(vault, "Spent")
      .withArgs(0n, merchant.address, ONE, "news api");
    expect(await vault.totalSpent()).to.equal(ONE);
    expect(await vault.spentToday()).to.equal(ONE);
  });

  it("enforces the daily budget across multiple spends", async function () {
    const e = await ethersAsync();
    const ONE = e.parseEther("1");
    for (let i = 0; i < 3; i++) {
      await vault.connect(agent).spend(merchant.address, ONE, `call ${i}`);
    }
    expect(await vault.spentToday()).to.equal(e.parseEther("4"));
    expect(await vault.totalSpent()).to.equal(e.parseEther("4"));
  });

  it("resets the daily budget when the UTC day rolls over", async function () {
    const e = await ethersAsync();
    await roll(1n);
    await vault.connect(agent).spend(merchant.address, e.parseEther("1"), "new day");
    expect(await vault.spentToday()).to.equal(e.parseEther("1"));
  });

  it("blocks non-whitelisted recipients when the whitelist is on", async function () {
    const e = await ethersAsync();
    const ONE = e.parseEther("1");
    await vault.connect(owner).setWhitelist(merchant.address, true);
    await vault.connect(owner).setPolicy(ONE, e.parseEther("100"), true);

    await expect(
      vault.connect(scammer).spend(merchant.address, ONE, "nope")
    ).to.be.revertedWithCustomError(vault, "OnlyAgent");

    await expect(
      vault.connect(agent).spend(scammer.address, ONE, "not allowed")
    ).to.be.revertedWithCustomError(vault, "NotWhitelisted");

    // whitelisted merchant still works
    await expect(vault.connect(agent).spend(merchant.address, ONE, "ok")).to.emit(vault, "Spent");
  });

  it("pauses the agent instantly", async function () {
    const e = await ethersAsync();
    await vault.connect(owner).setPaused(true);
    await expect(
      vault.connect(agent).spend(merchant.address, e.parseEther("1"), "paused")
    ).to.be.revertedWithCustomError(vault, "VaultPaused");
    await vault.connect(owner).setPaused(false);
  });

  it("refuses to spend to the zero address", async function () {
    const e = await ethersAsync();
    await expect(
      vault.connect(agent).spend(e.ZeroAddress, e.parseEther("1"), "burn")
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("lets only the owner withdraw funds", async function () {
    const e = await ethersAsync();
    const balance = await e.provider.getBalance(await vault.getAddress());
    await expect(vault.connect(agent).withdraw(balance)).to.be.revertedWithCustomError(
      vault,
      "OnlyOwner"
    );
    await expect(vault.connect(owner).withdrawAll()).to.changeEtherBalance(
      e,
      owner,
      balance
    );
  });

  it("allows the owner to rotate the agent key", async function () {
    await expect(vault.connect(owner).setAgent(scammer.address))
      .to.emit(vault, "AgentSet")
      .withArgs(scammer.address);
    expect(await vault.agent()).to.equal(scammer.address);
  });
});
