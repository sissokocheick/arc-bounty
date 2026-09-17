import { expect } from "chai";
import { ethers as ethersAsync } from "./setup.js";

describe("AgentRegistry", function () {
  let registry, owner, agent, other;

  before(async function () {
    const e = await ethersAsync();
    [owner, agent, other] = await e.getSigners();
    const Registry = await e.getContractFactory("AgentRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
  });

  it("registers an agent with a handle, capabilities and vault", async function () {
    const e = await ethersAsync();
    await expect(
      registry
        .connect(agent)
        .register("ARC-1", "research,code-review", "ipfs://meta", e.ZeroAddress)
    ).to.emit(registry, "AgentRegistered");
    expect((await registry.getAgent(agent.address)).handle).to.equal("ARC-1");
    expect(await registry.agentCount()).to.equal(1n);
  });

  it("prevents duplicate registration", async function () {
    const e = await ethersAsync();
    await expect(
      registry.connect(agent).register("DUP", "x", "y", e.ZeroAddress)
    ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
  });

  it("rejects an empty handle", async function () {
    const e = await ethersAsync();
    await expect(
      registry.connect(other).register("", "x", "y", e.ZeroAddress)
    ).to.be.revertedWithCustomError(registry, "EmptyHandle");
  });

  it("only the authority can record completions", async function () {
    const e = await ethersAsync();
    await expect(
      registry.connect(other).recordCompletion(agent.address, e.parseEther("1"))
    ).to.be.revertedWithCustomError(registry, "NotAuthority");
  });

  it("accumulates tasksCompleted and totalEarned", async function () {
    const e = await ethersAsync();
    await registry.connect(owner).recordCompletion(agent.address, e.parseEther("5"));
    await registry.connect(owner).recordCompletion(agent.address, e.parseEther("7"));
    const a = await registry.getAgent(agent.address);
    expect(a.tasksCompleted).to.equal(2n);
    expect(a.totalEarned).to.equal(e.parseEther("12"));
  });

  it("updates profile fields after registration", async function () {
    await registry.connect(agent).updateProfile("translation,summary", "ipfs://v2");
    const a = await registry.getAgent(agent.address);
    expect(a.capabilities).to.equal("translation,summary");
    expect(a.metadataUri).to.equal("ipfs://v2");
  });

  it("getAllAgents lists every registered agent", async function () {
    const e = await ethersAsync();
    await registry
      .connect(other)
      .register("ARC-2", "payments", "ipfs://m2", e.ZeroAddress);
    const all = await registry.getAllAgents();
    expect(all.length).to.equal(2n);
    expect(all[1].handle).to.equal("ARC-2");
  });

  it("reverts on updates from unregistered addresses", async function () {
    const e = await ethersAsync();
    const signers = await e.getSigners();
    const nobody = signers[3];
    await expect(
      registry.connect(nobody).updateProfile("x", "y")
    ).to.be.revertedWithCustomError(registry, "NotRegistered");
  });
});
