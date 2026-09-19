"use client";

/**
 * The single source of truth for the connected wallet.
 *
 * There used to be two: Header kept its own copy and page.tsx kept another,
 * read exactly once on mount with no listeners. So a user who clicked Connect
 * after the page loaded — the normal order of things — was known to the Header
 * and invisible to the page. Every "mine" check on a task card was false, and
 * the Approve & pay buttons never rendered at all.
 *
 * Now both read from here, and this reacts to the wallet instead of sampling
 * it once: account changes, chain switches and an in-wallet connection all
 * propagate.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ethers } from "ethers";
import { ARC_CHAIN_ID } from "@/utils/contract";
import {
  getProviders,
  setChosenProvider,
  type ProviderEntry,
} from "@/utils/providers";

export const ARC_NETWORK_PARAMS = {
  chainId: "0x13B2",
  chainName: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.arc.io"],
  blockExplorerUrls: ["https://explorer.arc.io"],
};

type Wallet = {
  /** Raw EIP-1193 handle — use this to build a signer, never to read chain data. */
  provider: any | null;
  account: string;
  chainId: number | null;
  balance: string; // native USDC, formatted
  /** A wallet extension exists at all, even before connecting. */
  hasWallet: boolean;
  connected: boolean;
  onArc: boolean;
  connect: () => void;
  connectWith: (entry: ProviderEntry) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Detected wallets, when a choice has to be made. */
  providers: ProviderEntry[];
};

const WalletContext = createContext<Wallet | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<any | null>(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState("");
  const [providers, setProviders] = useState<ProviderEntry[]>([]);

  // The poller needs the current handle without re-subscribing on every change.
  const ref = useRef<any | null>(null);
  ref.current = provider;

  // Ask the wallet who it is holding and which chain it is on. Every failure is
  // tolerated: a wallet that won't answer should blank the state, not crash the
  // page.
  const refresh = useCallback(async () => {
    const p = ref.current;
    if (!p) {
      setAccount("");
      setBalance("");
      setChainId(null);
      return;
    }
    try {
      const b = new ethers.BrowserProvider(p);
      const net = await b.getNetwork();
      setChainId(Number(net.chainId));
      const accs = await b.listAccounts();
      if (accs.length) {
        setAccount(accs[0].address);
        const bal = await b.getBalance(accs[0].address);
        setBalance(ethers.formatEther(bal));
      } else {
        setAccount("");
        setBalance("");
      }
    } catch {
      setAccount("");
      setBalance("");
    }
  }, []);

  // Pick the only installed wallet automatically — no prompt, the user still
  // has to click Connect before anything can be signed. Several installed, and
  // we wait for them to choose.
  useEffect(() => {
    const found = getProviders();
    setProviders(found);
    if (found.length === 1) {
      setChosenProvider(found[0]);
      setProvider(found[0].provider);
    }
  }, []);

  // Wallets announce late under EIP-6963; re-check shortly after load so one
  // that was still installing at mount time is still noticed.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const found = getProviders();
      setProviders(found);
      if (!ref.current && found.length === 1) {
        setChosenProvider(found[0]);
        setProvider(found[0].provider);
      }
    }, 1200);
    return () => window.clearTimeout(t);
  }, []);

  // React to the wallet instead of sampling it once. accountsChanged covers a
  // connect, a disconnect and an account switch; chainChanged covers a network
  // hop back onto Arc.
  useEffect(() => {
    if (!provider) return;
    refresh();
    const onAccount = () => refresh();
    const onChain = () => refresh();
    provider.on?.("accountsChanged", onAccount);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccount);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [provider, refresh]);

  // Safety net: some wallets emit nothing at all, and connecting directly in
  // the extension never reaches us either. A slow poll closes that gap.
  useEffect(() => {
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const connectWith = useCallback(
    async (entry: ProviderEntry) => {
      try {
        await entry.provider.request({ method: "eth_requestAccounts" });
        const b = new ethers.BrowserProvider(entry.provider);
        const net = await b.getNetwork();
        if (Number(net.chainId) !== ARC_CHAIN_ID) {
          await entry.provider.request({
            method: "wallet_addEthereumChain",
            params: [ARC_NETWORK_PARAMS],
          });
        }
        setChosenProvider(entry);
        setProvider(entry.provider);
      } catch {
        /* the user dismissed the prompt — stay disconnected */
      }
    },
    []
  );

  const connect = useCallback(() => {
    const found = getProviders();
    if (found.length === 0) return;
    // One wallet: go straight to it. Several: the Header shows a picker.
    if (found.length > 1) {
      setProviders(found);
      return;
    }
    connectWith(found[0]);
  }, [connectWith]);

  const disconnect = useCallback(async () => {
    try {
      // EIP-2255. Not every wallet implements it; forget locally either way.
      await ref.current?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      /* the wallet keeps its own permissions; the app forgets regardless */
    }
    setChosenProvider(null);
    setProvider(null);
    setAccount("");
    setBalance("");
    setChainId(null);
  }, []);

  const value: Wallet = {
    provider,
    account,
    chainId,
    balance,
    hasWallet: providers.length > 0,
    connected: !!account,
    onArc: chainId === ARC_CHAIN_ID,
    connect,
    connectWith,
    disconnect,
    providers,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): Wallet {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
