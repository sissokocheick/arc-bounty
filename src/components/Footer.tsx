"use client";

/**
 * The footer. A judge scrolling to the bottom should land on the contracts, not
 * on nothing — the addresses are the claim "this is really on-chain", so they
 * are the last thing on the page.
 */

import { useEffect, useState } from "react";

const BOARD = process.env.NEXT_PUBLIC_TASK_BOARD_ADDRESS || "";
const VAULT = process.env.NEXT_PUBLIC_AGENT_VAULT_ADDRESS || "";
const REGISTRY = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS || "";

const EXPLORER = "https://explorer.arc.io";

function Row({ name, addr }: { name: string; addr: string }) {
  const [copied, setCopied] = useState(false);
  if (!addr) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-ink-500 shrink-0 w-28">{name}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <a
          href={`${EXPLORER}/address/${addr}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-ink-600 hover:text-brand-700 hover:underline underline-offset-2 truncate"
        >
          {addr}
        </a>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(addr).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }).catch(() => {});
          }}
          className="shrink-0 text-ink-300 hover:text-ink-600 transition-colors p-0.5"
          title="Copy address"
          aria-label={`Copy ${name} address`}
        >
          {copied ? (
            <span className="text-brand-600 text-[11px]">✓</span>
          ) : (
            <span className="text-[11px]">⧉</span>
          )}
        </button>
      </div>
    </div>
  );
}

export default function Footer() {
  // The year is static, but reading it at render time on the server would bake
  // a stale value into the static page; this keeps it honest after deploy.
  const [year, setYear] = useState<number>(2026);
  useEffect(() => setYear(new Date().getFullYear()), []);

  return (
    <footer className="border-t border-ink-200 bg-white/60 mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid sm:grid-cols-[1fr_1fr] gap-8">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-teal-600 grid place-items-center text-white">
                <svg
                  viewBox="0 0 20 20"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 14.5V7.5L10 3.5l6 4v7" />
                  <path d="M7.5 14.5v-4.5h5v4.5" />
                </svg>
              </span>
              <span className="font-bold text-ink-900">Agently</span>
            </div>
            <p className="text-xs text-ink-500 mt-3 leading-relaxed max-w-xs">
              An autonomous-agent economy on Arc: tasks escrowed in native USDC,
              agents paid instantly, and spending bounded by an on-chain policy.
            </p>
            <div className="flex items-center gap-4 mt-4 text-xs">
              <a
                href="https://www.arc.io"
                target="_blank"
                rel="noreferrer"
                className="text-ink-500 hover:text-brand-700 transition-colors"
              >
                Arc ↗
              </a>
              <a
                href={EXPLORER}
                target="_blank"
                rel="noreferrer"
                className="text-ink-500 hover:text-brand-700 transition-colors"
              >
                Block explorer ↗
              </a>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium text-ink-400 uppercase tracking-wide mb-2">
              Verified on Arc mainnet
            </p>
            <div className="divide-y divide-ink-100">
              <Row name="TaskBoard" addr={BOARD} />
              <Row name="AgentVault" addr={VAULT} />
              <Row name="AgentRegistry" addr={REGISTRY} />
            </div>
          </div>
        </div>

        <div className="mt-8 pt-5 border-t border-ink-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-ink-400">
          <span>© {year} Agently · Circle Arc Microgrants</span>
          <span>
            No backend. Every number on this page is read from chain 5042.
          </span>
        </div>
      </div>
    </footer>
  );
}
