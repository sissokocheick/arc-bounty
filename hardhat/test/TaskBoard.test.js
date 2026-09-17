import { expect } from "chai";
import { ethers as ethersAsync, ethersObj } from "./setup.js";

describe("TaskBoard", function () {
  let registry, board, owner, alice, bob, attacker;

  before(async function () {
    const e = await ethersAsync();
    [owner, alice, bob, attacker] = await e.getSigners();

    const Registry = await e.getContractFactory("AgentRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    const Board = await e.getContractFactory("TaskBoard");
    board = await Board.deploy(await registry.getAddress());
    await board.waitForDeployment();
  });

  async function post(from, title, deadline = 0n, value) {
    const e = await ethersAsync();
    const reward = value ?? e.parseEther("10");
    const tx = await board
      .connect(from)
      .postTask(title, "desc", deadline, { value: reward });
    const rc = await tx.wait();
    const evt = rc.logs.find((l) => board.interface.parseLog(l)?.name === "TaskPosted");
    return board.interface.parseLog(evt).args.id;
  }

  it("escrows the reward and emits TaskPosted", async function () {
    const e = await ethersAsync();
    const REWARD = e.parseEther("10");
    const tx = board.connect(alice).postTask("Build a logo", "desc", 0n, { value: REWARD });
    await expect(tx).to.changeEtherBalances(ethersObj, [alice, board], [-REWARD, REWARD]);
    await expect(tx)
      .to.emit(board, "TaskPosted")
      .withArgs(0n, alice.address, REWARD, "Build a logo", 0n);
  });

  it("rejects a zero-reward task", async function () {
    await expect(board.postTask("free", "desc", 0n)).to.be.revertedWithCustomError(
      board,
      "ZeroReward"
    );
  });

  it("lets anyone except the creator submit work, then pays on approval", async function () {
    const e = await ethersAsync();
    const REWARD = e.parseEther("10");
    const taskId = await post(alice, "Write docs");
    await expect(board.connect(bob).submitWork(taskId, "https://proof"))
      .to.emit(board, "WorkSubmitted")
      .withArgs(taskId, bob.address, "https://proof");

    const approve = board.connect(alice).approveWork(taskId);
    await expect(approve).to.changeEtherBalances(ethersObj, [board, bob], [-REWARD, REWARD]);
    await expect(approve).to.emit(board, "WorkApproved");
  });

  it("forbids the creator from submitting their own task", async function () {
    const taskId = await post(alice, "Self serve");
    await expect(
      board.connect(alice).submitWork(taskId, "https://proof")
    ).to.be.revertedWithCustomError(board, "IsCreator");
  });

  it("records reputation in the registry when an agent is paid", async function () {
    const e = await ethersAsync();
    const REWARD = e.parseEther("10");
    await registry.connect(bob).register("ARC-1", "research", "ipfs://meta", e.ZeroAddress);
    // The board must be the registry's authority for it to record completions.
    await registry.setAuthority(await board.getAddress());
    const taskId = await post(alice, "Research report");
    await board.connect(bob).submitWork(taskId, "https://proof");
    await board.connect(alice).approveWork(taskId);

    const agent = await registry.getAgent(bob.address);
    expect(agent.tasksCompleted).to.equal(1n);
    expect(agent.totalEarned).to.equal(REWARD);
  });

  // The griefing attack the original bounty contract allowed: someone spams a
  // task with a junk submission to lock other workers out. Here the creator
  // can reject it and reopen the task — funds are never held hostage.
  it("a spam submission cannot lock the task: creator rejects and reopens", async function () {
    const taskId = await post(alice, "Design banner");
    await board.connect(attacker).submitWork(taskId, "https://junk");
    await expect(board.connect(alice).rejectWork(taskId))
      .to.emit(board, "WorkRejected")
      .withArgs(taskId, attacker.address);

    // Bob can now submit on the reopened task.
    await board.connect(bob).submitWork(taskId, "https://real-proof");
    await board.connect(alice).approveWork(taskId);
    expect((await board.getTask(taskId)).completed).to.be.true;
  });

  it("only the creator can approve, reject or cancel", async function () {
    const taskId = await post(alice, "Private job");
    await board.connect(bob).submitWork(taskId, "https://proof");
    await expect(board.connect(bob).approveWork(taskId)).to.be.revertedWithCustomError(
      board,
      "NotCreator"
    );
    await expect(board.connect(bob).rejectWork(taskId)).to.be.revertedWithCustomError(
      board,
      "NotCreator"
    );
    await expect(board.connect(bob).cancelTask(taskId)).to.be.revertedWithCustomError(
      board,
      "NotCreator"
    );
  });

  it("refunds the creator when an open task is cancelled", async function () {
    const e = await ethersAsync();
    const REWARD = e.parseEther("10");
    const taskId = await post(alice, "Never started");
    const cancel = board.connect(alice).cancelTask(taskId);
    await expect(cancel).to.changeEtherBalances(ethersObj, [board, alice], [-REWARD, REWARD]);
    expect((await board.getTask(taskId)).cancelled).to.be.true;
  });

  it("cannot cancel a task that already has a submission under review", async function () {
    const taskId = await post(alice, "In review");
    await board.connect(bob).submitWork(taskId, "https://proof");
    await expect(board.connect(alice).cancelTask(taskId)).to.be.revertedWithCustomError(
      board,
      "AlreadySubmitted"
    );
  });

  it("cannot double-approve or double-submit", async function () {
    const taskId = await post(alice, "Once only");
    await board.connect(bob).submitWork(taskId, "https://proof");
    await board.connect(alice).approveWork(taskId);

    await expect(
      board.connect(bob).submitWork(taskId, "https://proof")
    ).to.be.revertedWithCustomError(board, "AlreadyCompleted");
    await expect(board.connect(alice).approveWork(taskId)).to.be.revertedWithCustomError(
      board,
      "AlreadyCompleted"
    );
  });

  it("blocks work on expired tasks", async function () {
    const e = await ethersAsync();
    const block = await e.provider.getBlock("latest");
    const soon = BigInt(block.timestamp) + 60n;
    const taskId = await post(alice, "Expired", soon);

    // Fast-forward past the deadline, then the window has closed.
    await e.provider.send("evm_increaseTime", [120]);
    await e.provider.send("evm_mine", []);

    await expect(
      board.connect(bob).submitWork(taskId, "https://proof")
    ).to.be.revertedWithCustomError(board, "Expired");
  });

  it("refuses to post a task whose deadline is already in the past", async function () {
    const e = await ethersAsync();
    const block = await e.provider.getBlock("latest");
    const past = BigInt(block.timestamp) - 100n;
    await expect(post(alice, "Born expired", past)).to.be.revertedWithCustomError(
      board,
      "Expired"
    );
  });

  it("getAllTasks returns every posted task", async function () {
    const n = await board.taskCount();
    const all = await board.getAllTasks();
    expect(all.length).to.equal(n);
  });
});
