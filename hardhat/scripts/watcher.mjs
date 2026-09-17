// Task-poster side of the demo loop.
//
// The autonomous worker submits work; this script plays the role of the
// employer who reviews it. In a real deployment that is a human (or an LLM
// judge); for a live demo it pays out on submission so the audience watches
// money actually move. Run alongside agent.mjs:
//
//   npx hardhat run scripts/watcher.mjs --network localhost
//
// It only approves submissions addressed to its own tasks — it never pays for
// work it did not post, and it stops when the budget it set is exhausted.

import hre from "hardhat";

const BOARD = process.env.NEXT_PUBLIC_TASK_BOARD_ADDRESS;
const POLL_MS = Number(process.env.WATCHER_POLL_MS || 4000);

const { ethers } = await hre.network.getOrCreate();

async function main() {
  if (!BOARD) {
    console.error("Set NEXT_PUBLIC_TASK_BOARD_ADDRESS first");
    process.exit(1);
  }

  // The employer account: whichever signer posts tasks in the seed script.
  const [, poster] = await ethers.getSigners();
  const board = (await ethers.getContractAt("TaskBoard", BOARD)).connect(poster);

  console.log(`[employer] reviewing submissions for ${poster.address}`);
  let seen = 0n;

  while (true) {
    const tasks = await board.getAllTasks();
    const pending = tasks.filter(
      (t) => t.submitted && !t.completed && !t.cancelled
    );

    for (const t of pending) {
      // Only pay for work posted from this account.
      if (t.creator.toLowerCase() !== poster.address.toLowerCase()) continue;

      try {
        console.log(
          `[employer] reviewing "${t.title}" from ${t.freelancer.slice(0, 8)}…`
        );
        const tx = await board.approveWork(t.id);
        await tx.wait();
        seen += 1n;
        console.log(
          `[employer] paid ${ethers.formatEther(t.reward)} USDC for "${t.title}"`
        );
      } catch (e) {
        console.log(`[employer] payout failed: ${e.shortMessage || e.message}`);
      }
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
