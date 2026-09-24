import { addNeighborFeatures, computeFeatures, TX_FEATURES, WALLET_FEATURES } from "./features";
import { buildGraph, type IntelGraph } from "./graph";
import { evaluate } from "./evaluate";
import { scoreEntities } from "./risk";
import type { NormalizedTx, PipelineMetrics, ScoredEntity } from "./types";

export * from "./types";
export * from "./graph";
export * from "./normalize";
export * from "./features";
export * from "./risk";
export * from "./generator";
export * from "./evaluate";
export * from "./investigate";

export interface PipelineResult {
  graph: IntelGraph;
  entities: ScoredEntity[];
  metrics: PipelineMetrics;
  summary: {
    transactions: number;
    wallets: number;
    ips: number;
    totalAmount: number;
    suspiciousWallets: number;
    suspiciousTransactions: number;
    timeRange: { from: number | null; to: number | null };
  };
}

/** CORRELATE -> DETECT -> PRIORITIZE -> EXPLAIN, end to end. */
export function runPipeline(txs: NormalizedTx[]): PipelineResult {
  const graph = buildGraph(txs);
  const { walletFeatures, txFeatures } = computeFeatures(txs, graph);

  // Pass 1: score wallets without neighbourhood risk.
  const pass1 = scoreEntities(walletFeatures, [...WALLET_FEATURES]);
  const riskByWallet = new Map(pass1.entities.map((e) => [e.entity_id, e.risk_score]));

  // Pass 2: add suspicious-neighbour exposure and re-train.
  addNeighborFeatures(walletFeatures, graph, riskByWallet);
  const walletNames = [...WALLET_FEATURES, "suspicious_neighbor_count", "suspicious_neighbor_ratio"];
  const walletScored = scoreEntities(walletFeatures, walletNames);

  const txScored = scoreEntities(txFeatures, [...TX_FEATURES]);

  const entities = [...walletScored.entities, ...txScored.entities].sort((a, b) => b.risk_score - a.risk_score);

  for (const e of walletScored.entities) {
    const node = graph.nodes.get(`wallet:${e.entity_id}`);
    if (node) node.meta["risk_score"] = e.risk_score;
  }
  for (const e of txScored.entities) {
    const node = graph.nodes.get(`transaction:${e.entity_id}`);
    if (node) node.meta["risk_score"] = e.risk_score;
  }

  const metrics = evaluate(walletScored.entities, walletNames.length);

  const times = txs.map((t) => t.timestamp).filter((t): t is number => t !== null);
  const ipSet = new Set<string>();
  for (const t of txs) {
    if (t.source_ip) ipSet.add(t.source_ip);
    if (t.destination_ip) ipSet.add(t.destination_ip);
  }

  return {
    graph,
    entities,
    metrics,
    summary: {
      transactions: txs.length,
      wallets: walletFeatures.length,
      ips: ipSet.size,
      totalAmount: txs.reduce((a, t) => a + (t.output_amount ?? t.input_amount ?? 0), 0),
      suspiciousWallets: walletScored.entities.filter((e) => e.risk_score >= 70).length,
      suspiciousTransactions: txScored.entities.filter((e) => e.risk_score >= 70).length,
      timeRange: { from: times.length ? Math.min(...times) : null, to: times.length ? Math.max(...times) : null },
    },
  };
}
