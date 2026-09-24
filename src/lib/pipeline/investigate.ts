// Pure helpers for investigation search/filters, burst timeline and the
// "Why this entity?" evidence card. They consume pipeline output only.

import type { ExplanationItem } from "./types";

// ---------------------------------------------------------------- bursts
export const BURST_WINDOW_MS = 600_000; // same 10-minute window as the burst_score feature

/** Densest sliding window over sorted timestamps (identical logic to burst_score). */
export function maxWindow(sortedTimes: number[], windowMs: number) {
  let best = { count: 0, start: -1, end: -1 };
  for (let i = 0; i < sortedTimes.length; i++) {
    let j = i;
    while (j + 1 < sortedTimes.length && (sortedTimes[j + 1] ?? 0) - (sortedTimes[i] ?? 0) <= windowMs) j++;
    const count = j - i + 1;
    if (count > best.count) best = { count, start: i, end: j };
  }
  return best;
}

export interface BurstSummary {
  detected: boolean;
  count: number;
  startTs: number | null;
  endTs: number | null;
  durationMinutes: number;
  averageGapSeconds: number | null;
  baselinePerWindow: number | null;
  startIndex: number;
  endIndex: number;
}

/** A burst is reported when the densest 10-min window has ≥3 tx and exceeds the dataset's average burst_score. */
export function summarizeBurst(sortedTimes: number[], baselinePerWindow: number | null): BurstSummary {
  const w = maxWindow(sortedTimes, BURST_WINDOW_MS);
  const startTs = w.start >= 0 ? (sortedTimes[w.start] ?? null) : null;
  const endTs = w.end >= 0 ? (sortedTimes[w.end] ?? null) : null;
  const durationMinutes = startTs !== null && endTs !== null ? (endTs - startTs) / 60000 : 0;
  const averageGapSeconds = w.count > 1 ? (durationMinutes * 60) / (w.count - 1) : null;
  const detected = w.count >= 3 && (baselinePerWindow === null || w.count > baselinePerWindow);
  return {
    detected,
    count: w.count,
    startTs,
    endTs,
    durationMinutes,
    averageGapSeconds,
    baselinePerWindow,
    startIndex: w.start,
    endIndex: w.end,
  };
}

// ---------------------------------------------------------------- filters
export interface AlertLike {
  entity_id: string;
  entity_type: string;
  risk_score: number;
  tx_count: number;
  last_seen: string | null;
}

export interface AlertFilters {
  query: string;
  type: string; // all | wallet | transaction | ip
  risk: string; // all | 80-100 | 60-79 | 40-59 | 0-39
  time: string; // all | 1h | 6h | 24h
  sort: string; // risk | tx | last_seen | name
  asc: boolean;
}

export const DEFAULT_FILTERS: AlertFilters = { query: "", type: "all", risk: "all", time: "all", sort: "risk", asc: false };

export function isFiltered(f: AlertFilters) {
  return f.query.trim() !== "" || f.type !== "all" || f.risk !== "all" || f.time !== "all";
}

const HOURS: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24 };

/**
 * Filters and sorts scored entities. `related` holds ids of entities linked to the query through
 * transactions (e.g. txs of a searched wallet/IP). Time ranges are relative to the latest observation
 * in the dataset (`referenceTs`), since the data is historical/offline.
 */
export function filterAlerts<T extends AlertLike>(
  rows: T[],
  f: AlertFilters,
  opts: { related?: Set<string>; referenceTs?: number | null } = {},
): T[] {
  const q = f.query.trim().toLowerCase();
  let min = 0;
  let max = 100;
  if (f.risk !== "all") {
    const [a, b] = f.risk.split("-").map(Number);
    min = a ?? 0;
    max = b ?? 100;
  }
  const hours = HOURS[f.time];
  const ref = opts.referenceTs ?? null;
  const cutoff = hours && ref !== null ? ref - hours * 3600_000 : null;

  const out = rows.filter((r) => {
    if (f.type !== "all" && r.entity_type !== f.type) return false;
    if (r.risk_score < min || r.risk_score > max) return false;
    if (cutoff !== null) {
      const t = r.last_seen ? Date.parse(r.last_seen) : NaN;
      if (Number.isNaN(t) || t < cutoff) return false;
    }
    if (q) {
      const direct = r.entity_id.toLowerCase().includes(q);
      const rel = opts.related?.has(`${r.entity_type}:${r.entity_id}`) ?? false;
      if (!direct && !rel) return false;
    }
    return true;
  });

  const dir = f.asc ? 1 : -1;
  const key = (r: T): number | string => {
    if (f.sort === "tx") return r.tx_count;
    if (f.sort === "last_seen") return r.last_seen ? Date.parse(r.last_seen) : 0;
    if (f.sort === "name") return r.entity_id.toLowerCase();
    return r.risk_score;
  };
  return out.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return b.risk_score - a.risk_score;
  });
}

// ---------------------------------------------------------------- evidence card
export interface EvidenceItem {
  feature: string;
  title: string;
  observed: string;
  baseline: string | null;
  zScore: number | null;
}

const EVIDENCE_TITLES: Record<string, string> = {
  burst_score: "Transaction burst",
  transaction_velocity: "High transaction velocity",
  max_transactions_per_window: "Peak hourly activity",
  unique_ip_count: "IP diversity (observed)",
  ip_wallet_correlation_count: "Repeated IP–wallet observations",
  suspicious_neighbor_count: "Network exposure",
  suspicious_neighbor_ratio: "Anomalous neighbourhood share",
  unique_counterparties: "Many counterparties",
  wallet_degree: "Highly connected",
  betweenness: "Bridge position in graph",
  pagerank: "Graph centrality (PageRank)",
  graph_centrality: "Graph centrality",
  max_transaction_amount: "Amount deviation (max)",
  average_transaction_amount: "Amount deviation (average)",
  short_gap_ratio: "Rapid successive transactions",
  average_time_gap: "Unusual timing between transactions",
  incoming_transaction_count: "Fan-in",
  outgoing_transaction_count: "Fan-out",
};

const UNITS: Record<string, (v: number) => string> = {
  burst_score: (v) => `${fmt(v, 1)} tx in 10 min`,
  transaction_velocity: (v) => `${fmt(v, 1)} tx/hour`,
  max_transactions_per_window: (v) => `${fmt(v, 1)} tx in 1 hour`,
  unique_ip_count: (v) => `${fmt(v, 1)} observed IPs`,
  suspicious_neighbor_count: (v) => `${fmt(v, 1)} anomalous neighbouring wallets`,
  unique_counterparties: (v) => `${fmt(v, 1)} counterparties`,
  max_transaction_amount: (v) => `${fmt(v, 4)} BTC`,
  average_transaction_amount: (v) => `${fmt(v, 4)} BTC`,
  short_gap_ratio: (v) => `${fmt(v * 100, 0)}% sub-minute gaps`,
  average_time_gap: (v) => `${fmt(v, 1)} min average gap`,
};

function fmt(v: number, d: number) {
  return Number.isFinite(v) ? v.toFixed(d).replace(/\.0+$/, "") : "—";
}

export function formatFeature(feature: string, v: number) {
  return (UNITS[feature] ?? ((x: number) => fmt(x, 2)))(v);
}

/**
 * Top evidence = the model's own explanation items (ranked by contribution to the anomaly score),
 * limited to features that were actually computed. Values and baselines are copied verbatim.
 */
export function buildEvidence(
  explanation: ExplanationItem[] | null | undefined,
  features: Record<string, number> | null | undefined,
  limit = 4,
): EvidenceItem[] {
  if (!explanation?.length || !features) return [];
  return explanation
    .filter((x) => typeof features[x.feature] === "number" && Number.isFinite(features[x.feature]))
    .slice(0, limit)
    .map((x) => ({
      feature: x.feature,
      title: EVIDENCE_TITLES[x.feature] ?? x.label,
      observed: formatFeature(x.feature, features[x.feature] as number),
      baseline: Number.isFinite(x.datasetAverage) ? formatFeature(x.feature, x.datasetAverage) : null,
      zScore: Number.isFinite(x.zScore) ? x.zScore : null,
    }));
}

export function priorityLabel(score: number) {
  if (score >= 85) return "CRITICAL";
  if (score >= 70) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}
