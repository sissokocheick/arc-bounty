"use client";

/**
 * The account bar. Wallet state comes from the shared context — there is no
 * local copy, so the page and the header can never disagree about who is
 * connected the way they used to.
 */

import { useState } from "react";
import { useWallet, ARC_NETWORK_PARAMS } from "@/components/wallet";
import type { ProviderEntry } from "@/utils/providers";

export default function Header() {
  const w = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState<ProviderEntry[] | null>(null);

  function connect() {
    if (w.providers.length === 0) {
      alert(
        "No wallet detected. Install one (MetaMask, Phantom, OKX) and add the Arc network:\n" +
          "RPC: https://rpc.mainnet.arc.io\nChain ID: 5042\nExplorer: https://explorer.arc.io",
      );
      return;
    }
    if (w.providers.length > 1) {
      setPicker(w.providers);
      return;
    }
    w.connect();
  }

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/75 border-b border-ink-200/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-2.5 group shrink-0">
          <span className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-teal-600 grid place-items-center text-white font-bold shadow-sm shadow-brand-500/30 transition-transform group-hover:scale-105">
            <svg
              viewBox="0 0 20 20"
              className="w-5 h-5"
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
          <span className="leading-none">
            <span className="block font-bold text-ink-900 tracking-tight">
              Agently
            </span>
            <span className="block text-[10px] text-ink-500 mt-0.5 tracking-wide uppercase">
              agent economy on Arc
            </span>
          </span>
        </a>

        <div className="flex items-center gap-2 sm:gap-3">
          {w.connected && !w.onArc && (
            <button
              onClick={() =>
                w.provider?.request({
                  method: "wallet_switchEthereumChain",
                  params: [{ chainId: ARC_NETWORK_PARAMS.chainId }],
                })
              }
              className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium hover:bg-amber-200 transition-colors flex items-center gap-1.5"
              title="Switch to Arc to sign transactions"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              wrong network
            </button>
          )}
          {w.connected && w.onArc && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 font-medium border border-brand-100">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              <span className="tnum">{Number(w.balance).toFixed(2)}</span> USDC
            </span>
          )}
          {w.connected ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="text-xs px-3 py-1.5 rounded-lg bg-ink-100 text-ink-700 hover:bg-ink-200/70 transition-colors flex items-center gap-1.5 font-mono"
                title={w.account}
              >
                {w.account.slice(0, 6)}…{w.account.slice(-4)}
                <span
                  className={`text-ink-400 text-[10px] transition-transform ${
                    menuOpen ? "rotate-180" : ""
                  }`}
                >
                  ▾
                </span>
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-ink-200 bg-white shadow-pop overflow-hidden z-40 animate-[pop_0.14s_ease-out]">
                    <div className="px-3 py-2.5 border-b border-ink-100 bg-ink-50/60">
                      <p className="text-[10px] text-ink-500 uppercase tracking-wide">
                        Connected
                      </p>
                      <p className="font-mono text-xs text-ink-800 mt-0.5 break-all">
                        {w.account}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        navigator.clipboard?.writeText(w.account).catch(() => {});
                      }}
                      className="w-full text-left px-3 py-2.5 text-sm text-ink-800 hover:bg-brand-50 transition-colors flex items-center justify-between gap-2"
                    >
                      Copy address
                      <span className="text-ink-300 text-xs">⧉</span>
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        w.disconnect();
                      }}
                      className="w-full text-left px-3 py-2.5 text-sm text-rose-600 hover:bg-rose-50 transition-colors flex items-center justify-between gap-2"
                    >
                      Disconnect
                      <span className="text-rose-300 text-xs">⏻</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={connect}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-ink-900 text-white hover:bg-ink-800 transition-all shadow-sm hover:shadow-md hover:shadow-ink-900/20 flex items-center gap-2"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                Connect wallet
              </button>
              {picker && picker.length > 1 && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setPicker(null)}
                  />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-ink-200 bg-white shadow-pop overflow-hidden z-40 animate-[pop_0.14s_ease-out]">
                    <p className="px-3 py-2 text-[11px] text-ink-500 border-b border-ink-100">
                      {picker.length} wallets detected — pick one
                    </p>
                    {picker.map((p) => (
                      <button
                        key={p.rdns}
                        onClick={() => {
                          setPicker(null);
                          w.connectWith(p);
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm text-ink-800 hover:bg-brand-50 transition-colors"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
