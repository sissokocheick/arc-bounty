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

// Deploying a vault needs the constructor, which the read ABI deliberately
// omits. Owner is whoever signs, so a backer becomes the owner by deploying —
// no key ever changes hands.
export const VAULT_DEPLOY_ABI = [
  "constructor(address _agent, string _label)",
  ...AGENTLY_ABI,
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

/* ------------------------------------------------- Decoding revert reasons */

// A reverted call arrives in the browser as a raw 4-byte selector plus ABI-
// encoded arguments — "0x5fc483c5" is meaningless to a user, yet it is the
// single most useful piece of information the contract can give us: it says
// exactly which guard fired. Each entry below turns one selector into the
// sentence a person needs to hear.
const KNOWN_ERRORS: {
  sig: string;
  params: string;
  explain: (args: ethers.Result) => string;
}[] = [
  // TaskBoard
  {
    sig: "NotCreator()",
    params: "",
    explain: () =>
      "Only the wallet that posted this task can review or cancel it. You are connected as a different wallet.",
  },
  {
    sig: "IsCreator()",
    params: "",
    explain: () =>
      "You posted this task, so you cannot submit work on it — post a second task and submit there instead.",
  },
  {
    sig: "TaskNotFound()",
    params: "",
    explain: () => "That task no longer exists on the board.",
  },
  {
    sig: "AlreadySubmitted()",
    params: "",
    explain: () =>
      "Work is already pending review on this task — wait for the creator to approve or reject it.",
  },
  {
    sig: "NotSubmitted()",
    params: "",
    explain: () =>
      "There is no work to review yet. Nothing is pending on this task.",
  },
  {
    sig: "AlreadyCompleted()",
    params: "",
    explain: () => "This task is already approved and paid out.",
  },
  {
    sig: "AlreadyCancelled()",
    params: "",
    explain: () => "This task was cancelled and the reward refunded.",
  },
  {
    sig: "Expired()",
    params: "",
    explain: () =>
      "The deadline on this task has passed, so it can no longer receive work.",
  },
  {
    sig: "ZeroReward()",
    params: "",
    explain: () => "The reward must be greater than zero.",
  },
  {
    sig: "TransferFailed()",
    params: "",
    explain: () =>
      "The escrow paid out successfully on-chain, but the recipient refused the incoming USDC. The task is settled.",
  },
  // AgentVault
  {
    sig: "OnlyOwner()",
    params: "",
    explain: () =>
      "Only the vault owner can do this. You are connected with a wallet that is not the owner of this vault.",
  },
  {
    sig: "OnlyAgent()",
    params: "",
    explain: () =>
      "Only the agent's own key can spend from the vault — that is the point of a policy-governed wallet.",
  },
  {
    sig: "VaultPaused()",
    params: "",
    explain: () =>
      "The vault is paused. Spending is frozen until the owner resumes it.",
  },
  {
    sig: "ZeroAddress()",
    params: "",
    explain: () => "The address cannot be the zero address.",
  },
  {
    sig: "ExceedsPerSpendCap(uint256)",
    params: "uint256",
    explain: (a) =>
      `This one payment is above the vault's per-spend cap of ${fmt(
        BigInt(a[0])
      )} USDC. Raise the cap or split the payment.`,
  },
  {
    sig: "ExceedsDailyBudget(uint256)",
    params: "uint256",
    explain: (a) =>
      `Over the daily budget — only ${fmt(
        BigInt(a[0])
      )} USDC of spend is left today. The budget resets at 00:00 UTC.`,
  },
  {
    sig: "NotWhitelisted(address)",
    params: "address",
    explain: (a) =>
      `${short(String(a[0]))} is not on the vault's allowlist, and the allowlist is currently enforced.`,
  },
  {
    sig: "InsufficientBalance(uint256)",
    params: "uint256",
    explain: (a) => `Not enough USDC — the vault holds only ${fmt(BigInt(a[0]))}.`,
  },
  // AgentRegistry
  {
    sig: "NotRegistered()",
    params: "",
    explain: () => "That wallet is not registered as an agent yet.",
  },
  {
    sig: "AlreadyRegistered()",
    params: "",
    explain: () => "This wallet is already registered as an agent.",
  },
  {
    sig: "NotAuthority()",
    params: "",
    explain: () => "Only the registry authority can do this.",
  },
  {
    sig: "EmptyHandle()",
    params: "",
    explain: () => "The agent handle cannot be empty.",
  },
];

const ERROR_BY_SELECTOR: Record<string, (args: ethers.Result) => string> = {};
const PARAMS_BY_SELECTOR: Record<string, string> = {};
for (const e of KNOWN_ERRORS) {
  const sel = ethers.id(e.sig).slice(0, 10).toLowerCase();
  ERROR_BY_SELECTOR[sel] = e.explain;
  PARAMS_BY_SELECTOR[sel] = e.params;
}

// ethers nests revert data differently for an estimate-gas failure, a send
// failure, and a wallet RPC failure, so walk the error object and keep every
// hex string that could be calldata.
function candidateRevertData(e: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (v == null || depth > 5) return;
    if (typeof v === "string") {
      // "0x" is a revert with no data at all — too short for a selector, but
      // worth recognising so we can say "no reason given" instead of nothing.
      if (v === "0x" || (v.startsWith("0x") && v.length >= 10))
        out.push(v.toLowerCase());
      return;
    }
    if (typeof v === "object") {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        // Transaction hashes look like calldata but explain nothing.
        if (/hash/i.test(k)) continue;
        walk((v as Record<string, unknown>)[k], depth + 1);
      }
    }
  };
  walk(e, 0);
  return out;
}

/**
 * Turn a transaction failure into one sentence a person can act on. Contract
 * reverts are decoded against the deployed ABIs; wallet-level problems (user
 * dismissed the signature, no gas money) are recognised by their error codes.
 */
export function describeError(e: unknown): string {
  const err = e as Record<string, unknown> | null;
  const code = (err?.code ?? (err?.info as any)?.error?.code) as
    | string
    | number
    | undefined;

  // The user closed the wallet prompt. Not a failure of anything.
  if (code === 4001 || code === "ACTION_REJECTED") {
    return "You dismissed the signature in your wallet — nothing was sent. Try again when you are ready.";
  }

  // A second wallet prompt is still open; browsers only allow one at a time.
  if (code === -32002) {
    return "Your wallet is already waiting for you to approve a request. Open it and finish that one first.";
  }

  if (code === "INSUFFICIENT_FUNDS" || code === -32000) {
    return "This wallet does not have enough USDC to cover the gas fee. Gas on Arc is paid in native USDC — top the wallet up and retry.";
  }

  // A real revert: find the first candidate that decodes to a known selector.
  for (const data of candidateRevertData(e)) {
    const sel = data.slice(0, 10);
    const explain = ERROR_BY_SELECTOR[sel];
    if (explain) {
      const params = PARAMS_BY_SELECTOR[sel];
      try {
        const args = params
          ? ethers.AbiCoder.defaultAbiCoder().decode(
              params.split(","),
              "0x" + data.slice(10)
            )
          : ([] as unknown as ethers.Result);
        return explain(args);
      } catch {
        return explain([] as unknown as ethers.Result);
      }
    }
    if (data === "0x") {
      return "The contract refused this call but did not give a reason.";
    }
  }

  if (err?.reason && typeof err.reason === "string") return err.reason;
  if (err?.shortMessage && typeof err.shortMessage === "string")
    return err.shortMessage;
  if (err?.message && typeof err.message === "string") return err.message;
  return "Unknown error — check the explorer or try again.";
}
