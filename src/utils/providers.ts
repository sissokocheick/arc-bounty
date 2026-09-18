"use client";

/**
 * Multi-wallet discovery.
 *
 * Extensions fight over `window.ethereum` and the last one to load wins, so a
 * browser with Phantom and MetaMask installed only ever exposes one of them
 * through that global. EIP-6963 fixes this: wallets announce themselves by
 * event instead of by clobbering a shared global, so we can list every
 * installed wallet and let the user pick.
 *
 * Falls back to the legacy injectors for wallets that predate EIP-6963.
 */

export type ProviderEntry = {
  name: string;
  rdns: string;
  provider: any; // EIP-1193
};

const byRdns = new Map<string, ProviderEntry>();
const seenProviders = new WeakSet<object>();

function add(name: string, rdns: string, provider: any) {
  if (!provider || typeof provider.request !== "function") return;
  // The same provider can surface through both EIP-6963 and window.ethereum.
  if (seenProviders.has(provider)) return;
  seenProviders.add(provider);
  byRdns.set(rdns || name, { name, rdns, provider });
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "eip6963:announceProvider",
    ((e: CustomEvent) => {
      const { info, provider } = e.detail ?? {};
      if (info?.rdns && provider) add(info.name, info.rdns, provider);
    }) as EventListener
  );
  // Ask every wallet to announce itself. Responses arrive asynchronously.
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/**
 * Every wallet we can find, deduplicated. Safe to call repeatedly — late
 * announcements land in the listener above and show up on the next call.
 */
export function getProviders(): ProviderEntry[] {
  const w = window as any;

  // Legacy injectors, for wallets too old to announce.
  add("MetaMask", "io.metamask", w.metaMask);
  add("Phantom", "app.phantom", w.phantom?.ethereum);
  add("Rabby", "io.rabby", w.rabby);
  add("Coinbase Wallet", "com.coinbase.wallet", w.coinbaseWalletExtension);
  add("OKX Wallet", "com.okex.wallet", w.okxwallet);

  // Whatever won window.ethereum, if nothing above already claimed it.
  const e = w.ethereum;
  if (e && !seenProviders.has(e)) {
    add(
      e.isPhantom ? "Phantom"
        : e.isMetaMask ? "MetaMask"
        : e.isRabby ? "Rabby"
        : e.isCoinbaseWallet ? "Coinbase Wallet"
        : "Browser wallet",
      "injected.default",
      e
    );
  }

  return [...byRdns.values()];
}

// The wallet the user picked in the header. Kept here rather than in React
// state so the transaction signing path in the pages can reach it without
// prop-drilling. Falls back to window.ethereum for a single-wallet browser.
let chosen: ProviderEntry | null = null;

export function setChosenProvider(entry: ProviderEntry | null) {
  chosen = entry;
}

export function getEip1193(): any | null {
  if (typeof window === "undefined") return null;
  return chosen?.provider ?? (window as any).ethereum ?? null;
}
