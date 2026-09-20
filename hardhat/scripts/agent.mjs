// Agently autonomous worker.
//
// This is the demo loop that makes the "agentic economy" real rather than
// theatrical: a script that behaves like an agent would. It watches the
// TaskBoard for open tasks matching its declared capabilities, bids on them
// by submitting work, and — once paid — its reputation in the registry grows.
//
// Swap the `decide()` function for an LLM call and nothing else changes: the
// economics, the escrow and the policy enforcement all stay identical.
//
//   npx hardhat run scripts/agent.mjs --network localhost
//
// It prints every decision so a judge watching the terminal sees the loop:
//   [ARC-1] scanning… 4 open tasks
//   [ARC-1] submitting "Summarize 12 support tickets" (3.0 USDC)
//   [ARC-1] submitted → waiting for review
//   [ARC-1] paid 3.0 USDC · total earned 4.5 USDC

import hre from "hardhat";

const BOARD = process.env.NEXT_PUBLIC_TASK_BOARD_ADDRESS;
const REGISTRY = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS;
const HANDLE = process.env.AGENT_HANDLE || "ARC-1";
const POLL_MS = Number(process.env.AGENT_POLL_MS || 4000);
const CAPS = (process.env.AGENT_CAPS || "research,summary").split(",");

const { ethers } = await hre.network.getOrCreate();

// A trivial stand-in for the model. A real deployment points this at an LLM;
// the loop around it is what the hackathon is about.
function decide(task, caps) {
  const hay = `${task.title} ${task.description}`.toLowerCase();
  const hit = caps.some((c) => hay.includes(c.trim()));
  return hit ? `https://proof.agently/${HANDLE}/${task.id}.md` : null;
}

async function main() {
  if (!BOARD || !REGISTRY) {
    console.error("Set NEXT_PUBLIC_TASK_BOARD_ADDRESS and NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS first");
    process.exit(1);
  }

  // Resolve this loop's signer by looking the handle up in the registry, not
  // by a hardcoded index into getSigners(). Signer order differs per network —
  // on localhost ARC-1 is workerA (index 2), on mainnet it is the agent key
  // (index 1). Indexing by position would silently pick the poster, the
  // deployer, or whoever else happens to sit there. Whatever key this resolves
  // to is the one whose reputation the payouts will land on, so it must be the
  // key that was actually registered as this handle.
  const signers = await ethers.getSigners();
  const reg0 = await ethers.getContractAt("AgentRegistry", REGISTRY);
  let me;
  for (const s of signers) {
    try {
      const a = await reg0.connect(s).getAgent(s.address);
      if (a.registered && a.handle === HANDLE) { me = s; break; }
    } catch { /* not this signer's registry, keep looking */ }
  }
  if (!me) {
    console.error(
      `No signer is registered as "${HANDLE}". Register it first, or set` +
      " AGENT_PRIVATE_KEY in hardhat/.env. Refusing to fall back to another" +
      " key — the loop would submit work under the wrong identity."
    );
    process.exit(1);
  }
  const board = (await ethers.getContractAt("TaskBoard", BOARD)).connect(me);
  const registry = (await ethers.getContractAt("AgentRegistry", REGISTRY)).connect(me);

  let agent;
  // The loop can only start once this handle is registered — resolution above
  // already proved it, so re-reading here is enough to capture the profile.
  agent = await registry.getAgent(me.address);

  const balance0 = await ethers.provider.getBalance(me.address);
  console.log(`[${HANDLE}] online · wallet ${me.address}`);
  console.log(`[${HANDLE}] capabilities: ${agent.capabilities}`);

  let cycles = 0;
  while (true) {
    cycles++;
    const tasks = await board.getAllTasks();
    const open = tasks.filter((t) => !t.submitted && !t.completed && !t.cancelled);

    if (cycles === 1 || open.length) {
      console.log(`[${HANDLE}] scanning… ${open.length} open task${open.length === 1 ? "" : "s"}`);
    }

    for (const t of open) {
      if (t.creator.toLowerCase() === me.address.toLowerCase()) continue;

      const proof = decide(t, CAPS);
      if (!proof) {
        console.log(`[${HANDLE}] skip "${t.title}" — outside capabilities`);
        continue;
      }

      console.log(
        `[${HANDLE}] submitting "${t.title}" (${ethers.formatEther(t.reward)} USDC)`
      );
      try {
        const tx = await board.submitWork(t.id, proof);
        await tx.wait();
        console.log(`[${HANDLE}] submitted → waiting for review`);
      } catch (e) {
        console.log(`[${HANDLE}] submit failed: ${e.shortMessage || e.message}`);
      }
    }

    // Report any income since the last cycle.
    const now = await registry.getAgent(me.address);
    if (now.totalEarned > agent.totalEarned) {
      const delta = now.totalEarned - agent.totalEarned;
      console.log(
        `[${HANDLE}] paid ${ethers.formatEther(delta)} USDC · total earned ${ethers.formatEther(
          now.totalEarned
        )} USDC · ${now.tasksCompleted} tasks`
      );
      agent = now;
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
