"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";

// Four keyless Arc endpoints, in the order the app tries them.
const ENDPOINTS = [
  "https://rpc.mainnet.arc.io",
  "https://rpc.blockdaemon.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
  "https://rpc.quicknode.mainnet.arc.io",
];

type Result = {
  url: string;
  status: "pending" | "ok" | "fail";
  http?: number;
  latency?: number;
  block?: string;
  error?: string;
  corsOk?: boolean;
};

/**
 * Diagnostic page. When the dashboard reports "chain is unreachable" this
 * answers the one question that matters: which endpoint does this specific
 * browser actually fail against, and why — DNS, network, or CORS.
 */
export default function Diag() {
  const [results, setResults] = useState<Result[]>(
    ENDPOINTS.map((url) => ({ url, status: "pending" }))
  );
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
    ENDPOINTS.forEach((url, i) => {
      const started = performance.now();
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
      })
        .then(async (r) => {
          const latency = Math.round(performance.now() - started);
          const text = await r.text();
          let block = "—";
          let parseErr = "";
          try {
            const j = JSON.parse(text);
            block = j.result ?? JSON.stringify(j.error ?? j).slice(0, 60);
          } catch {
            parseErr = `body is not JSON (${text.length} bytes)`;
          }
          setResults((prev) =>
            prev.map((row, idx) =>
              idx === i
                ? {
                    ...row,
                    status: "ok",
                    http: r.status,
                    latency,
                    block,
                    error: parseErr,
                    corsOk: r.headers.get("access-control-allow-origin") !== null,
                  }
                : row
            )
          );
        })
        .catch((e: any) => {
          setResults((prev) =>
            prev.map((row, idx) =>
              idx === i
                ? {
                    ...row,
                    status: "fail",
                    error: e?.name ? `${e.name}: ${e.message}` : String(e),
                  }
                : row
            )
          );
        });
    });
  }, []);

  const anyOk = results.some((r) => r.status === "ok");

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-ink-900">
          RPC reachability check
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Each Arc endpoint is pinged directly from this browser. This isolates
          whether the dashboard's "unreachable" error is the RPC node, the
          network, or CORS.
        </p>

        <div className="mt-4 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-600 font-mono">
          this page's origin: {origin || "…"}
        </div>

        <div className="mt-6 space-y-3">
          {results.map((r) => (
            <div
              key={r.url}
              className="rounded-xl border border-ink-200 bg-white p-4 shadow-card"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    r.status === "ok"
                      ? "bg-brand-500"
                      : r.status === "fail"
                      ? "bg-rose-500"
                      : "bg-amber-400 animate-pulse"
                  }`}
                />
                <span className="font-mono text-sm text-ink-900 break-all">
                  {r.url}
                </span>
                <span className="ml-auto text-xs font-medium shrink-0">
                  {r.status === "ok"
                    ? "reachable"
                    : r.status === "fail"
                    ? "failed"
                    : "testing…"}
                </span>
              </div>
              <div className="mt-2 text-xs text-ink-500 grid gap-1">
                {r.http !== undefined && (
                  <div>
                    HTTP {r.http} · {r.latency}ms · CORS header present:{" "}
                    {r.corsOk ? "yes" : "no"} · block {r.block}
                  </div>
                )}
                {r.error && (
                  <div className="text-rose-600 font-mono break-all">
                    {r.error}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          className={`mt-6 rounded-lg border p-4 text-sm ${
            anyOk
              ? "border-brand-200 bg-brand-50 text-brand-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {results.every((r) => r.status === "pending") ? (
            "Waiting for responses…"
          ) : anyOk ? (
            <>
              <span className="font-medium">At least one endpoint is reachable.</span>{" "}
              The dashboard should work. If it still shows "unreachable", the
              failing endpoints above are being tried first and slowing it down.
            </>
          ) : (
            <>
              <span className="font-medium">
                No Arc endpoint is reachable from this browser.
              </span>{" "}
              This is a network-level block, not the dashboard — the requests
              never leave your browser. Common causes: a VPN or corporate
              network, an ad-blocker or privacy extension, a browser that blocks
              the hosts, or your region being blocked at the edge.
              <div className="mt-3 text-xs">
                Try: disable VPN/ad-blocker, or open this page in a different
                browser or on mobile data, and compare.
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
