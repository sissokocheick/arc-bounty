// Approves a pending submission and confirms the payout landed.
//
// Only the task CREATOR can approve, and on the seeded tasks that creator is
// the compromised deployer wallet — so this signs with that key. That is fine
// here and even desirable: the key pays a fraction of a cent of gas, and the
// escrowed reward moves OUT of that key's control into the worker's wallet.
// The key never receives anything.
//
//   npx hardhat run scripts/approve-task.mjs --network arc 1
//
// The argument is the task id. Nothing is approved until the checks below all
// pass, and the script refuses to sign for a task that isn't waiting on one.

import hre from "hardhat";
import { ethers } from "ethers";
import { existsSync, readFileSync } from "fs";
import { parse } from "dotenv";

const RPC = "https://rpc.mainnet.arc.io";
const EXPLORER = "https://explorer.arc.io";

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
  const id = process.env.TASK_ID;
  if (!id) {
    console.error(
      "Usage: TASK_ID=1 npx hardhat run scripts/approve-task.mjs --network arc"
    );
    process.exit(1);
  }

  const key = envKey("PRIVATE_KEY");
  const boardAddr = envKey("NEXT_PUBLIC_TASK_BOARD_ADDRESS");
  if (!key || !boardAddr) {
    console.error("PRIVATE_KEY or NEXT_PUBLIC_TASK_BOARD_ADDRESS missing from .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(key, provider);

  const Board = new ethers.Contract(boardAddr, [
    "function getTask(uint256) view returns ((uint256 id, address creator, string title, string description, uint256 reward, address freelancer, string proofUrl, bool submitted, bool completed, bool cancelled, uint256 deadline))",
    "function approveWork(uint256)",
  ]);
  const t = await Board.connect(provider).getTask(BigInt(id));

  console.log(`task #${t.id}  ${t.title}`);
  console.log(`  creator    ${t.creator}`);
  console.log(`  worker     ${t.freelancer}`);
  console.log(`  reward     ${ethers.formatEther(t.reward)} USDC`);
  console.log(`  submitted  ${t.submitted}   completed ${t.completed}   cancelled ${t.cancelled}`);
  console.log(`  proof      ${t.proofUrl}\n`);

  if (t.completed) {
    console.log("Already approved and paid out. Nothing to do.");
    process.exit(0);
  }
  if (t.cancelled) {
    console.log("This task was cancelled and refunded. Nothing to approve.");
    process.exit(0);
  }
  if (!t.submitted) {
    console.log("No work is pending on this task — there is nothing to approve.");
    process.exit(1);
  }
  if (t.creator.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(
      `This wallet (${signer.address}) is not the creator (${t.creator}). It cannot approve.`
    );
    process.exit(1);
  }

  const before = await provider.getBalance(t.freelancer);
  console.log(`approving as ${signer.address} …`);
  const tx = await Board.connect(signer).approveWork(BigInt(id));
  const r = await tx.wait();
  console.log(`  mined in block ${r.blockNumber}  ${EXPLORER}/tx/${r.hash}`);

  // The payout is a value transfer inside the same transaction; confirm the
  // worker's balance actually moved rather than trusting the status code.
  const after = await provider.getBalance(t.freelancer);
  const gained = after - before;
  console.log(`\nworker balance  ${ethers.formatEther(before)} -> ${ethers.formatEther(after)} USDC`);
  if (gained === t.reward) {
    console.log(`paid out exactly ${ethers.formatEther(gained)} USDC.`);
  } else {
    console.log(
      `WARNING: payout was ${ethers.formatEther(gained)} USDC, expected ${ethers.formatEther(
        t.reward
      )}. Check the receipt.`
    );
  }
}

main().catch((e) => {
  console.error(e?.shortMessage || e?.reason || e?.message || e);
  process.exitCode = 1;
});
