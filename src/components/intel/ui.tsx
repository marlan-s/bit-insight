import type { ReactNode } from "react";

export function riskLevel(score: number) {
  if (score >= 85) return { label: "Critical", token: "critical" as const };
  if (score >= 70) return { label: "High", token: "high" as const };
  if (score >= 45) return { label: "Medium", token: "medium" as const };
  return { label: "Low", token: "low" as const };
}

const RISK_CLASS: Record<string, string> = {
  critical: "bg-critical/15 text-critical border-critical/40",
  high: "bg-high/15 text-high border-high/40",
  medium: "bg-medium/15 text-medium border-medium/40",
  low: "bg-low/15 text-low border-low/40",
};

export function RiskBadge({ score }: { score: number }) {
  const { label, token } = riskLevel(score);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded border px-2 py-0.5 font-mono text-xs ${RISK_CLASS[token]}`}
    >
      <span className="font-semibold">{score}</span>
      {label}
    </span>
  );
}

const TYPE_CLASS: Record<string, string> = {
  wallet: "bg-wallet/15 text-wallet border-wallet/40",
  transaction: "bg-transaction/15 text-transaction border-transaction/40",
  ip: "bg-ip/15 text-ip border-ip/40",
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase ${TYPE_CLASS[type] ?? ""}`}>
      {type}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title ? (
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="label-xs">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="label-xs">{label}</div>
      <div className="mt-1 font-mono text-2xl text-foreground">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function fmtTime(ts: number | string | null | undefined) {
  if (ts === null || ts === undefined) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function num(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}
