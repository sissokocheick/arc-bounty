// Watches the deployed contracts live and prints, in plain terms, what each
// transaction did. Run it while exercising the dashboard so a click can be
// matched to what actually reached the chain.
//
//   npx hardhat run scripts/watch-live.mjs --network arc

import { ethers } from "ethers";
import { existsSync, readFileSync } from "fs";
import { parse } from "dotenv";

const RPC = "https://rpc.mainnet.arc.io";

const CONTRACTS = {
  "0xD956a7B9a5B1a4Dca32eE338b5CA24e186b34dB0": "TaskBoard",
  "0xdc4d253c97b40b4f7ba98676986ae3cbe65311c7": "AgentVault",
  // The original demo vault — still watched, because its history is real and
  // worth following even though the dashboard no longer points at it.
  "0xEeBD144eeCc4bfa9085bb68F24aF7472DDEA3dDD": "AgentVault (legacy)",
  "0xcF5d6EEDD31bF38F4A7C0601B71bBbB1F7CCa447": "AgentRegistry",
};
const WALLET_TAGS = {
  "0x46a9edae25d74e3c9816574e3850bda91df0b836": "your OKX",
  "0xb0bda6d2bb9bbe247de0d600d6befca80de58104": "compromised",
  "0x77d98d3dbb4f1e41725c55ab7848d5c7c34afa4a": "agent ARC-1",
};

const FUNCS = [
  ["postTask(string,string,uint256)", "posted a task, escrowing"],
  ["submitWork(uint256,string)", "submitted work on task"],
  ["approveWork(uint256)", "APPROVED and paid out task"],
  ["rejectWork(uint256)", "REJECTED work on task"],
  ["cancelTask(uint256)", "cancelled (refunded) task"],
  ["fund()", "funded the vault with"],
  ["withdrawAll()", "withdrew everything from the vault"],
  ["withdraw(uint256)", "withdrew from the vault"],
  ["setPolicy(uint256,uint256,bool)", "updated the spending policy"],
  ["setWhitelist(address,bool)", "changed the whitelist for"],
  ["setAgent(address)", "set the vault agent to"],
  ["setPaused(bool)", "paused/resumed the vault"],
  ["spend(address,uint256,string)", "the agent spent, paying"],
  ["register(string,string,string,address)", "registered a new agent"],
  ["setVault(address)", "repointed its vault at"],
];
const BY_SEL = {};
for (const [sig] of FUNCS) BY_SEL[ethers.id(sig).slice(0, 10)] = sig;

function envKey(name) {
  if (existsSync(".env")) {
    const v = parse(readFileSync(".env", "utf8"))[name];
    if (v) return v;
  }
  return process.env[name];
}

const watch = [
  envKey("VAULT_OWNER_KEY"),
  envKey("AGENT_PRIVATE_KEY"),
  envKey("PRIVATE_KEY"),
]
  .filter(Boolean)
  .map((k) => new ethers.Wallet(k).address.toLowerCase());

async function main() {
  const P = new ethers.JsonRpcProvider(RPC);
  let tip = await P.getBlockNumber();
  console.log(`watching from block ${tip} — exercise the dashboard now\n`);

  const seen = new Set();
  // Arc is fast; poll a window so a briefly-unavailable node still catches up.
  setInterval(async () => {
    let now;
    try {
      now = await P.getBlockNumber();
    } catch {
      return; // a dropped poll is fine, the next one covers the gap
    }
    for (let blk = tip + 1; blk <= now; blk++) {
      let block;
      try {
        block = await P.getBlock(blk, true);
      } catch {
        continue;
      }
      if (!block) continue;
      for (const t of block.prefetchedTransactions || []) {
        const to = t.to?.toLowerCase();
        const from = t.from?.toLowerCase();
        const touched =
          CONTRACTS[to] || watch.includes(from) || Object.keys(WALLET_TAGS).includes(from);
        if (!touched) continue;
        if (seen.has(t.hash)) continue;
        seen.add(t.hash);

        const who =
          WALLET_TAGS[from] ||
          (watch.includes(from) ? "a key from .env" : short(from));
        const target = CONTRACTS[to] || "an unknown address";
        const sel = BY_SEL[(t.data || "0x").slice(0, 10)] || "unknown call";

        let detail = "";
        if (sel.startsWith("approveWork") || sel.startsWith("rejectWork") || sel.startsWith("cancelTask")) {
          detail = ` task #${BigInt("0x" + (t.data || "0x").slice(10)).toString()}`;
        } else if (t.value > 0n) {
          detail = ` ${ethers.formatEther(t.value)} USDC`;
        }

        const status = (await P.getTransactionReceipt(t.hash))?.status === 1
          ? "✓"
          : "✗ FAILED";
        console.log(
          `${status} #${blk} ${who} → ${target}${detail}  [${sel}]`
        );
      }
    }
    tip = now;
  }, 4000);
}

function short(a) {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

main().catch((e) => {
  console.error(e?.shortMessage || e?.message || e);
  process.exitCode = 1;
});
