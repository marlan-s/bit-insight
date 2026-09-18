import type { PipelineMetrics, ScoredEntity } from "./types";

/**
 * Evaluation of the unsupervised detector. Synthetic scenario labels are used
 * ONLY here for measurement — never as detector inputs.
 */
export function evaluate(entities: ScoredEntity[], featureCount: number, threshold = 70): PipelineMetrics {
  const buckets = [0, 20, 40, 60, 80, 100];
  const anomalyDistribution = buckets.slice(0, -1).map((b, i) => ({
    bucket: `${b}-${buckets[i + 1]}`,
    count: entities.filter((e) => e.risk_score >= b && e.risk_score < (buckets[i + 1] ?? 101)).length,
  }));

  const labelled = entities.some((e) => e.scenario);
  const metrics: PipelineMetrics = {
    model: "IsolationForest (unsupervised)",
    trainedOn: entities.length,
    featureCount,
    contamination: entities.length ? entities.filter((e) => e.risk_score >= threshold).length / entities.length : 0,
    anomalyDistribution,
    labelled,
  };

  if (!labelled) return metrics;

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const e of entities) {
    const positive = Boolean(e.scenario);
    const flagged = e.risk_score >= threshold;
    if (positive && flagged) tp++;
    else if (!positive && flagged) fp++;
    else if (positive && !flagged) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  // ROC-AUC via rank statistic (Mann-Whitney U)
  const sorted = [...entities].sort((a, b) => a.risk_score - b.risk_score);
  let rankSum = 0;
  sorted.forEach((e, i) => {
    if (e.scenario) rankSum += i + 1;
  });
  const pos = entities.filter((e) => e.scenario).length;
  const neg = entities.length - pos;
  const rocAuc = pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : 0;

  const scenarios = new Map<string, { total: number; detected: number }>();
  for (const e of entities) {
    if (!e.scenario) continue;
    const cur = scenarios.get(e.scenario) ?? { total: 0, detected: 0 };
    cur.total++;
    if (e.risk_score >= threshold) cur.detected++;
    scenarios.set(e.scenario, cur);
  }

  return {
    ...metrics,
    precision,
    recall,
    f1,
    rocAuc,
    confusion: { tp, fp, tn, fn },
    scenarioCoverage: [...scenarios.entries()].map(([scenario, v]) => ({ scenario, ...v })),
    classImbalance: `${pos} labelled suspicious vs ${neg} normal entities (${((pos / (pos + neg || 1)) * 100).toFixed(1)}% positive) — precision is dominated by the majority class, so ranking quality (ROC-AUC, top-k coverage) matters more than raw accuracy.`,
  };
}
