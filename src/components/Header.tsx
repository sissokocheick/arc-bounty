"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ARC_CHAIN_ID, ARC_RPC } from "@/utils/contract";

export default function Header() {
  const [account, setAccount] = useState<string>("");
  const [chainOk, setChainOk] = useState(false);
  const [balance, setBalance] = useState<string>("");

  async function refresh() {
    if (!window.ethereum) return;
    const provider = new ethers.BrowserProvider(window.ethereum!);
    const network = await provider.getNetwork();
    setChainOk(Number(network.chainId) === ARC_CHAIN_ID);
    const accounts = await provider.listAccounts();
    if (accounts.length) {
      setAccount(accounts[0].address);
      const bal = await provider.getBalance(accounts[0].address);
      setBalance(ethers.formatEther(bal));
    } else {
      setAccount("");
      setBalance("");
    }
  }

  useEffect(() => {
    refresh();
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", refresh);
      window.ethereum.on("chainChanged", refresh);
    }
    return () => {
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener("accountsChanged", refresh);
        window.ethereum.removeListener("chainChanged", refresh);
      }
    };
  }, []);

  async function connect() {
    if (!window.ethereum) {
      alert(
        "No wallet detected. Install MetaMask and add the Arc network:\n" +
          `RPC: ${ARC_RPC}\nChain ID: 5042\nExplorer: https://explorer.arc.io`
      );
      return;
    }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider(window.ethereum!);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== ARC_CHAIN_ID) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x13B2",
              chainName: "Arc",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: [ARC_RPC],
              blockExplorerUrls: ["https://explorer.arc.io"],
            },
          ],
        });
      }
      refresh();
    } catch {
      /* user rejected */
    }
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
            <code className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700">
              {account.slice(0, 6)}…{account.slice(-4)}
            </code>
          ) : (
            <button
              onClick={connect}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors"
            >
              Connect wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
