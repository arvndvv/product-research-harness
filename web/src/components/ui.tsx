import type { ReactNode } from "react";
import type { RunStatus } from "../../../src/shared.ts";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-700",
        variant === "secondary" && "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100",
        variant === "ghost" && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        className,
      )}
    >
      {children}
    </button>
  );
}

const STATUS: Record<RunStatus, { label: string; dot: string }> = {
  running: { label: "Researching", dot: "bg-emerald-500 animate-pulse" },
  waiting: { label: "Needs your answer", dot: "bg-amber-500 animate-pulse" },
  idle: { label: "Paused", dot: "bg-zinc-400" },
  error: { label: "Stopped with an error", dot: "bg-red-500" },
  done: { label: "Done", dot: "bg-sky-500" },
};

export function StatusDot({ status }: { status: RunStatus }) {
  return <span className={cx("inline-block h-2 w-2 shrink-0 rounded-full", STATUS[status].dot)} />;
}

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-700">
      <StatusDot status={status} />
      {STATUS[status].label}
    </span>
  );
}

export function Chip({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "green" | "red" | "amber" | "sky" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700",
    green: "bg-emerald-50 text-emerald-800",
    red: "bg-red-50 text-red-800",
    amber: "bg-amber-50 text-amber-800",
    sky: "bg-sky-50 text-sky-800",
  };
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">{children}</div>;
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatPrice(amount: number, currency: string) {
  const inr = currency.toUpperCase() === "INR";
  return `${inr ? "₹" : `${currency} `}${Math.round(amount).toLocaleString(inr ? "en-IN" : "en-US")}`;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
