// Seeds a local Hardhat network (or any configured network) with a realistic
// agent economy: a few agents, a vault with a spending policy, and open tasks
// with submissions under review. Run it so the demo is never empty:
//
//   npx hardhat node --network hardhat        # in another terminal
//   npx hardhat run scripts/seed.mjs --network localhost

import hre from "hardhat";

const { ethers } = await hre.network.getOrCreate();

const TASKS = [
  ["Summarize 12 support tickets", "Turn the raw tickets into a one-page digest of recurring issues.", "3", 0],
  ["Label 200 product images", "Bounding boxes around defects, exported as JSON.", "5", 1],
  ["Draft a release note for v2.4", "Audience is non-technical ops leads.", "2", 0],
  ["Audit the checkout funnel copy", "Flag anything that reads like a dark pattern.", "4", 1],
  ["Research 3 competitor pricing pages", "Plain markdown, cite what each one charges.", "6", 0],
];

const AGENTS = [
  ["ARC-1", "research,summary"],
  ["ARC-2", "vision,labeling"],
  ["ARC-3", "writing,editing"],
];

async function main() {
  const [owner, poster, workerA, workerB, agentEoa] = await ethers.getSigners();

  const Registry = await ethers.getContractFactory("AgentRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const Board = await ethers.getContractFactory("TaskBoard");
  const board = await Board.deploy(await registry.getAddress());
  await board.waitForDeployment();

  const Vault = await ethers.getContractFactory("AgentVault");
  const vault = await Vault.deploy(agentEoa.address, "ARC-1", {
    value: ethers.parseEther("250"),
  });
  await vault.waitForDeployment();

  await registry.setAuthority(await board.getAddress());

  for (const [handle, caps] of AGENTS) {
    const who = handle === "ARC-1" ? workerA : handle === "ARC-2" ? workerB : agentEoa;
    await registry.connect(who).register(handle, caps, "ipfs://meta", await vault.getAddress());
  }

  for (const [i, [title, desc, reward, worker]] of TASKS.entries()) {
    await board
      .connect(poster)
      .postTask(title, desc, 0n, { value: ethers.parseEther(reward) });

    // Some tasks already have a submission under review, so the demo shows
    // the "approve & pay" flow immediately instead of a cold start.
    if (worker !== 0) {
      const who = worker === 1 ? workerA : workerB;
      await board.connect(who).submitWork(BigInt(i), `https://proof.example/${i}`);
    }
  }

  // A settled task, for the "recently paid" rail.
  const settledTx = await board
    .connect(poster)
    .postTask("Completed research brief", "Done", 0n, { value: ethers.parseEther("1.5") });
  const settledId = await idOf(settledTx, board);
  await board.connect(workerA).submitWork(settledId, "https://proof.example/done");
  await board.connect(poster).approveWork(settledId);

  await vault.connect(owner).setPolicy(
    ethers.parseEther("2"),
    ethers.parseEther("25"),
    false
  );

  console.log("Registry:", await registry.getAddress());
  console.log("Board:   ", await board.getAddress());
  console.log("Vault:   ", await vault.getAddress());
  console.log("\nNEXT_PUBLIC_AGENT_REGISTRY_ADDRESS=" + (await registry.getAddress()));
  console.log("NEXT_PUBLIC_TASK_BOARD_ADDRESS=" + (await board.getAddress()));
  console.log("NEXT_PUBLIC_AGENT_VAULT_ADDRESS=" + (await vault.getAddress()));
}

// Extract a posted task's id from its TaskPosted event.
async function idOf(tx, board) {
  const rc = await tx.wait();
  const log = rc.logs.find((l) => board.interface.parseLog(l)?.name === "TaskPosted");
  return board.interface.parseLog(log).args.id;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
