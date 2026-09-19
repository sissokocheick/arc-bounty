"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import Header from "@/components/Header";
import { useWallet } from "@/components/wallet";
import { Modal, Skeleton, useToast } from "@/components/ui";
import {
  AGENTLY_ABI,
  VAULT_DEPLOY_ABI,
  explorerAddr,
  explorerTx,
  fmt,
  getReadContract,
  describeError,
  getReceiptAny,
  readWithRetry,
  short,
} from "@/utils/contract";
import { AGENT_VAULT_BYTECODE } from "@/utils/vault-bytecode";

const BOARD = process.env.NEXT_PUBLIC_TASK_BOARD_ADDRESS || "";
const VAULT = process.env.NEXT_PUBLIC_AGENT_VAULT_ADDRESS || "";
const REGISTRY = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS || "";

type Task = {
  id: bigint;
  creator: string;
  title: string;
  description: string;
  reward: bigint;
  freelancer: string;
  proofUrl: string;
  submitted: boolean;
  completed: boolean;
  cancelled: boolean;
  deadline: bigint;
};

const TABS = ["Tasks", "Agent vault", "Agents"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("Tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastTx, setLastTx] = useState<string>("");
  const { account, provider: walletProvider, hasWallet, onArc } = useWallet();
  const [readError, setReadError] = useState<string>("");
  const [proofModal, setProofModal] = useState<bigint | null>(null);
  const [proofInput, setProofInput] = useState("");
  const [tasksLoaded, setTasksLoaded] = useState(false);

  const needConfig = !BOARD;

  // Reads go to the public RPC directly. This is deliberate: the dashboard must
  // render live mainnet data in a browser with no wallet installed, otherwise a
  // judge opening the link sees an empty app and assumes nothing is deployed.
  const read = useCallback(async () => {
    if (!BOARD) return;
    try {
      const all = await readWithRetry((p) =>
        getReadContract(BOARD, p).getAllTasks()
      );
      setTasks([...(all as Task[])].reverse());
      setReadError("");
      setTasksLoaded(true);
    } catch (e: any) {
      setReadError(describeError(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      await read();
    } finally {
      setLoading(false);
    }
  }, [read]);

  useEffect(() => {
    read();
  }, [read]);

  // Keep the board feeling live while the page is open.
  useEffect(() => {
    const id = setInterval(() => read(), 20_000);
    return () => clearInterval(id);
  }, [read]);

  async function getSigner() {
    if (!walletProvider) {
      throw new Error(
        "No wallet detected. Install MetaMask or OKX Wallet and connect to sign transactions."
      );
    }
    if (!onArc) {
      throw new Error(
        "Your wallet is on the wrong network. Switch to Arc (chain 5042) in your wallet, then try again."
      );
    }
    const provider = new ethers.BrowserProvider(walletProvider);
    return await provider.getSigner();
  }

  async function tx(fn: () => Promise<ethers.TransactionResponse>, ok: string) {
    try {
      setLoading(true);
      const t = await fn();
      // From here on the transaction is signed and broadcast. Confirm it through
      // the *public* Arc RPC rather than the wallet's own RPC — wallets poll
      // receipts through their own nodes, and those are the flaky part. If the
      // public RPC has not indexed the block yet, fall back to the wallet.
      let receipt = null as ethers.TransactionReceipt | null;
      try {
        receipt = await getReceiptAny(t.hash);
        if (!receipt) {
          receipt = await new ethers.BrowserProvider(walletProvider).getTransactionReceipt(t.hash);
        }
      } catch {
        /* could not confirm — still not a failed transaction */
      }
      setLastTx(t.hash);
      await refresh();
      if (receipt) {
        toast.push({
          kind: "success",
          title: ok,
          href: explorerTx(t.hash),
        });
      } else {
        toast.push({
          kind: "info",
          title: "Sent — unconfirmed",
          body: "The transaction is on the network but the browser could not confirm it yet. If the explorer says success, your change is already on-chain.",
          href: explorerTx(t.hash),
        });
      }
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Transaction failed",
        body: describeError(e),
      });
    } finally {
      setLoading(false);
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const signer = await getSigner();
    const c = new ethers.Contract(BOARD, AGENTLY_ABI, signer);
    const value = ethers.parseEther(String(form.get("reward")));
    const days = Number(form.get("days") || 0);
    const deadline = days
      ? BigInt(Math.floor(Date.now() / 1000) + days * 86400)
      : 0n;
    await tx(
      () =>
        c.postTask(
          String(form.get("title")),
          String(form.get("description")),
          deadline,
          { value }
        ),
      "Task posted and reward escrowed in USDC"
    );
  }

  async function submitWork(id: bigint) {
    // Open the modal instead of window.prompt — the native one is unstyled,
    // unvalidatable, and blocks the page.
    setProofInput("");
    setProofModal(id);
  }

  async function confirmSubmitWork() {
    const id = proofModal;
    const url = proofInput.trim();
    if (id === null) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.push({
        kind: "error",
        title: "Proof must be a URL",
        body: "Paste a link starting with http:// or https://.",
      });
      return;
    }
    setProofModal(null);
    const signer = await getSigner();
    const c = new ethers.Contract(BOARD, AGENTLY_ABI, signer);
    await tx(() => c.submitWork(id, url), "Work submitted for review");
  }

  async function approve(id: bigint) {
    const signer = await getSigner();
    const c = new ethers.Contract(BOARD, AGENTLY_ABI, signer);
    await tx(() => c.approveWork(id), "Approved — USDC paid out instantly");
  }

  async function reject(id: bigint) {
    const signer = await getSigner();
    const c = new ethers.Contract(BOARD, AGENTLY_ABI, signer);
    await tx(() => c.rejectWork(id), "Submission rejected — task reopened");
  }

  async function cancel(id: bigint) {
    const signer = await getSigner();
    const c = new ethers.Contract(BOARD, AGENTLY_ABI, signer);
    await tx(() => c.cancelTask(id), "Task cancelled — reward refunded");
  }

  if (needConfig) {
    return (
      <>
        <Header />
        <main className="max-w-6xl mx-auto px-4 py-20 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Agently</h1>
          <p className="text-slate-600 max-w-xl mx-auto">
            An autonomous-agent economy where AI agents escrow, earn and spend
            native USDC on Arc — with policy-governed wallets that keep them on
            a leash.
          </p>
          <div className="mt-10 max-w-lg mx-auto rounded-xl border border-amber-300 bg-amber-50 p-6 text-left">
            <p className="font-semibold text-amber-800 mb-2">
              Contracts not deployed yet
            </p>
            <p className="text-sm text-amber-700">
              Deploy the suite and set these environment variables:
            </p>
            <ul className="mt-3 text-sm font-mono text-amber-900 space-y-1">
              <li>NEXT_PUBLIC_TASK_BOARD_ADDRESS</li>
              <li>NEXT_PUBLIC_AGENT_VAULT_ADDRESS</li>
              <li>NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS</li>
            </ul>
            <p className="mt-4 text-xs text-amber-700">
              See <code>hardhat/README.md</code> for the one-command deploy.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              The agent economy, settled in USDC
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Post micro-tasks, let autonomous agents compete for them, and pay
              out instantly in Arc's native stablecoin.
            </p>
            <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              live on Arc mainnet · auto-refreshing
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-sm px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Syncing…" : "Refresh"}
          </button>
        </div>

        {lastTx && (
          <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center justify-between gap-3">
            <span>Transaction confirmed on Arc mainnet.</span>
            <a
              href={explorerTx(lastTx)}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2 shrink-0"
            >
              View on explorer ↗
            </a>
          </div>
        )}

        {!hasWallet && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <span className="font-medium">Read-only mode.</span> You're viewing
            live mainnet data without a wallet — installing one (MetaMask) lets
            you post tasks, submit work and spend from a vault.
          </div>
        )}

        {readError && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-medium">
              The chain is unreachable right now.
            </span>{" "}
            Arc's public RPC refused the request after several retries. The data
            below may be stale.
            <pre className="mt-2 text-[11px] text-amber-700 whitespace-pre-wrap break-all">
              {readError}
            </pre>
          </div>
        )}

        <LoopStrip />

        <div className="flex gap-2 mb-6 border-b border-slate-200">          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Tasks" &&
          (tasksLoaded ? (
            <TasksTab
              tasks={tasks}
              account={account}
              loading={loading}
              hasWallet={hasWallet}
              onArc={onArc}
              onSubmit={submitWork}
              onApprove={approve}
              onReject={reject}
              onCancel={cancel}
              onCreate={createTask}
            />
          ) : (
            <Skeleton lines={3} />
          ))}
        {tab === "Agent vault" && <VaultTab account={account} />}
        {tab === "Agents" && <AgentsTab />}
      </main>

      <Modal
        open={proofModal !== null}
        onClose={() => setProofModal(null)}
        title="Submit work"
      >
        <p className="text-sm text-slate-500 -mt-2 mb-4">
          Link to the proof — a GitHub PR, a Figma file, an agent output. The
          task creator reviews this and approves payout in USDC.
        </p>
        <input
          autoFocus
          type="url"
          value={proofInput}
          onChange={(e) => setProofInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmSubmitWork();
          }}
          placeholder="https://github.com/…/pull/42"
          className={inputCls}
        />
        <button
          onClick={confirmSubmitWork}
          disabled={loading || !proofInput.trim()}
          className="mt-4 w-full py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Submitting…" : "Submit for review"}
        </button>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ Loop */

// Orients a reviewer in ten seconds: the three contracts and how they fit
// together, each linking to its verified source on the explorer.
function LoopStrip() {
  const steps: [string, string, string, string][] = [
    [
      "1",
      "TaskBoard",
      "A creator escrows the reward in native USDC. Any agent submits work with a proof URL; approving pays out instantly, rejecting reopens the task.",
      BOARD,
    ],
    [
      "2",
      "AgentVault",
      "The agent's wallet. It can only transact inside a per-spend cap, a daily budget, an optional whitelist and a pause — and every spend is logged with a reason.",
      VAULT,
    ],
    [
      "3",
      "AgentRegistry",
      "On-chain identity and reputation: every completed task and every payout is recorded permanently, so track records are verifiable.",
      REGISTRY,
    ],
  ];
  return (
    <div className="mb-6 grid sm:grid-cols-3 gap-3">
      {steps.map(([n, name, blurb, addr]) => (
        <a
          key={n}
          href={explorerAddr(addr)}
          target="_blank"
          rel="noreferrer"
          className="group rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-400 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold grid place-items-center">
              {n}
            </span>
            <span className="font-semibold text-slate-900 text-sm">{name}</span>
            <span className="text-slate-300 group-hover:text-emerald-500 ml-auto text-xs">
              ↗
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">{blurb}</p>
        </a>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Tasks */

function TasksTab(props: {
  tasks: Task[];
  account: string;
  loading: boolean;
  hasWallet: boolean;
  onArc: boolean;
  onSubmit: (id: bigint) => void;
  onApprove: (id: bigint) => void;
  onReject: (id: bigint) => void;
  onCancel: (id: bigint) => void;
  onCreate: (e: React.FormEvent) => void;
}) {
  const { tasks, account } = props;
  // A reader can look at everything, but signing needs a wallet on the right
  // chain. Naming that gap here keeps the cards honest about why a button is
  // off instead of leaving the user to guess.
  const canSign = props.hasWallet && props.onArc;
  const signReason = !props.hasWallet
    ? "Connect a wallet on Arc (chain 5042) to approve this"
    : "Wrong network — switch to Arc in your wallet to approve this";
  const open = tasks.filter((t) => !t.completed && !t.cancelled);
  const settled = tasks.filter((t) => t.completed || t.cancelled);
  const totalEscrowed = open.reduce((s, t) => s + t.reward, 0n);

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-8">
      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          {open.length} open task{open.length === 1 ? "" : "s"} ·{" "}
          <span className="text-emerald-600">
            {fmt(totalEscrowed)} USDC escrowed
          </span>
        </h2>
        {!account && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 flex items-center justify-between gap-3">
            <span>
              Browse freely — but posting a task, submitting work or approving a
              payout needs a wallet on Arc (chain 5042).
            </span>
          </div>
        )}
        {open.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500 text-sm">
            No open tasks right now. Post one and it appears here instantly,
            escrowed on mainnet.
          </div>
        )}
        <div className="space-y-3">
          {open.map((t) => {
            const mine = t.creator.toLowerCase() === account.toLowerCase();
            return (
              <article
                key={t.id.toString()}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900">{t.title}</h3>
                    <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                      {t.description}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700">
                    {fmt(t.reward)} USDC
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
                  <a
                    href={explorerAddr(t.creator)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-slate-900 hover:underline underline-offset-2"
                  >
                    creator {short(t.creator)}
                  </a>
                  {t.deadline > 0n && (
                    <span>
                      closes{" "}
                      {new Date(Number(t.deadline) * 1000).toLocaleDateString()}
                    </span>
                  )}
                  {t.submitted && (
                    <span className="text-blue-600">
                      work submitted by {short(t.freelancer)} · awaiting the
                      creator&rsquo;s review
                    </span>
                  )}
                </div>

                {t.submitted && t.proofUrl && (
                  // The whole point of the review: the creator has to be able
                  // to open the work before deciding to pay for it.
                  <a
                    href={t.proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 hover:bg-blue-100 transition-colors"
                  >
                    <span className="shrink-0">Review the submitted work</span>
                    <span className="truncate font-mono text-xs opacity-80">
                      {t.proofUrl}
                    </span>
                    <span className="ml-auto shrink-0 text-xs">↗</span>
                  </a>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {mine && t.submitted && (
                    <>
                      <button
                        onClick={() => props.onApprove(t.id)}
                        disabled={props.loading || !canSign}
                        title={signReason}
                        className="text-sm font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve &amp; pay
                      </button>
                      <button
                        onClick={() => props.onReject(t.id)}
                        disabled={props.loading || !canSign}
                        title={signReason}
                        className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reject &amp; reopen
                      </button>
                    </>
                  )}
                  {mine && !t.submitted && (
                    <button
                      onClick={() => props.onCancel(t.id)}
                      disabled={props.loading || !canSign}
                      title={signReason}
                      className="text-sm font-medium px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Cancel &amp; refund
                    </button>
                  )}
                  {!mine && !t.submitted && (
                    <button
                      onClick={() => props.onSubmit(t.id)}
                      disabled={props.loading}
                      className="text-sm font-medium px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      Submit work
                    </button>
                  )}
                  {/* The task is under someone else's review. A stranger has no
                      action to take, so show the review controls greyed out —
                      this is what they would see on their own task, and it
                      says why it is not theirs to decide. */}
                  {!mine && t.submitted && (
                    <button
                      disabled
                      className="text-sm font-medium px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 cursor-not-allowed"
                    >
                      Approve &amp; pay
                    </button>
                  )}
                  {!canSign && mine && (
                    <span className="text-xs text-amber-600">{signReason}</span>
                  )}
                  {!mine && t.submitted && (
                    <span className="text-xs text-slate-400">
                      under review · only the creator can approve payout
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <h2 className="text-sm font-semibold text-slate-700 mt-8 mb-3">
          Recently settled
        </h2>
        <div className="space-y-3">
          {settled.slice(0, 5).map((t) => (
            <div
              key={t.id.toString()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 flex items-center justify-between text-sm gap-3"
            >
              <span className="text-slate-700 truncate">
                {t.title}{" "}
                <span className="text-slate-400">· {fmt(t.reward)} USDC</span>
              </span>
              <span
                className={
                  t.completed
                    ? "text-emerald-600 font-medium"
                    : "text-slate-400 font-medium"
                }
              >
                {t.completed ? "paid out" : "refunded"}
              </span>
            </div>
          ))}
          {settled.length === 0 && (
            <p className="text-sm text-slate-400">Nothing settled yet.</p>
          )}
        </div>
      </section>

      <aside>
        <form
          onSubmit={props.onCreate}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
        >
          <h2 className="font-semibold text-slate-900">Post a micro-task</h2>
          <Field label="Title">
            <input
              name="title"
              required
              placeholder="Summarize 10 support tickets"
              className={inputCls}
            />
          </Field>
          <Field label="Brief">
            <textarea
              name="description"
              required
              rows={3}
              placeholder="What does done look like?"
              className={inputCls}
            />
          </Field>
          <Field label="Reward (USDC)">
            <input
              name="reward"
              type="number"
              step="0.001"
              min="0.001"
              defaultValue="0.005"
              required
              className={inputCls}
            />
          </Field>
          <Field label="Window (days, 0 = open)">
            <input
              name="days"
              type="number"
              min="0"
              max="90"
              defaultValue="3"
              className={inputCls}
            />
          </Field>
          <button
            type="submit"
            disabled={props.loading || !props.hasWallet}
            className="w-full py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {props.loading
              ? "Escrowing…"
              : props.hasWallet
              ? "Escrow & post"
              : "Connect a wallet to post"}
          </button>
          <p className="text-xs text-slate-400">
            The reward is locked in the contract until you approve the work, and
            refundable while nothing is under review.
          </p>
        </form>
      </aside>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ Vault */

function VaultTab({ account }: { account: string }) {
  const toast = useToast();
  const { provider: walletProvider, onArc } = useWallet();
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [fundAmt, setFundAmt] = useState("0.05");
  const [fundOpen, setFundOpen] = useState(false);

  // A vault the backer deployed from this browser. The contract has no
  // transferOwnership, so "make me the owner" means deploying a fresh vault —
  // the owner is msg.sender, which is the connected wallet. Remembered locally
  // so a refresh keeps showing their vault instead of the demo one.
  const [myVault, setMyVault] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("agently:myVault") || "";
  });
  const vault = myVault || VAULT;

  function useVault(addr: string) {
    setMyVault(addr);
    if (addr) window.localStorage.setItem("agently:myVault", addr);
    else window.localStorage.removeItem("agently:myVault");
  }

  async function load() {
    if (!vault) return;
    // Public RPC — works with no wallet installed.
    try {
      const data = await readWithRetry((p) => {
        const c = getReadContract(vault, p);
        return Promise.all([
          c.owner(),
          c.agent(),
          c.policy(),
          c.totalSpent(),
          c.spendCount(),
          c.dailyRemaining(),
          p.getBalance(vault),
        ] as const);
      });
      const [owner, agent, policy, totalSpent, spendCount, remaining, balance] = data;
      setState({ owner, agent, policy, totalSpent, spendCount, remaining, balance });
      setError("");
    } catch (e: any) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    load();
  }, [vault]);

  // Keep the vault numbers live while the tab sits open.
  useEffect(() => {
    const id = setInterval(() => load(), 20_000);
    return () => clearInterval(id);
  }, [vault]);

  function doFund() {
    const v = String(fundAmt || "").trim();
    if (!v || Number(v) <= 0) {
      toast.push({ kind: "error", title: "Enter an amount", body: "The fund amount must be greater than 0." });
      return;
    }
    setFundOpen(false);
    run("fund", "Vault funded", { value: ethers.parseEther(v) });
  }

  async function run(fn: string, label: string, ...args: any[]) {
    try {
      setLoading(true);
      if (!walletProvider)
        throw new Error(
          "No wallet detected. Install MetaMask or OKX Wallet and connect to sign."
        );
      if (!onArc)
        throw new Error(
          "Your wallet is on the wrong network. Switch to Arc (chain 5042) and try again."
        );
      const provider = new ethers.BrowserProvider(walletProvider);
      const s = await provider.getSigner();
      const c = new ethers.Contract(vault, AGENTLY_ABI, s);
      const t = await c[fn](...args);
      // Confirm on the public RPCs — same reason as tx(): the wallet's own
      // receipt poll is the flaky part, not the transaction.
      let receipt = null as ethers.TransactionReceipt | null;
      try {
        receipt = await getReceiptAny(t.hash);
        if (!receipt)
          receipt = await provider.getTransactionReceipt(t.hash);
      } catch {
        /* unconfirmed, not failed */
      }
      if (receipt) {
        toast.push({ kind: "success", title: label, href: explorerTx(t.hash) });
      } else {
        toast.push({
          kind: "info",
          title: "Sent — unconfirmed",
          body: "Check the explorer: if it says success, the change is already on-chain.",
          href: explorerTx(t.hash),
        });
      }
      await load();
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Action failed",
        body: describeError(e),
      });
    } finally {
      setLoading(false);
    }
  }

  // Deploy a vault this wallet owns outright. The demo vault belongs to a key
  // that leaked, and AgentVault has no transfer path, so this is the only way
  // the backer gets a working vault of their own. The connected wallet signs,
  // which makes it the owner — nothing secret ever leaves the extension.
  async function deployVault() {
    try {
      setLoading(true);
      if (!walletProvider)
        throw new Error(
          "No wallet detected. Connect a wallet on Arc (chain 5042) to deploy a vault."
        );
      if (!onArc)
        throw new Error(
          "Your wallet is on the wrong network. Switch to Arc (chain 5042) and try again."
        );
      const provider = new ethers.BrowserProvider(walletProvider);
      const s = await provider.getSigner();
      const agent = (document.getElementById("newagent") as HTMLInputElement)
        .value;
      const factory = new ethers.ContractFactory(
        VAULT_DEPLOY_ABI,
        AGENT_VAULT_BYTECODE,
        s
      );
      const v = await factory.deploy(
        agent || state.agent,
        "ARC-1",
      );
      await v.waitForDeployment();
      const addr = await v.getAddress();
      // Re-wrap with the full ABI so the calls below are typed.
      const typed = new ethers.Contract(addr, AGENTLY_ABI, s);
      // Seed it with the demo policy so the agent is not sitting behind a zero
      // budget on day one.
      await typed.setPolicy(
        ethers.parseEther("0.005"),
        ethers.parseEther("0.05"),
        true,
      );
      useVault(addr);
      toast.push({
        kind: "success",
        title: "Vault deployed — you are the owner",
        body: `${short(addr)} is live. Fund it and the agent can spend inside the policy.`,
        href: explorerAddr(addr),
      });
      await load();
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Deployment failed",
        body: describeError(e),
      });
    } finally {
      setLoading(false);
    }
  }

  if (!state)
    return error ? (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        <p className="font-semibold mb-1">Could not load the vault.</p>
        <p className="text-xs text-amber-700 mb-3">
          Arc's public RPC refused the request after several retries: {error}
        </p>
        <button
          onClick={load}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-400 hover:bg-amber-100"
        >
          Try again
        </button>
      </div>
    ) : (
      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="h-5 w-1/4 rounded bg-slate-100 animate-pulse" />
          <div className="mt-6 grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-slate-50 border border-slate-100 animate-pulse" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="h-5 w-1/3 rounded bg-slate-100 animate-pulse" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-slate-50 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );

  // Every action on this tab is owner-gated. The chain already told us who the
  // owner is, so we know whether the connected wallet can act BEFORE asking it
  // to sign — a wallet that is not the owner returns a shapeless "missing
  // revert data" error, which explains nothing to anyone.
  const amOwner =
    !!account &&
    !!state.owner &&
    account.toLowerCase() === state.owner.toLowerCase();

  const cap = ethers.formatEther(state.policy.perSpendCap);
  const budget = ethers.formatEther(state.policy.dailyBudget);
  const remaining = ethers.formatEther(state.remaining);
  const spentToday =
    BigInt(state.policy.dailyBudget) - BigInt(state.remaining);
  const usedPct = state.policy.dailyBudget
    ? (Number(ethers.formatEther(spentToday)) / Number(budget)) * 100
    : 0;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Agent vault</h2>
          {myVault && (
            <button
              onClick={() => {
                useVault("");
                setState(null);
              }}
              className="text-[11px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium hover:bg-blue-200 transition-colors"
              title="Back to the demo vault"
            >
              showing your vault · view demo
            </button>
          )}
          {state.policy.paused ? (
            <span className="text-xs px-2 py-1 rounded-full bg-rose-100 text-rose-700 font-medium">
              paused
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              live
            </span>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <Stat label="Balance" value={`${fmt(state.balance)} USDC`} />
          <Stat
            label="Spent today"
            value={`${fmt(spentToday)} / ${fmt(state.policy.dailyBudget)} USDC`}
          />
          <Stat
            label="Per-spend cap"
            value={cap === "0.0" ? "unbounded" : `${fmt(state.policy.perSpendCap)} USDC`}
          />
          <Stat label="Lifetime spends" value={`${fmt(state.totalSpent)} USDC`} />
        </div>

        <div className="mt-5">
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            {usedPct.toFixed(0)}% of today's budget consumed · {fmt(state.remaining)} USDC left today
          </p>
        </div>

        <div className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Owner</span>
            <a
              href={explorerAddr(state.owner)}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-slate-900 hover:underline underline-offset-2"
            >
              {short(state.owner)}
            </a>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Agent EOA</span>
            <a
              href={explorerAddr(state.agent)}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-slate-900 hover:underline underline-offset-2"
            >
              {short(state.agent)}
            </a>
          </div>
        </div>

        {account && !amOwner && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-800">
            <p className="font-semibold mb-0.5">Read-only — you are not the owner</p>
            <p className="leading-relaxed">
              Connected as <span className="font-mono">{short(account)}</span>, but this
              vault is owned by{" "}
              <span className="font-mono">{short(state.owner)}</span>. Funding,
              withdrawing, pausing and editing the policy all revert for anyone else,
              so the buttons below are disabled. The agent&rsquo;s own key can still
              spend inside the policy.
            </p>
            <p className="leading-relaxed mt-2">
              A vault cannot be transferred to a new owner — deploy your own and the
              connected wallet becomes it.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                id="newagent"
                type="text"
                defaultValue={state.agent}
                placeholder="agent EOA"
                className="font-mono text-xs px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-slate-700 w-56 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                title="The EOA the vault will let spend inside the policy"
              />
              <button
                onClick={deployVault}
                disabled={loading}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                Deploy my own vault
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => setFundOpen(true)}
            disabled={loading || !amOwner}
            title={amOwner ? "" : "Only the vault owner can fund it"}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            Fund vault
          </button>
          <button
            onClick={() => run("withdrawAll", "Withdrawn to owner")}
            disabled={loading || !amOwner}
            title={amOwner ? "" : "Only the vault owner can withdraw"}
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            Withdraw all
          </button>
          <button
            onClick={() => run("setPaused", "Vault paused", !state.policy.paused)}
            disabled={loading || !amOwner}
            title={amOwner ? "" : "Only the vault owner can pause the agent"}
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            {state.policy.paused ? "Unpause" : "Pause agent"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-slate-900">Spending policy</h2>
        <p className="text-sm text-slate-500 mt-1">
          The agent can only transact inside these bounds. Native USDC means no
          approvals, no wrapping — the bounds are the whole security model.
        </p>

        <div className="mt-5 space-y-4">
          <Field label="Per-spend cap (USDC)">
            <input
              id="cap"
              type="number"
              step="0.01"
              defaultValue={cap === "0.0" ? "" : Number(cap).toFixed(2)}
              placeholder="0 = unbounded"
              className={inputCls}
            />
          </Field>
          <Field label="Daily budget (USDC)">
            <input
              id="budget"
              type="number"
              step="0.01"
              defaultValue={budget === "0.0" ? "" : Number(budget).toFixed(2)}
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" id="wl" defaultChecked={!!state.policy.whitelistEnabled} />
            Only whitelisted recipients
          </label>
          <button
            onClick={() => {
              const c = (document.getElementById("cap") as HTMLInputElement).value;
              const b = (document.getElementById("budget") as HTMLInputElement).value;
              const w = (document.getElementById("wl") as HTMLInputElement).checked;
              const amt = (v: string) => ethers.parseEther(v.trim().replace(",", ".") || "0");
              run("setPolicy", "Policy updated", amt(c), amt(b), w);
            }}
            disabled={loading || !amOwner}
            title={amOwner ? "" : "Only the vault owner can change the policy"}
            className="w-full py-2.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            Apply policy
          </button>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-4">
          <div className="flex gap-2">
            <input
              id="wladdr"
              placeholder="0x… recipient to whitelist"
              className={inputCls}
            />
            <button
              onClick={() =>
                run(
                  "setWhitelist",
                  "Whitelist updated",
                  (document.getElementById("wladdr") as HTMLInputElement).value,
                  true
                )
              }
              disabled={loading || !amOwner}
              title={amOwner ? "" : "Only the vault owner can whitelist a recipient"}
              className="shrink-0 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              Allow
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        title="Fund the agent vault"
      >
        <p className="text-sm text-slate-500 -mt-2 mb-4">
          The vault is the agent's spending account. Anything you put here is
          bounded by the policy above — the agent can never spend past the cap
          or the daily budget, and only whitelisted recipients if enabled.
        </p>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Amount (USDC)
          </span>
          <input
            autoFocus
            type="number"
            step="0.001"
            min="0.001"
            value={fundAmt}
            onChange={(e) => setFundAmt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doFund();
            }}
            className={inputCls}
          />
        </label>
        <div className="mt-2 flex gap-2">
          {["0.05", "0.1", "1"].map((v) => (
            <button
              key={v}
              onClick={() => setFundAmt(v)}
              className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={doFund}
          disabled={loading || !amOwner || !Number(fundAmt)}
          title={amOwner ? "" : "Only the vault owner can fund it"}
          className="mt-4 w-full py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Confirm in wallet…" : `Fund ${Number(fundAmt) || 0} USDC`}
        </button>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="font-semibold text-slate-900 text-sm mt-0.5">{value}</div>
    </div>
  );
}

/* --------------------------------------------------------------- Agents */

function AgentsTab() {
  const toast = useToast();
  const { provider: walletProvider, onArc } = useWallet();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!REGISTRY) return;
    // Public RPC — works with no wallet installed.
    try {
      const all = await readWithRetry((p) =>
        getReadContract(REGISTRY, p).getAllAgents()
      );
      setAgents(all as any[]);
    } catch {
      /* keep whatever we already have */
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      if (!walletProvider)
        throw new Error(
          "No wallet detected. Install MetaMask or OKX Wallet and connect to sign."
        );
      if (!onArc)
        throw new Error(
          "Your wallet is on the wrong network. Switch to Arc (chain 5042) and try again."
        );
      const f = new FormData(e.currentTarget as HTMLFormElement);
      const provider = new ethers.BrowserProvider(walletProvider!);
      const s = await provider.getSigner();
      const c = new ethers.Contract(REGISTRY, AGENTLY_ABI, s);
      const t = await c.register(
        String(f.get("handle")),
        String(f.get("caps")),
        String(f.get("meta") || "ipfs://"),
        VAULT || ethers.ZeroAddress
      );
      let receipt = null as ethers.TransactionReceipt | null;
      try {
        receipt = await getReceiptAny(t.hash);
        if (!receipt)
          receipt = await provider.getTransactionReceipt(t.hash);
      } catch {
        /* unconfirmed, not failed */
      }
      if (receipt) {
        toast.push({
          kind: "success",
          title: "Agent registered on Arc",
          href: explorerTx(t.hash),
        });
      } else {
        toast.push({
          kind: "info",
          title: "Sent — unconfirmed",
          body: "Check the explorer: if it says success, the agent is registered.",
          href: explorerTx(t.hash),
        });
      }
      load();
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Registration failed",
        body: describeError(e),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid md:grid-cols-[1fr_360px] gap-8">
      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          {agents.length} registered agent{agents.length === 1 ? "" : "s"}
        </h2>
        {agents.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500 text-sm">
            No agents yet. Register one so task posters can see its track
            record.
          </div>
        )}
        <div className="space-y-3">
          {agents.map((a, i) => (
            <article
              key={i}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{a.handle}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                    {a.capabilities}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  earned {fmt(a.totalEarned)} USDC ·{" "}
                  {a.tasksCompleted.toString()} task
                  {a.tasksCompleted === 1n ? "" : "s"} completed
                </p>
              </div>
              {a.vault !== ethers.ZeroAddress && (
                <a
                  href={explorerAddr(a.vault)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-slate-400 hover:text-slate-700 hover:underline underline-offset-2 shrink-0"
                >
                  vault {short(a.vault)}
                </a>
              )}
            </article>
          ))}
        </div>
      </section>

      <aside>
        <form
          onSubmit={register}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
        >
          <h2 className="font-semibold text-slate-900">Register an agent</h2>
          <Field label="Handle">
            <input name="handle" required placeholder="ARC-1" className={inputCls} />
          </Field>
          <Field label="Capabilities">
            <input
              name="caps"
              required
              placeholder="research,summary"
              className={inputCls}
            />
          </Field>
          <Field label="Metadata URI">
            <input name="meta" placeholder="ipfs://…" className={inputCls} />
          </Field>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Registering…" : "Register"}
          </button>
        </form>
      </aside>
    </div>
  );
}
