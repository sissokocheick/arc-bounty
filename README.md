# Agently — the agentic economy on Arc

Agently is a machine-to-machine economy where **autonomous AI agents earn and
spend native USDC on [Arc](https://docs.arc.io)**, bounded by policy-governed
wallets that keep them on a leash.

Arc's distinguishing property is that **USDC is the native gas token**. There is
no ERC-20 wrapper, no `approve()` dance, no "gas token vs. payment token"
distinction: `msg.value` *is* USDC. Agently builds the two things that property
unlocks — a micro-task market settled instantly in stablecoin, and a wallet
that an AI agent can actually be trusted with.

Built for the **Circle Arc Microgrants** hackathon on DoraHacks.

## What's here

```
hardhat/
  contracts/
    TaskBoard.sol     micro-task escrow: post a task, submit work, get paid
    AgentVault.sol    policy-governed wallet an autonomous agent spends from
    AgentRegistry.sol agent identity + on-chain reputation
  scripts/
    seed.mjs          fills a local chain with agents, tasks and a vault
    agent.mjs         an autonomous worker: scans, bids, gets paid (demo loop)
    watcher.mjs       the employer side: reviews and pays on submission
  test/               32 tests, incl. the griefing attack the v1 contract allowed
src/                   Next.js dashboard: tasks, vault policy, agent registry
```

## The contracts

**TaskBoard** — a creator escrows the reward in native USDC; any agent or human
except the creator submits a proof URL; the creator approves and the funds
settle instantly, or rejects and the task reopens, or cancels for a refund while
nothing is under review.

**AgentVault** — the interesting one. You give an agent a funded wallet and a
policy: a per-spend cap, a daily budget, an optional recipient whitelist, and a
pause switch. The agent can only transact inside those bounds, and every spend
is logged on-chain with a reason string — so an autonomous agent's behaviour is
auditable rather than opaque. This is what makes handing a wallet to an LLM
defensible.

**AgentRegistry** — agents register a handle, capabilities and a metadata URI.
When one gets paid, the board records it, so a task poster can check an agent's
track record before trusting it.

## Run the whole loop locally

Five commands, one terminal each (or use `npm run` aliases):

```bash
cd hardhat
npm install

npm run node        # 1. local chain on :18545
npm run seed        # 2. agents, tasks, a funded vault with a policy
npm run agent       # 3. ARC-1 starts scanning and bidding
npm run watcher     # 4. the employer pays on submission
```

Watch the terminal: the agent reports every task it takes, then reports the
USDC landing and its reputation counter climbing. That is the entire demo — a
closed economic loop with no human in it, settled in a stablecoin.

Swap `decide()` in `agent.mjs` for an LLM call and nothing else changes: the
escrow, the payout and the policy enforcement are all on-chain.

## Tests

```bash
npm test
```

32 tests covering the escrow flows, the vault's policy bounds, the daily-budget
reset, whitelist enforcement and reputation accounting — including the griefing
attack the original bounty contract was vulnerable to (a junk submission
locking funds forever; here the creator rejects and the task reopens).

## Deploy to Arc

Get some USDC for gas on [testnet](https://faucet.circle.com), then:

```bash
cp hardhat/.env.example hardhat/.env   # fill in PRIVATE_KEY
npm run deploy:testnet                 # or deploy:mainnet
```

Copy the printed addresses into `.env.local` at the repo root:

```
NEXT_PUBLIC_TASK_BOARD_ADDRESS=0x…
NEXT_PUBLIC_AGENT_VAULT_ADDRESS=0x…
NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS=0x…
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.io
```

Arc specifics worth knowing (they will bite you otherwise):

- **Native USDC is 18 decimals; the ERC-20 USDC interface is 6.** The contracts
  only ever touch `msg.value` (native, 18). Mixing the two shifts amounts by
  10¹².
- Chain ID **5042** mainnet / **5042002** testnet. Base fee floor is 20 Gwei.
- `block.timestamp` is non-decreasing, not strictly increasing — the daily
  budget reset relies on that and it is why the tests advance time rather than
  assume it ticks.
- Transfers to the zero address revert at runtime. Nothing here can burn funds.

## Frontend

```bash
npm install
npm run dev
```

Three tabs: **Tasks** (post, submit, approve/reject/cancel), **Agent vault**
(fund, set spending policy, pause), **Agents** (register and reputation).

## Tech

Solidity 0.8.20 · Hardhat 3 · ethers v6 · Next.js 16 · React 19 · Tailwind v4
