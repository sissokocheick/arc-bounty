// Redeploys AgentVault under a NEW owner.
//
// The deployed vault is owned forever by the compromised deployer key — there
// is no transferOwnership, so every "Action failed / Only the vault owner can
// do this" from a clean wallet is permanent, not a bug. This script deploys a
// fresh vault whose owner is the wallet you actually use, funds it, applies
// the same policy as the seeded one, and repoints the agent's registry entry.
//
//   1. Put the new owner's key in hardhat/.env as VAULT_OWNER_KEY
//      (the OKX account you connect to the dashboard with). NEVER paste it
//      into a chat — that is how the first key was compromised.
//   2. npx hardhat run scripts/redeploy-vault.mjs --network arc
//   3. Delete VAULT_OWNER_KEY from .env once the script prints the address.
//
// The old vault keeps its 0.078 USDC. Only the compromised key can reach it,
// so consider that written off unless you withdraw it with that key yourself.

import hre from "hardhat";
import { ethers } from "ethers";
import { existsSync, readFileSync } from "fs";
import { parse } from "dotenv";

const RPC = "https://rpc.mainnet.arc.io";
const EXPLORER = "https://explorer.arc.io";

// Mirrors the seeded configuration so the dashboard looks identical.
const VAULT_FUND = "0.05";
const PER_SPEND_CAP = "0.005";
const DAILY_BUDGET = "0.05";
const AGENT_HANDLE = "ARC-1";

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

async function main() {
  const { ethers } = await hre.network.getOrCreate();
  const ownerKey = envKey("VAULT_OWNER_KEY");
  const agentKey = envKey("AGENT_PRIVATE_KEY");
  const registryAddr = envKey("NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS");

  if (!ownerKey) {
    console.error(
      "VAULT_OWNER_KEY missing. Put the key that will OWN the vault in hardhat/.env first."
    );
    process.exit(1);
  }
  if (!agentKey) {
    console.error(
      "AGENT_PRIVATE_KEY missing from .env — needed to repoint the agent's registry entry."
    );
    process.exit(1);
  }
  if (!registryAddr) {
    console.error("NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS missing from .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const owner = new ethers.Wallet(ownerKey, provider);
  const agent = new ethers.Wallet(agentKey, provider);

  const balance = await provider.getBalance(owner.address);
  console.log(`new owner  ${owner.address}`);
  console.log(`balance    ${ethers.formatEther(balance)} USDC`);
  if (balance < ethers.parseEther(VAULT_FUND) + ethers.parseEther("0.01")) {
    console.error(
      `Not enough USDC for the ${VAULT_FUND} fund plus gas. Top the wallet up first.`
    );
    process.exit(1);
  }

  const Registry = new ethers.Contract(registryAddr, [
    "function agents(address) view returns (string handle,string capabilities,string metadataUri,address vault,bool registered,uint256 tasksCompleted,uint256 totalEarned,uint256 registeredAt)",
    "function setVault(address _vault)",
  ]);
  const before = await Registry.connect(provider).agents(agent.address);
  if (!before.registered) {
    console.error(
      `${agent.address} is not registered in the registry. Nothing to repoint.`
    );
    process.exit(1);
  }
  console.log(`agent      ${agent.address} (${before.handle})`);
  console.log(`old vault  ${before.vault}\n`);

  const step = async (label, txOrPromise) => {
    const tx = await txOrPromise;
    const r = await tx.wait();
    console.log(`  ${label}  ${EXPLORER}/tx/${r.hash}`);
    return r;
  };

  // Deploy from the new owner: the constructor sets owner = msg.sender, so the
  // wallet that pays for deployment is the wallet that owns the vault forever.
  const Vault = await ethers.getContractFactory("AgentVault");
  const vault = await Vault.connect(owner).deploy(
    agent.address,
    AGENT_HANDLE,
    { value: ethers.parseEther(VAULT_FUND) }
  );
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`vault deployed at ${vaultAddr}\n`);

  await step("funding policy applied", vault.setPolicy(
    ethers.parseEther(PER_SPEND_CAP),
    ethers.parseEther(DAILY_BUDGET),
    true
  ));
  await step("owner whitelisted as payee", vault.setWhitelist(owner.address, true));

  // The registry's vault pointer is agent-written, so this needs the agent key.
  await step(
    "registry repointed at the new vault",
    Registry.connect(agent).setVault(vaultAddr)
  );

  console.log(`\nDone. Next:`);
  console.log(`  1. Delete VAULT_OWNER_KEY from hardhat/.env`);
  console.log(`  2. Set NEXT_PUBLIC_AGENT_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`     in .env.local AND in the Vercel project settings, then redeploy`);
  console.log(`  3. The old vault ${before.vault} still holds the old funds.`);
}

main().catch((e) => {
  console.error(e?.shortMessage || e?.message || e);
  process.exitCode = 1;
});
