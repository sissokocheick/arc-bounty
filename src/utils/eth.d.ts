// Minimal typing for an injected EIP-1193 provider (MetaMask & friends).
// Kept loose on purpose: wallet providers are heterogeneous and strict typing
// here would just force `as any` casts at every call site.
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
      on(event: string, handler: (...args: unknown[]) => void): void;
      removeListener(event: string, handler: (...args: unknown[]) => void): void;
    };
  }
}

export {};
