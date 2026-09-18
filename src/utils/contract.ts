import { ethers } from "ethers";

/**
 * Arc uses USDC as its native gas token (18 decimals). Everything in this app
 * is native value — there is no ERC-20 wrapping step, which is the whole point
 * of building on Arc.
 */

export const ARC_CHAIN_ID = 5042;
export const ARC_CHAIN_ID_HEX = "0x13B2";
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_RPC = "https://rpc.mainnet.arc.io";
export const ARC_EXPLORER = "https://explorer.arc.io";

// Arc publishes several equivalent public endpoints. The primary one drops
// roughly 1 request in 20 at random; the rest are keyless and answer the same
// chain. Reads try them in order so one bad node can't take the dashboard down.
const RPC_ENDPOINTS = [
  "https://rpc.mainnet.arc.io",
  "https://rpc.blockdaemon.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
  "https://rpc.quicknode.mainnet.arc.io",
];

export const AGENTLY_ABI = [
  // TaskBoard
  "function postTask(string _title, string _description, uint256 _deadline) payable",
  "function submitWork(uint256 _id, string _proofUrl)",
  "function approveWork(uint256 _id)",
  "function rejectWork(uint256 _id)",
  "function cancelTask(uint256 _id)",
  "function taskCount() view returns (uint256)",
  "function getTask(uint256 _id) view returns ((uint256 id, address creator, string title, string description, uint256 reward, address freelancer, string proofUrl, bool submitted, bool completed, bool cancelled, uint256 deadline))",
  "function getAllTasks() view returns ((uint256 id, address creator, string title, string description, uint256 reward, address freelancer, string proofUrl, bool submitted, bool completed, bool cancelled, uint256 deadline)[])",
  // AgentVault
  "function fund() payable",
  "function withdrawAll()",
  "function setPolicy(uint256 _perSpendCap, uint256 _dailyBudget, bool _whitelistEnabled)",
  "function setWhitelist(address who, bool allowed)",
  "function setAgent(address _agent)",
  "function setPaused(bool _paused)",
  "function spend(address to, uint256 amount, string reason)",
  "function dailyRemaining() view returns (uint256)",
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function policy() view returns (uint256 perSpendCap, uint256 dailyBudget, bool whitelistEnabled, bool paused)",
  "function totalSpent() view returns (uint256)",
  "function spendCount() view returns (uint256)",
  "function label() view returns (string)",
  // AgentRegistry
  "function register(string _handle, string _capabilities, string _metadataUri, address _vault)",
  "function updateProfile(string _capabilities, string _metadataUri)",
  "function setVault(address _vault)",
  "function setAuthority(address _authority)",
  "function agentCount() view returns (uint256)",
  "function getAgent(address _agent) view returns ((string handle, string capabilities, string metadataUri, address vault, bool registered, uint256 tasksCompleted, uint256 totalEarned, uint256 registeredAt))",
  "function getAllAgents() view returns ((string handle, string capabilities, string metadataUri, address vault, bool registered, uint256 tasksCompleted, uint256 totalEarned, uint256 registeredAt)[])",
  // events
  "event TaskPosted(uint256 id, address creator, uint256 reward, string title, uint256 deadline)",
  "event WorkSubmitted(uint256 id, address freelancer, string proofUrl)",
  "event WorkApproved(uint256 id, address freelancer, uint256 reward)",
  "event WorkRejected(uint256 id, address freelancer)",
  "event TaskCancelled(uint256 id, address creator, uint256 refund)",
  "event Funded(address by, uint256 amount, uint256 balance)",
  "event Spent(uint256 index, address to, uint256 amount, string reason)",
];

/**
 * Read provider against the public Arc RPC. CORS is open on these endpoints,
 * so this works in any browser — no wallet extension required. Reads must NEVER
 * go through window.ethereum, or the dashboard looks empty to anyone who hasn't
 * installed MetaMask.
 */
export function getReadProvider(index = 0) {
  return new ethers.JsonRpcProvider(RPC_ENDPOINTS[index % RPC_ENDPOINTS.length]);
}

export function getReadContract(address: string, provider: ethers.JsonRpcProvider) {
  return new ethers.Contract(address, AGENTLY_ABI, provider);
}

/**
 * Arc's public RPC drops roughly 1 call in 20 at random — no revert data, no
 * rate-limit code, just a transient node error that succeeds on retry. Without
 * a retry every dashboard read can fail on a single bad draw and leave a tab
 * stuck on "Loading…". Retrying turns a broken page into an invisible blip.
 *
 * A read that keeps failing rotates to a different RPC endpoint and retries
 * there, because a whole region can draw a bad node and no amount of retrying
 * the same one will help.
 */
export async function readWithRetry<T>(
  fn: (provider: ethers.JsonRpcProvider) => Promise<T>,
  attempts = 4
): Promise<T> {
  let last: unknown;
  for (let round = 0; round < RPC_ENDPOINTS.length; round++) {
    const provider = new ethers.JsonRpcProvider(RPC_ENDPOINTS[round]);
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn(provider);
      } catch (e) {
        last = e;
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        }
      }
    }
  }
  throw last;
}

/**
 * Look up a receipt across every Arc endpoint. The transaction is already
 * signed and broadcast by the time this runs, so returning null is never a
 * failure — it just means "check the explorer".
 */
export async function getReceiptAny(
  hash: string
): Promise<ethers.TransactionReceipt | null> {
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    try {
      const r = await getReadProvider(i).getTransactionReceipt(hash);
      if (r) return r;
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}

export function explorerTx(hash: string): string {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

export function explorerAddr(addr: string): string {
  return `${ARC_EXPLORER}/address/${addr}`;
}

/** formatEther of a sub-unit USDC amount, to 4 significant decimals. */
export function fmt(v: bigint): string {
  return Number(ethers.formatEther(v)).toFixed(4).replace(/\.?0+$/, "");
}

export function short(addr: string | undefined | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
