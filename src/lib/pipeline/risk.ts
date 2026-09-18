import { featureContributions, trainIsolationForest } from "./iforest";
import { FEATURE_LABELS, type EntityFeatures } from "./features";
import type { ExplanationItem, ScoredEntity } from "./types";

/** Human-readable reason phrases keyed by the dominant contributing feature. */
const REASON_TEXT: Record<string, string> = {
  transaction_velocity: "Unusually high transaction velocity",
  burst_score: "Transaction burst detected",
  max_transactions_per_window: "Abnormal transaction frequency",
  unique_counterparties: "Unusually high number of counterparties",
  unique_ip_count: "Unusual IP diversity",
  ip_wallet_correlation_count: "Repeated IP-wallet observations",
  graph_centrality: "Elevated graph centrality",
  pagerank: "Elevated graph centrality",
  betweenness: "Acts as a bridge between clusters",
  in_out_ratio: "Fan-in / fan-out imbalance",
  incoming_transaction_count: "Fan-in behaviour",
  outgoing_transaction_count: "Fan-out behaviour",
  max_transaction_amount: "Large deviation from normal transaction amount",
  average_transaction_amount: "Large deviation from normal transaction amount",
  total_in: "Large aggregate inflow",
  total_out: "Rapid movement of funds",
  short_gap_ratio: "Rapid back-to-back transactions",
  average_time_gap: "Abnormal temporal behaviour",
  active_time_span_hours: "Compressed activity window",
  suspicious_neighbor_count: "Suspicious neighbouring entities",
  suspicious_neighbor_ratio: "Suspicious neighbourhood exposure",
  connected_component_size: "Member of a highly connected cluster",
  amount: "Unusual transaction amount",
  fee: "Unusual fee",
  fee_ratio: "Unusual fee relative to amount",
  amount_deviation: "Large deviation from normal transaction amount",
  ip_transaction_count: "High-volume IP observation",
  transaction_count: "Unusually high transaction count",
  wallet_degree: "Highly connected wallet",
  total_amount: "Unusual value flow",
};

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

export interface ScoringResult {
  entities: ScoredEntity[];
  featureNames: string[];
  datasetAverages: Record<string, number>;
  rawScores: number[];
}

/**
 * Trains an Isolation Forest on the entity feature matrix and converts the
 * anomaly output into a 0-100 investigation-priority score with deterministic,
 * feature-based explanations.
 */
export function scoreEntities(entities: EntityFeatures[], featureNames: string[], seed = 42): ScoringResult {
  if (!entities.length) return { entities: [], featureNames, datasetAverages: {}, rawScores: [] };

  const raw = entities.map((e) => featureNames.map((f) => e.features[f] ?? 0));

  // robust scaling (log1p on heavy-tailed values, then z-score)
  const columns = featureNames.map((_, i) => raw.map((r) => r[i] ?? 0));
  const useLog = columns.map((col) => Math.max(...col.map(Math.abs)) > 50);
  const transformed = raw.map((r) =>
    r.map((v, i) => (useLog[i] ? Math.sign(v) * Math.log1p(Math.abs(v)) : v)),
  );
  const tCols = featureNames.map((_, i) => transformed.map((r) => r[i] ?? 0));
  const means = tCols.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const stds = tCols.map((c, i) => {
    const m = means[i] ?? 0;
    return Math.sqrt(c.reduce((a, b) => a + (b - m) ** 2, 0) / c.length) || 1;
  });
  const matrix = transformed.map((r) => r.map((v, i) => (v - (means[i] ?? 0)) / (stds[i] ?? 1)));
  const medians = featureNames.map((_, i) => {
    const col = matrix.map((r) => r[i] ?? 0).sort((a, b) => a - b);
    return quantile(col, 0.5);
  });

  const model = trainIsolationForest(matrix, { trees: 120, sampleSize: 256, seed });
  const rawScores = matrix.map((row) => model.score(row));
  const sorted = [...rawScores].sort((a, b) => a - b);
  const lo = quantile(sorted, 0.02);
  const hi = quantile(sorted, 0.995);

  const datasetAverages: Record<string, number> = {};
  featureNames.forEach((f, i) => {
    const col = columns[i] ?? [];
    datasetAverages[f] = col.length ? col.reduce((a, b) => a + b, 0) / col.length : 0;
  });

  const scored: ScoredEntity[] = entities.map((entity, idx) => {
    const row = matrix[idx] ?? [];
    const anomaly = rawScores[idx] ?? 0;
    const normalized = Math.max(0, Math.min(1, (anomaly - lo) / (hi - lo || 1)));
    const risk = Math.round(normalized * 100);

    const contributions = featureContributions(model, row, medians);
    const total = contributions.reduce((a, b) => a + b, 0);
    const ranked = featureNames
      .map((name, i) => ({ name, contribution: total ? (contributions[i] ?? 0) / total : 0, z: row[i] ?? 0 }))
      // only features where the entity sits ABOVE the population explain elevated risk
      .filter((f) => f.contribution > 0.01 && Math.abs(f.z) > 0.4)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 6);

    const explanation: ExplanationItem[] = ranked.map((f) => {
      const value = entity.features[f.name] ?? 0;
      const avg = datasetAverages[f.name] ?? 0;
      const direction = f.z >= 0 ? "above" : "below";
      return {
        feature: f.name,
        label: FEATURE_LABELS[f.name] ?? f.name,
        value,
        datasetAverage: avg,
        zScore: Number(f.z.toFixed(2)),
        contribution: Number(f.contribution.toFixed(3)),
        text: `${FEATURE_LABELS[f.name] ?? f.name}: ${value.toFixed(2)} (dataset average ${avg.toFixed(2)}, ${Math.abs(f.z).toFixed(1)} sd ${direction})`,
      };
    });

    const primary = ranked[0]?.name;
    return {
      entity_id: entity.entity_id,
      entity_type: entity.entity_type,
      risk_score: risk,
      anomaly_score: Number(anomaly.toFixed(4)),
      primary_reason: primary ? (REASON_TEXT[primary] ?? FEATURE_LABELS[primary] ?? primary) : "Mixed low-level anomalies",
      tx_count: entity.tx_count,
      ip_count: entity.ip_count,
      last_seen: entity.last_seen,
      features: entity.features,
      explanation,
      scenario: entity.scenario,
    };
  });

  return { entities: scored, featureNames, datasetAverages, rawScores };
}

export function riskLevel(score: number): "Critical" | "High" | "Medium" | "Low" {
  if (score >= 85) return "Critical";
  if (score >= 70) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}
