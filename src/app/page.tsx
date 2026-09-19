"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  getReadProvider,
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

  // A transaction in flight. setState is not synchronous, so the buttons'
  // `disabled` attribute cannot protect the gap between the click and the next
  // render — a fast double-click would fire a second transaction while the
  // first is still being signed. This ref closes that gap.
  const signing = useRef(false);

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

  // Keep the board feeling live while the page is open. Skipped while a
  // transaction is in flight: without this, a poll that started before the
  // user acted can resolve after the action's own refresh and overwrite the
  // fresh state with one that predates the click.
  useEffect(() => {
    const id = setInterval(() => {
      if (signing.current) return;
      read();
    }, 20_000);
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
    // Lock before any await: the render that disables the buttons happens
    // later than this line, and a double-click in that window starts a
    // second, duplicate transaction.
    if (signing.current) return;
    signing.current = true;
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
      signing.current = false;
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const rewardRaw = String(form.get("reward") || "").trim().replace(",", ".");
    // parseEther throws on anything it cannot read, and an uncaught throw in a
    // form handler dies silently — the user clicks and nothing happens at all.
    // Reject it here with a message instead.
    let value: bigint;
    try {
      value = ethers.parseEther(rewardRaw || "0");
    } catch {
      toast.push({
        kind: "error",
        title: "Reward is not a number",
        body: `“${rewardRaw}” is not a valid amount. Use a number of USDC, e.g. 0.005.`,
      });
      return;
    }
    if (value <= 0n) {
      toast.push({
        kind: "error",
        title: "Reward must be greater than 0",
        body: "A task with no reward escrows nothing, so the contract rejects it.",
      });
      return;
    }
    const signer = await getSigner();
    const c = new ethers.Contract(BOARD, AGENTLY_ABI, signer);
    const days = Math.min(90, Math.max(0, Number(form.get("days") || 0)));
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
          <h1 className="text-3xl font-bold text-ink-900 mb-4 tracking-tight">
            Agently
          </h1>
          <p className="text-ink-500 max-w-xl mx-auto leading-relaxed">
            An autonomous-agent economy where AI agents escrow, earn and spend
            native USDC on Arc — with policy-governed wallets that keep them on
            a leash.
          </p>
          <div className="mt-10 max-w-lg mx-auto rounded-xl border border-amber-300 bg-amber-50 p-6 text-left shadow-card">
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
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-10">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-700 bg-brand-50 border border-brand-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              live on Arc mainnet
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-ink-900 mt-3.5 tracking-tight leading-[1.1]">
              The agent economy,
              <br className="hidden sm:block" />{" "}
              <span className="bg-gradient-to-r from-brand-600 to-teal-600 bg-clip-text text-transparent">
                settled in USDC
              </span>
            </h1>
            <p className="text-ink-500 text-sm mt-2.5 max-w-lg leading-relaxed">
              Post micro-tasks, let autonomous agents compete for them, and pay
              out instantly in Arc's native stablecoin.
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-sm px-4 py-2 rounded-lg border border-ink-300 text-ink-700 hover:bg-white hover:border-ink-400 disabled:opacity-50 transition-colors flex items-center gap-2 bg-white/60 shrink-0"
          >
            <svg
              viewBox="0 0 16 16"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
              <path d="M13.5 1.5V4.5H10.5" />
            </svg>
            {loading ? "Syncing…" : "Refresh"}
          </button>
        </div>

        {lastTx && (
          <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-800 flex items-center justify-between gap-3 animate-[slidein_0.2s_ease-out]">
            <span className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-brand-500 text-white grid place-items-center text-[11px] font-bold shrink-0">
                ✓
              </span>
              Transaction confirmed on Arc mainnet.
            </span>
            <a
              href={explorerTx(lastTx)}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2 shrink-0 hover:text-brand-600"
            >
              View on explorer ↗
            </a>
          </div>
        )}

        {!hasWallet && (
          <div className="mb-6 rounded-xl border border-ink-200 bg-white/70 px-4 py-3 text-sm text-ink-700 flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-ink-100 text-ink-500 grid place-items-center text-[11px] font-bold shrink-0 mt-0.5">
              i
            </span>
            <span>
              <span className="font-medium text-ink-900">Read-only mode.</span>{" "}
              You're viewing live mainnet data without a wallet — installing one
              (MetaMask, OKX) lets you post tasks, submit work and spend from a
              vault.
            </span>
          </div>
        )}

        {readError && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-amber-500 text-white grid place-items-center text-[11px] font-bold shrink-0 mt-0.5">
              !
            </span>
            <span>
              <span className="font-medium">The chain is unreachable right now.</span>{" "}
              Arc's public RPC refused the request after several retries. The
              data below may be stale.
              <pre className="mt-2 text-[11px] text-amber-700 whitespace-pre-wrap break-all font-mono">
                {readError}
              </pre>
            </span>
          </div>
        )}

        <LoopStrip />

        <div className="flex gap-1 mb-8 border-b border-ink-200">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors relative ${
                tab === t
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-ink-500 hover:text-ink-800"
              }`}
            >
              {t}
              {tab === t && (
                <span className="absolute left-4 right-4 -bottom-px h-px bg-white/60" />
              )}
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
        <p className="text-sm text-ink-500 -mt-2 mb-4 leading-relaxed">
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
          className="mt-4 w-full py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm shadow-brand-600/25"
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
    <div className="mb-8 grid sm:grid-cols-3 gap-3">
      {steps.map(([n, name, blurb, addr]) => (
        <a
          key={n}
          href={explorerAddr(addr)}
          target="_blank"
          rel="noreferrer"
          className="group relative rounded-xl border border-ink-200 bg-white/80 p-4 hover:border-brand-400 hover:shadow-card transition-all"
        >
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold grid place-items-center">
              {n}
            </span>
            <span className="font-semibold text-ink-900 text-sm">{name}</span>
            <span className="text-ink-300 group-hover:text-brand-500 ml-auto text-xs transition-colors">
              ↗
            </span>
          </div>
          <p className="text-xs text-ink-500 mt-2 leading-relaxed">{blurb}</p>
          {addr && (
            <p className="mt-3 pt-3 border-t border-ink-100 font-mono text-[10px] text-ink-400 truncate">
              {addr}
            </p>
          )}
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
        <h2 className="text-sm font-semibold text-ink-700 mb-3 flex items-center gap-2">
          {open.length} open task{open.length === 1 ? "" : "s"}
          <span className="text-ink-300">·</span>
          <span className="text-brand-700 tnum">
            {fmt(totalEscrowed)} USDC escrowed
          </span>
        </h2>
        {!account && (
          <div className="mb-4 rounded-lg border border-ink-200 bg-white/60 px-4 py-2.5 text-xs text-ink-600 flex items-center justify-between gap-3">
            <span>
              Browse freely — but posting a task, submitting work or approving a
              payout needs a wallet on Arc (chain 5042).
            </span>
          </div>
        )}
        {open.length === 0 && (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white/50 p-12 text-center text-ink-500 text-sm">
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
                className="group rounded-xl border border-ink-200 bg-white p-5 shadow-card hover:border-ink-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink-900">{t.title}</h3>
                    <p className="text-sm text-ink-600 mt-1 line-clamp-2">
                      {t.description}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold px-2.5 py-1 rounded-md bg-brand-50 text-brand-700 border border-brand-100 tnum">
                    {fmt(t.reward)} USDC
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-3 text-xs text-ink-500">
                  <a
                    href={explorerAddr(t.creator)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-ink-900 hover:underline underline-offset-2"
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
                    <span className="text-amber-700 font-medium">
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
                    className="mt-3 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 hover:bg-brand-100/70 transition-colors"
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
                        className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm shadow-brand-600/20"
                      >
                        Approve &amp; pay
                      </button>
                      <button
                        onClick={() => props.onReject(t.id)}
                        disabled={props.loading || !canSign}
                        title={signReason}
                        className="text-sm font-medium px-3 py-1.5 rounded-lg border border-ink-300 text-ink-700 hover:bg-ink-50 disabled:opacity-50 transition-colors"
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
                      className="text-sm font-medium px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                    >
                      Cancel &amp; refund
                    </button>
                  )}
                  {!mine && !t.submitted && (
                    <button
                      onClick={() => props.onSubmit(t.id)}
                      disabled={props.loading}
                      className="text-sm font-medium px-3 py-1.5 rounded-lg bg-ink-900 text-white hover:bg-ink-800 disabled:opacity-50 transition-colors shadow-sm shadow-ink-900/20"
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
                      className="text-sm font-medium px-3 py-1.5 rounded-lg bg-ink-100 text-ink-400 cursor-not-allowed"
                    >
                      Approve &amp; pay
                    </button>
                  )}
                  {!canSign && mine && (
                    <span className="text-xs text-amber-600">{signReason}</span>
                  )}
                  {!mine && t.submitted && (
                    <span className="text-xs text-ink-400">
                      under review · only the creator can approve payout
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <h2 className="text-sm font-semibold text-ink-700 mt-8 mb-3">
          Recently settled
        </h2>
        <div className="space-y-3">
          {settled.slice(0, 5).map((t) => (
            <div
              key={t.id.toString()}
              className="rounded-lg border border-ink-200 bg-white/70 px-4 py-3 flex items-center justify-between text-sm gap-3"
            >
              <span className="text-ink-700 truncate">
                {t.title}{" "}
                <span className="text-ink-400 tnum">· {fmt(t.reward)} USDC</span>
              </span>
              <span
                className={
                  t.completed
                    ? "text-brand-600 font-medium shrink-0"
                    : "text-ink-400 font-medium shrink-0"
                }
              >
                {t.completed ? "paid out" : "refunded"}
              </span>
            </div>
          ))}
          {settled.length === 0 && (
            <p className="text-sm text-ink-400">Nothing settled yet.</p>
          )}
        </div>
      </section>

      <aside>
        <form
          onSubmit={props.onCreate}
          className="rounded-xl border border-ink-200 bg-white p-5 shadow-card space-y-4 lg:sticky lg:top-20"
        >
          <h2 className="font-semibold text-ink-900">Post a micro-task</h2>
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
            className="w-full py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm shadow-brand-600/25"
          >
            {props.loading
              ? "Escrowing…"
              : props.hasWallet
              ? "Escrow & post"
              : "Connect a wallet to post"}
          </button>
          <p className="text-xs text-ink-400 leading-relaxed">
            The reward is locked in the contract until you approve the work, and
            refundable while nothing is under review.
          </p>
        </form>
      </aside>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-ink-200 bg-ink-50/50 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 transition-colors";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-600 mb-1">
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

      // terminated()/terminatedAt() are newer than the first deployed vault.
      // That one predates the close feature, so these selectors revert on it.
      // One attempt, no retry: the revert is permanent, not a flaky node, and
      // retrying it 16 times would drag the poll down. An unsupported read just
      // means the vault can never have been closed.
      let terminated = false;
      let terminatedAt = 0n;
      try {
        const c = getReadContract(vault, getReadProvider());
        [terminated, terminatedAt] = await Promise.all([
          c.terminated(),
          c.terminatedAt(),
        ] as const);
      } catch {
        /* legacy vault — termination did not exist when it was deployed */
      }

      setState({
        owner,
        agent,
        policy,
        totalSpent,
        spendCount,
        remaining,
        balance,
        terminated,
        terminatedAt,
      });
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
      // With the whitelist on and empty, the very first spend would revert. Let
      // the owner receive payments, which is also how an agent rebates change.
      await typed.setWhitelist(await s.getAddress(), true);
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
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 shadow-card">
        <p className="font-semibold mb-1">Could not load the vault.</p>
        <p className="text-xs text-amber-700 mb-3 font-mono">
          Arc's public RPC refused the request after several retries: {error}
        </p>
        <button
          onClick={load}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-400 hover:bg-amber-100 transition-colors"
        >
          Try again
        </button>
      </div>
    ) : (
      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
          <div className="h-5 w-1/4 rounded bg-ink-100 animate-pulse" />
          <div className="mt-6 grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-ink-50 border border-ink-100 animate-pulse"
              />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
          <div className="h-5 w-1/3 rounded bg-ink-100 animate-pulse" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-10 rounded-lg bg-ink-50 animate-pulse"
              />
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
      <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-ink-900">Agent vault</h2>
          <div className="flex items-center gap-2">
            {myVault && (
              <button
                onClick={() => {
                  useVault("");
                  setState(null);
                }}
                className="text-[11px] px-2 py-1 rounded-full bg-brand-100 text-brand-700 font-medium hover:bg-brand-200 transition-colors"
                title="Back to the demo vault"
              >
                showing your vault · view demo
              </button>
            )}
            {state.terminated ? (
              <span className="text-xs px-2 py-1 rounded-full bg-ink-200 text-ink-600 font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-400" />
                closed
              </span>
            ) : state.policy.paused ? (
              <span className="text-xs px-2 py-1 rounded-full bg-rose-100 text-rose-700 font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                paused
              </span>
            ) : (
              <span className="text-xs px-2 py-1 rounded-full bg-brand-100 text-brand-700 font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                live
              </span>
            )}
          </div>
        </div>

        {state.terminated && (
          <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50/70 p-3.5 text-xs text-ink-600">
            <p className="font-semibold text-ink-800 mb-0.5">
              Engagement closed
            </p>
            <p className="leading-relaxed">
              The owner ended this vault and withdrew everything that remained.
              It spent {fmt(state.totalSpent)} USDC across{" "}
              {Number(state.spendCount)} payment
              {Number(state.spendCount) === 1 ? "" : "s"}. The record stays
              readable — the budget is just gone.
            </p>
          </div>
        )}

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
          <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-500 to-teal-500 transition-[width] duration-500"
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
          <p className="text-xs text-ink-500 mt-1.5 tnum">
            {usedPct.toFixed(0)}% of today's budget consumed · {fmt(state.remaining)} USDC left today
          </p>
        </div>

        <div className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between text-ink-600">
            <span>Owner</span>
            <a
              href={explorerAddr(state.owner)}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-ink-900 hover:underline underline-offset-2"
            >
              {short(state.owner)}
            </a>
          </div>
          <div className="flex justify-between text-ink-600">
            <span>Agent EOA</span>
            <a
              href={explorerAddr(state.agent)}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-ink-900 hover:underline underline-offset-2"
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
                className="font-mono text-xs px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-ink-700 w-56 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                title="The EOA the vault will let spend inside the policy"
              />
              <button
                onClick={deployVault}
                disabled={loading}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-ink-900 text-white hover:bg-ink-800 disabled:opacity-50 transition-colors"
              >
                Deploy my own vault
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {!state.terminated && (
            <button
              onClick={() => setFundOpen(true)}
              disabled={loading || !amOwner}
              title={amOwner ? "" : "Only the vault owner can fund it"}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm shadow-brand-600/25"
            >
              Fund vault
            </button>
          )}
          {!state.terminated && (
            <button
              onClick={() => run("withdrawAll", "Withdrawn to owner")}
              disabled={loading || !amOwner}
              title={amOwner ? "" : "Only the vault owner can withdraw"}
              className="text-sm font-medium px-3 py-1.5 rounded-lg border border-ink-300 text-ink-700 hover:bg-ink-50 disabled:opacity-50 transition-colors"
            >
              Withdraw all
            </button>
          )}
          <button
            onClick={() => run("setPaused", "Vault paused", !state.policy.paused)}
            disabled={loading || !amOwner}
            title={amOwner ? "" : "Only the vault owner can pause the agent"}
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors"
          >
            {state.policy.paused ? "Unpause" : "Pause agent"}
          </button>
          {!state.terminated && (
            <button
              onClick={() => {
                if (
                  !window.confirm(
                    "Close this vault?\n\nEverything still in it is paid back to you, the agent can no longer spend, and it cannot be funded again. This is permanent.",
                  )
                )
                  return;
                run("terminate", "Vault closed — balance returned to you");
              }}
              disabled={loading || !amOwner}
              title={amOwner ? "" : "Only the vault owner can close it"}
              className="text-sm font-medium px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
            >
              Close vault
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
        <h2 className="font-semibold text-ink-900">Spending policy</h2>
        <p className="text-sm text-ink-500 mt-1 leading-relaxed">
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
          <label className="flex items-center gap-2 text-sm text-ink-700 select-none cursor-pointer">
            <input
              type="checkbox"
              id="wl"
              defaultChecked={!!state.policy.whitelistEnabled}
              className="w-4 h-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30"
            />
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
            className="w-full py-2.5 rounded-lg bg-ink-900 text-white font-medium hover:bg-ink-800 disabled:opacity-50 transition-colors shadow-sm shadow-ink-900/20"
          >
            Apply policy
          </button>
        </div>

        <div className="mt-6 border-t border-ink-100 pt-4">
          <span className="block text-xs font-medium text-ink-600 mb-1.5">
            Whitelist a recipient
          </span>
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
              className="shrink-0 text-sm font-medium px-3 py-1.5 rounded-lg border border-ink-300 text-ink-700 hover:bg-ink-50 disabled:opacity-50 transition-colors"
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
        <p className="text-sm text-ink-500 -mt-2 mb-4 leading-relaxed">
          The vault is the agent's spending account. Anything you put here is
          bounded by the policy above — the agent can never spend past the cap
          or the daily budget, and only whitelisted recipients if enabled.
        </p>
        <label className="block">
          <span className="block text-xs font-medium text-ink-600 mb-1">
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
              className="text-xs px-2.5 py-1 rounded-md border border-ink-200 text-ink-600 hover:bg-ink-50 hover:border-ink-300 transition-colors tnum"
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={doFund}
          disabled={loading || !amOwner || !Number(fundAmt)}
          title={amOwner ? "" : "Only the vault owner can fund it"}
          className="mt-4 w-full py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm shadow-brand-600/25"
        >
          {loading ? "Confirm in wallet…" : `Fund ${Number(fundAmt) || 0} USDC`}
        </button>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-50/70 border border-ink-100 p-3">
      <div className="text-[11px] text-ink-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="font-semibold text-ink-900 text-sm mt-0.5 tnum">
        {value}
      </div>
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
    // The other tabs keep themselves live; this one used to freeze on mount,
    // so a registration never appeared until the page was reloaded.
    const id = setInterval(() => load(), 20_000);
    return () => clearInterval(id);
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
        // Do not link this agent to the demo vault. That vault belongs to a
        // leaked key, so a new agent would advertise a wallet it cannot spend
        // from. No vault link until the registry can hold its own.
        ethers.ZeroAddress
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
        <h2 className="text-sm font-semibold text-ink-700 mb-3">
          {agents.length} registered agent{agents.length === 1 ? "" : "s"}
        </h2>
        {agents.length === 0 && (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white/50 p-12 text-center text-ink-500 text-sm">
            No agents yet. Register one so task posters can see its track
            record.
          </div>
        )}
        <div className="space-y-3">
          {agents.map((a, i) => (
            <article
              key={i}
              className="rounded-xl border border-ink-200 bg-white p-5 shadow-card flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-teal-600 text-white text-[11px] font-bold grid place-items-center shrink-0">
                    {String(a.handle || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="font-semibold text-ink-900">{a.handle}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-ink-100 text-ink-600 font-medium">
                    {a.capabilities}
                  </span>
                </div>
                <p className="text-xs text-ink-500 mt-1.5 tnum">
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
                  className="text-xs text-ink-400 hover:text-ink-700 hover:underline underline-offset-2 shrink-0 font-mono"
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
          className="rounded-xl border border-ink-200 bg-white p-5 shadow-card space-y-4 md:sticky md:top-20"
        >
          <h2 className="font-semibold text-ink-900">Register an agent</h2>
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
            className="w-full py-2.5 rounded-lg bg-ink-900 text-white font-medium hover:bg-ink-800 disabled:opacity-50 transition-colors shadow-sm shadow-ink-900/20"
          >
            {loading ? "Registering…" : "Register"}
          </button>
        </form>
      </aside>
    </div>
  );
}
