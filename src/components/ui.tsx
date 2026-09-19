"use client";

/**
 * Toasts and modal primitives.
 *
 * The dashboard used to signal every transaction outcome with native alert()
 * and collect input with window.prompt(). Both block the main thread, both
 * look like a debugging tool, and neither can be styled — so a project that is
 * otherwise a real product ended its demo with an operating-system dialog.
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

/* --------------------------------------------------------------- Toasts */

type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  href?: string;
};

type ToastContextValue = {
  push: (t: Omit<Toast, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { ...t, id }]);
    // Errors stay up longer: a failure needs the user to read the reason, a
    // success just needs to be noticed.
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, t.kind === "error" ? 9000 : 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 w-[min(380px,calc(100vw-2rem))]">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() =>
            setToasts((prev) => prev.filter((x) => x.id !== t.id))
          } />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const palette = {
    success: "border-brand-200 bg-brand-50/95 text-brand-900",
    error: "border-rose-200 bg-rose-50/95 text-rose-900",
    info: "border-ink-200 bg-white/95 text-ink-900",
  }[toast.kind];

  const glyph = {
    success: "✓",
    error: "!",
    info: "i",
  }[toast.kind];

  const glyphPalette = {
    success: "bg-brand-500 text-white",
    error: "bg-rose-500 text-white",
    info: "bg-ink-400 text-white",
  }[toast.kind];

  return (
    <div
      className={`pointer-events-auto rounded-xl border ${palette} shadow-pop p-3.5 flex gap-3 animate-[slidein_0.18s_ease-out]`}
    >
      <span
        className={`shrink-0 w-5 h-5 rounded-full ${glyphPalette} grid place-items-center text-[11px] font-bold mt-0.5`}
      >
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-tight">{toast.title}</div>
        {toast.body && (
          <div className="text-xs mt-1 opacity-80 break-words whitespace-pre-wrap">
            {toast.body}
          </div>
        )}
        {toast.href && (
          <a
            href={toast.href}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-1.5 text-xs font-medium underline underline-offset-2 hover:opacity-70"
          >
            View on explorer ↗
          </a>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 text-xs opacity-40 hover:opacity-80 px-1"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

/* ---------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  // Close on Escape so a modal is never a dead end.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-ink-200 bg-white shadow-pop p-6 animate-[pop_0.15s_ease-out]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="font-bold text-ink-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-ink-300 hover:text-ink-700 -mt-1 -mr-1 px-1 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Skeleton */

// What a loading section looks like before the RPC answers. Better than a
// bare "Loading…" string: it reserves the space, so the page never jumps.
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"
        >
          <div className="h-3.5 w-1/3 rounded bg-ink-100 animate-pulse" />
          <div className="mt-3 h-3 w-2/3 rounded bg-ink-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
