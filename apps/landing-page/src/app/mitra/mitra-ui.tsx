"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ------------------------------ Ikon ------------------------------ */

type IconName =
  | "home"
  | "wallet"
  | "bank"
  | "users"
  | "coins"
  | "user"
  | "arrowUp"
  | "arrowDown"
  | "copy"
  | "check"
  | "share"
  | "logout"
  | "shield"
  | "clock"
  | "alert"
  | "info"
  | "plus"
  | "lock"
  | "external"
  | "refresh"
  | "chevron";

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9M10 19v-5h4v5" />,
  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z" />
      <path d="M16 13.5h.01" />
    </>
  ),
  bank: <path d="M3 9.5 12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18M3 9.5h18" />,
  users: (
    <>
      <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 6.5M18 13.5a6 6 0 0 1 3.5 6" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="9.5" cy="7" rx="6" ry="3" />
      <path d="M3.5 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7M15.5 10.5c3 .1 5 1.3 5 2.8v4.2c0 1.7-2.7 3-6 3-2.3 0-4.3-.6-5.3-1.6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  check: <path d="m5 13 4 4 10-10" />,
  share: <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />,
  logout: <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9" />,
  shield: <path d="M12 3 5 6v5.5c0 4.3 2.9 8 7 9.5 4.1-1.5 7-5.2 7-9.5V6l-7-3ZM9 12l2.2 2.2L15.5 10" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  alert: <path d="M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.5h.01" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  refresh: <path d="M20 5v5h-5M4 19v-5h5M19 10a7.5 7.5 0 0 0-13-2M5 14a7.5 7.5 0 0 0 13 2" />,
  chevron: <path d="m6 9 6 6 6-6" />
};

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

/* --------------------------- Komponen dasar --------------------------- */

export const inputClass =
  "mt-1.5 w-full rounded-xl border themed-border bg-white px-3.5 py-3 text-[15px] text-brand-navyDeep outline-none transition placeholder:text-slate-400 focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20 disabled:cursor-not-allowed disabled:opacity-60";

export const primaryButtonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-brand-gold px-5 text-sm font-black text-brand-navyDeep shadow-sm transition hover:bg-brand-goldDark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-gold disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButtonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border themed-border themed-fill px-5 text-sm font-bold themed-text transition hover:bg-[var(--themed-fill-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-gold disabled:cursor-not-allowed disabled:opacity-50";

export function Card({
  children,
  className = "",
  as: Tag = "section"
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={`themed-glass rounded-2xl ${className}`}>{children}</Tag>;
}

export function CardHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b themed-border px-5 py-4 md:px-6">
      <div className="min-w-0">
        <h2 className="text-[15px] font-black themed-text">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs themed-text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeading({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight themed-text md:text-[28px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm themed-text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-xs font-semibold m-text-red">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs themed-text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const TONES = {
  green: "m-tone-green",
  amber: "m-tone-amber",
  red: "m-tone-red",
  blue: "m-tone-blue",
  gold: "m-tone-gold",
  slate: "themed-fill themed-text-muted"
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = "blue",
  title,
  children
}: {
  tone?: "blue" | "amber" | "red" | "green";
  title?: string;
  children: ReactNode;
}) {
  const styles = `m-notice-${tone}`;
  const icon = tone === "red" || tone === "amber" ? "alert" : tone === "green" ? "check" : "info";
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-4 py-3 ${styles}`}>
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 themed-text-secondary" />
      <div className="min-w-0 text-sm leading-6 themed-text-secondary">
        {title ? <p className="font-bold themed-text">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg themed-fill-strong ${className}`} />;
}

export function EmptyState({
  icon,
  title,
  children
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl themed-fill themed-text-muted">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-bold themed-text">{title}</p>
      {children ? <p className="mt-1.5 max-w-sm text-sm leading-6 themed-text-muted">{children}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl m-tone-red">
        <Icon name="alert" className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-bold themed-text">Data belum dapat dimuat</p>
      <p className="mt-1.5 max-w-sm text-sm leading-6 themed-text-muted">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={`${secondaryButtonClass} mt-4`}>
          <Icon name="refresh" className="h-4 w-4" />
          Coba lagi
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------ Toast ------------------------------ */

type ToastItem = { id: number; tone: "success" | "error"; message: string };
const ToastContext = createContext<(tone: ToastItem["tone"], message: string) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback((tone: ToastItem["tone"], message: string) => {
    counter.current += 1;
    const id = counter.current;
    setItems((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold shadow-glass ${
              item.tone === "error" ? "bg-rose-700 text-white" : "bg-emerald-700 text-white"
            }`}
          >
            <Icon name={item.tone === "error" ? "alert" : "check"} className="h-4 w-4 shrink-0" />
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------ Modal ------------------------------ */

export function Modal({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-brand-navyDeep/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-t-3xl border themed-border bg-[var(--themed-bg-3)] p-6 shadow-glass sm:rounded-3xl"
      >
        <h2 className="text-lg font-black themed-text">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------- Data & paginasi --------------------------- */

/** Memuat halaman demi halaman untuk daftar riwayat. */
export function usePagedList<T>(
  loader: (page: number, pageSize: number) => Promise<T[]>,
  pageSize: number,
  deps: ReadonlyArray<unknown> = []
) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loaderRef.current(1, pageSize);
      setItems(result);
      setPage(1);
      setHasMore(result.length === pageSize);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => void loadFirst(), [loadFirst, ...deps]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const result = await loaderRef.current(next, pageSize);
      setItems((current) => [...current, ...result]);
      setPage(next);
      setHasMore(result.length === pageSize);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoadingMore(false);
    }
  }, [page, pageSize]);

  return { items, loading, loadingMore, error, hasMore, reload: loadFirst, loadMore };
}
