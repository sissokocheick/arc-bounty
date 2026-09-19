"use client";

/**
 * The account bar. Wallet state comes from the shared context — there is no
 * local copy, so the page and the header can never disagree about who is
 * connected the way they used to.
 */

import { useState } from "react";
import {
  useWallet,
  ARC_NETWORK_PARAMS,
} from "@/components/wallet";
import type { ProviderEntry } from "@/utils/providers";

export default function Header() {
  const w = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState<ProviderEntry[] | null>(null);

  function connect() {
    if (w.providers.length === 0) {
      alert(
        "No wallet detected. Install one (MetaMask, Phantom, OKX) and add the Arc network:\n" +
          "RPC: https://rpc.mainnet.arc.io\nChain ID: 5042\nExplorer: https://explorer.arc.io"
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
    <header className="sticky top-0 z-20 backdrop-blur-md bg-white/80 border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 grid place-items-center text-white font-bold">
            A
          </div>
          <div>
            <div className="font-bold text-slate-900 leading-none">Agently</div>
            <div className="text-[11px] text-slate-500">agent economy on Arc</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {w.connected && !w.onArc && (
            <button
              onClick={() =>
                w.provider?.request({
                  method: "wallet_switchEthereumChain",
                  params: [{ chainId: ARC_NETWORK_PARAMS.chainId }],
                })
              }
              className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium hover:bg-amber-200 transition-colors"
              title="Switch to Arc to sign transactions"
            >
              wrong network — switch
            </button>
          )}
          {w.connected && w.onArc && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              {Number(w.balance).toFixed(2)} USDC
            </span>
          )}
          {w.connected ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-1.5"
                title={w.account}
              >
                {w.account.slice(0, 6)}…{w.account.slice(-4)}
                <span className="text-slate-400 text-[10px]">▾</span>
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-52 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden z-30">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        navigator.clipboard?.writeText(w.account).catch(() => {});
                      }}
                      className="w-full text-left px-3 py-2.5 text-sm text-slate-800 hover:bg-emerald-50 transition-colors"
                    >
                      Copy address
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        w.disconnect();
                      }}
                      className="w-full text-left px-3 py-2.5 text-sm text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={connect}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors"
              >
                Connect wallet
              </button>
              {picker && picker.length > 1 && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setPicker(null)}
                  />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden z-30">
                    <p className="px-3 py-2 text-[11px] text-slate-500 border-b border-slate-100">
                      {picker.length} wallets detected — pick one
                    </p>
                    {picker.map((p) => (
                      <button
                        key={p.rdns}
                        onClick={() => {
                          setPicker(null);
                          w.connectWith(p);
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm text-slate-800 hover:bg-emerald-50 transition-colors"
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
