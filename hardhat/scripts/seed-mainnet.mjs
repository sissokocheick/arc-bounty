// Seeds the MAINNET deployment with a working agent economy sized to the
// deployer's actual USDC balance: a funded vault with a spending policy, a
// registered agent, real escrowed tasks, and at least one real payout so the
// explorer shows money moving and reputation accruing.
//
//   npx hardhat run scripts/seed-mainnet.mjs --network arc
//
// The agent EOA is generated on first run and stored in .env as
// AGENT_PRIVATE_KEY, so you keep custody of it. It is deliberately a separate
// key from the deployer: AgentVault's whole point is that the owner who funds
// the vault is not the agent who spends from it.

import hre from "hardhat";
import { ethers } from "ethers";
import { appendFileSync, existsSync, readFileSync } from "fs";
import { parse } from "dotenv";

const RPC = "https://rpc.mainnet.arc.io";
const EXPLORER = "https://explorer.arc.io";

// Budget, in native USDC. Sized so a ~0.5 USDC deployer wallet covers it with
// gas headroom left over. Every escrowed amount below is recoverable: task
// rewards refund on cancel, and the vault withdraws to the owner any time.
const VAULT_FUND = "0.08";
const AGENT_GAS = "0.06";
const REWARD = "0.005"; // per task, x TASKS below
const SPEND = "0.002"; // the agent's autonomous spend from the vault

const TASKS = [
  ["Summarize 12 support tickets", "One-page digest of recurring issues.", 0],
  ["Label 200 product images", "Bounding boxes around defects, JSON export.", 1],
  ["Draft release notes for v2.4", "Audience: non-technical ops leads.", 2],
];

// Read a key from .env, then from the frontend .env.local, like the config.
function envKey(name) {
  if (existsSync(".env")) {
    const v = parse(readFileSync(".env", "utf8"))[name];
    if (v) return v;
  }
  if (existsSync("../.env.local")) {
    const v = parse(readFileSync("../.env.local", "utf8"))[name];
    if (v) return v;
  }
  return process.env[name];
}

const ADDR = {
  board: envKey("NEXT_PUBLIC_TASK_BOARD_ADDRESS"),
  vault: envKey("NEXT_PUBLIC_AGENT_VAULT_ADDRESS"),
  registry: envKey("NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS"),
};

function persistAgentKey(pk, address) {
  if (!existsSync(".env")) return;
  const raw = readFileSync(".env", "utf8");
  if (/^AGENT_PRIVATE_KEY=/m.test(raw)) return;
  appendFileSync(".env", `\nAGENT_PRIVATE_KEY=${pk}\n# agent EOA for ${address}\n`);
}

async function main() {
  const deployerKey = envKey("PRIVATE_KEY");
  if (!deployerKey) { console.error("PRIVATE_KEY missing from .env"); process.exit(1); }
  for (const [k, v] of Object.entries(ADDR)) {
    if (!v) { console.error(`${k} missing from .env / ../.env.local`); process.exit(1); }
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const owner = new ethers.Wallet(deployerKey, provider);
  const balance = await provider.getBalance(owner.address);

  const needed = ethers.parseEther(VAULT_FUND) + ethers.parseEther(AGENT_GAS)
    + ethers.parseEther(String(REWARD)) * BigInt(TASKS.length)
    + ethers.parseEther(SPEND);

  console.log(`deployer ${owner.address}`);
  console.log(`balance   ${ethers.formatEther(balance)} USDC`);
  if (balance < needed * 12n / 10n) {
    console.error(
      `\nNot enough USDC. Need ~${ethers.formatEther(needed)} + gas headroom, have ${ethers.formatEther(balance)}.\n` +
      `Bridge more USDC to Arc mainnet and rerun. Nothing was spent.`
    );
    process.exit(1);
  }

  // ---- agent EOA: generated once, persisted, kept under your control --------
  let agentKey = envKey("AGENT_PRIVATE_KEY");
  let agent;
  if (agentKey) {
    agent = new ethers.Wallet(agentKey, provider);
    console.log(`agent     ${agent.address} (from .env)`);
  } else {
    agent = ethers.Wallet.createRandom().connect(provider);
    persistAgentKey(agent.privateKey, agent.address);
    console.log(`agent     ${agent.address} (NEW — key saved to .env)`);
  }

  // ---- contracts -----------------------------------------------------------
  const board = new ethers.Contract(ADDR.board, ABI.board, owner);
  const vault = new ethers.Contract(ADDR.vault, ABI.vault, owner);
  const registry = new ethers.Contract(ADDR.registry, ABI.registry, owner);

  // Callers pass a pending TransactionResponse; await it before waiting.
  const step = async (label, txOrPromise) => {
    const tx = await txOrPromise;
    const r = await tx.wait();
    console.log(`  ${label}  ${EXPLORER}/tx/${r.hash}`);
    return r;
  };

  // 1. The agent needs gas money of its own — on Arc that means USDC.
  const agentBal = await provider.getBalance(agent.address);
  if (agentBal === 0n) {
    await step(`funding agent with ${AGENT_GAS} USDC for gas`,
      owner.sendTransaction({ to: agent.address, value: ethers.parseEther(AGENT_GAS) }));
  }

  // 2. Register the agent. Idempotent: re-registering reverts AlreadyRegistered.
  const reg = registry.connect(agent);
  const isReg = (await registry.getAgent(agent.address)).registered;
  if (!isReg) {
    await step("registering agent ARC-1", reg.register("ARC-1", "research,summary", "ipfs://meta", ADDR.vault));
  }

  // 3. Rotate the vault's agent key off the deployer, fund it, set a policy.
  if ((await vault.agent()).toLowerCase() !== agent.address.toLowerCase()) {
    await step("rotating vault agent key", vault.setAgent(agent.address));
  }
  if ((await provider.getBalance(ADDR.vault)) === 0n) {
    await step(`funding vault with ${VAULT_FUND} USDC`, vault.fund({ value: ethers.parseEther(VAULT_FUND) }));
  }
  // Cap each spend, cap the day, and whitelist the owner as the only permitted
  // recipient — the agent can pay its operator for API calls and nothing else.
  await step("setting policy: cap 0.005 / day 0.05 / whitelist on",
    vault.setPolicy(ethers.parseEther("0.005"), ethers.parseEther("0.05"), true));
  await step("whitelisting the owner as payee", vault.setWhitelist(owner.address, true));

  // 4. Post real escrowed tasks.
  const posted = [];
  for (const [title, desc, worker] of TASKS) {
    const r = await step(`posting "${title}" (${REWARD} escrowed)`,
      board.postTask(title, desc, Math.floor(Date.now() / 1000) + 7 * 86400,
        { value: ethers.parseEther(String(REWARD)) }));
    const log = r.logs.find((l) => board.interface.parseLog(l)?.name === "TaskPosted");
    posted.push({ id: board.interface.parseLog(log).args.id, title, worker });
  }

  // 5. The agent does the work and gets paid for one of them, for real.
  const job = posted.find((t) => t.worker === 0);
  const boardAsAgent = board.connect(agent);
  await step(`agent submitting "${job.title}"`, boardAsAgent.submitWork(job.id, "https://proof.arc/summary.md"));
  await step("employer approving — USDC pays out now", board.approveWork(job.id));

  const rep = await registry.getAgent(agent.address);
  console.log(`\nagent reputation: ${rep.tasksCompleted} tasks · ${ethers.formatEther(rep.totalEarned)} USDC earned`);

  // 6. The agent spends from its vault inside the policy, with an on-chain reason.
  await step(`agent spending ${SPEND} USDC from vault`,
    vault.connect(agent).spend(owner.address, ethers.parseEther(SPEND), "api:embedding-batch-42"));

  console.log(`\nvault balance  ${ethers.formatEther(await provider.getBalance(ADDR.vault))} USDC`);
  console.log(`deployer now   ${ethers.formatEther(await provider.getBalance(owner.address))} USDC`);
  console.log(`\nNext: NEXT_PUBLIC_* addresses in .env.local, then \`npm run dev\`.`);
}

const ABI = {
  board: [
    "function postTask(string,string,uint256) payable",
    "function submitWork(uint256,string)",
    "function approveWork(uint256)",
    "function taskCount() view returns (uint256)",
    "event TaskPosted(uint256 indexed id, address indexed creator, uint256 reward, string title, uint256 deadline)",
  ],
  vault: [
    "function agent() view returns (address)",
    "function fund() payable",
    "function setAgent(address)",
    "function setPolicy(uint256,uint256,bool)",
    "function setWhitelist(address,bool)",
    "function spend(address,uint256,string)",
  ],
  registry: [
    "function register(string,string,string,address)",
    "function getAgent(address) view returns (tuple(string handle,string capabilities,string metadataUri,address vault,bool registered,uint256 tasksCompleted,uint256 totalEarned,uint256 registeredAt))",
  ],
};

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exit(1);
});
