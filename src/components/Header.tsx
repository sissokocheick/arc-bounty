"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ARC_CHAIN_ID, ARC_RPC } from "@/utils/contract";
import { getProviders, getEip1193, setChosenProvider, type ProviderEntry } from "@/utils/providers";

const ARC_NETWORK_PARAMS = {
  chainId: "0x13B2",
  chainName: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: [ARC_RPC],
  blockExplorerUrls: ["https://explorer.arc.io"],
};

export default function Header() {
  const [account, setAccount] = useState<string>("");
  const [chainOk, setChainOk] = useState(false);
  const [balance, setBalance] = useState<string>("");
  const [picker, setPicker] = useState<ProviderEntry[] | null>(null);
  const [provider, setProvider] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function forgetWallet() {
    setChosenProvider(null);
    setProvider(null);
    setAccount("");
    setBalance("");
    setChainOk(false);
  }

  useEffect(() => {
    // Pick the only installed wallet automatically, without prompting — the
    // user still has to click Connect before anything can be signed.
    const found = getProviders();
    if (found.length === 1) setChosenProvider(found[0]);
  }, []);

  async function refresh() {
    if (!provider) return;
    const p = new ethers.BrowserProvider(provider);
    const network = await p.getNetwork();
    setChainOk(Number(network.chainId) === ARC_CHAIN_ID);
    const accounts = await p.listAccounts();
    if (accounts.length) {
      setAccount(accounts[0].address);
      const bal = await p.getBalance(accounts[0].address);
      setBalance(ethers.formatEther(bal));
    } else {
      setAccount("");
      setBalance("");
    }
  }

  useEffect(() => {
    refresh();
    if (provider) {
      provider.on("accountsChanged", refresh);
      provider.on("chainChanged", refresh);
    }
    return () => {
      if (provider?.removeListener) {
        provider.removeListener("accountsChanged", refresh);
        provider.removeListener("chainChanged", refresh);
      }
    };
  }, [provider]);

  async function connectWith(entry: ProviderEntry) {
    setPicker(null);
    try {
      await entry.provider.request({ method: "eth_requestAccounts" });
      const p = new ethers.BrowserProvider(entry.provider);
      const network = await p.getNetwork();
      if (Number(network.chainId) !== ARC_CHAIN_ID) {
        await entry.provider.request({
          method: "wallet_addEthereumChain",
          params: [ARC_NETWORK_PARAMS],
        });
      }
      setChosenProvider(entry);
      setProvider(entry.provider);
    } catch {
      /* user rejected */
    }
  }

  function connect() {
    const providers = getProviders();
    if (providers.length === 0) {
      alert(
        "No wallet detected. Install one (MetaMask, Phantom, Rabby) and add the Arc network:\n" +
          `RPC: ${ARC_RPC}\nChain ID: 5042\nExplorer: https://explorer.arc.io`
      );
      return;
    }
    // Only one wallet installed: connect straight to it. Several: let the user
    // choose, because we cannot guess which one holds their Arc USDC.
    if (providers.length > 1) {
      setPicker(providers);
      return;
    }
    connectWith(providers[0]);
  }

  function copyAddress() {
    setMenuOpen(false);
    navigator.clipboard?.writeText(account).catch(() => {});
  }

  function switchWallet() {
    setMenuOpen(false);
    forgetWallet();
    connect();
  }

  async function disconnect() {
    setMenuOpen(false);
    try {
      // EIP-2255. Not every wallet implements it; the fallback below still
      // clears the app's side of the connection.
      await provider?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      /* wallet keeps its own permissions; we forget the account locally */
    }
    forgetWallet();
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
          {account && !chainOk && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
              wrong network
            </span>
          )}
          {account && chainOk && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              {Number(balance).toFixed(2)} USDC
            </span>
          )}
          {account ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-1.5"
                title={account}
              >
                {account.slice(0, 6)}…{account.slice(-4)}
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
                      onClick={copyAddress}
                      className="w-full text-left px-3 py-2.5 text-sm text-slate-800 hover:bg-emerald-50 transition-colors"
                    >
                      Copy address
                    </button>
                    <button
                      onClick={switchWallet}
                      className="w-full text-left px-3 py-2.5 text-sm text-slate-800 hover:bg-emerald-50 transition-colors"
                    >
                      Switch wallet
                    </button>
                    <button
                      onClick={disconnect}
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
                        onClick={() => connectWith(p)}
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
