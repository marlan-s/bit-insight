import { BURST_WINDOW_MS, maxWindow } from "./investigate";
import { IntelGraph, nodeId } from "./graph";
import type { NormalizedTx } from "./types";

export interface EntityFeatures {
  entity_id: string;
  entity_type: "wallet" | "transaction";
  features: Record<string, number>;
  tx_count: number;
  ip_count: number;
  last_seen: number | null;
  scenario: string | null;
}

export const WALLET_FEATURES = [
  "transaction_count",
  "total_in",
  "total_out",
  "average_transaction_amount",
  "max_transaction_amount",
  "average_fee",
  "transaction_velocity",
  "unique_counterparties",
  "wallet_degree",
  "incoming_transaction_count",
  "outgoing_transaction_count",
  "in_out_ratio",
  "average_time_gap",
  "burst_score",
  "unique_ip_count",
  "ip_wallet_correlation_count",
  "graph_centrality",
  "pagerank",
  "betweenness",
  "connected_component_size",
  "active_time_span_hours",
  "max_transactions_per_window",
  "short_gap_ratio",
] as const;

export const TX_FEATURES = [
  "amount",
  "fee",
  "fee_ratio",
  "hour_of_day",
  "input_wallet_degree",
  "output_wallet_degree",
  "amount_deviation",
  "ip_transaction_count",
] as const;

export const FEATURE_LABELS: Record<string, string> = {
  transaction_count: "Transaction count",
  total_in: "Total received (BTC)",
  total_out: "Total sent (BTC)",
  average_transaction_amount: "Average transaction amount (BTC)",
  max_transaction_amount: "Largest transaction (BTC)",
  average_fee: "Average fee (BTC)",
  transaction_velocity: "Transaction velocity (tx/hour)",
  unique_counterparties: "Unique counterparties",
  wallet_degree: "Graph degree",
  incoming_transaction_count: "Incoming transactions",
  outgoing_transaction_count: "Outgoing transactions",
  in_out_ratio: "Incoming / outgoing ratio",
  average_time_gap: "Average gap between transactions (min)",
  burst_score: "Burst score (max tx in 10 min)",
  unique_ip_count: "Unique associated IPs",
  ip_wallet_correlation_count: "Repeated IP observations",
  graph_centrality: "Degree centrality",
  pagerank: "PageRank centrality",
  betweenness: "Betweenness centrality",
  connected_component_size: "Connected component size",
  active_time_span_hours: "Active time span (hours)",
  max_transactions_per_window: "Peak transactions per hour",
  short_gap_ratio: "Share of sub-minute gaps",
  suspicious_neighbor_count: "Suspicious neighbouring entities",
  suspicious_neighbor_ratio: "Suspicious neighbour ratio",
  amount: "Amount (BTC)",
  fee: "Fee (BTC)",
  fee_ratio: "Fee as share of amount",
  hour_of_day: "Hour of day",
  input_wallet_degree: "Sending wallet degree",
  output_wallet_degree: "Receiving wallet degree",
  amount_deviation: "Deviation from average amount",
  ip_transaction_count: "Transactions seen from this IP",
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeFeatures(txs: NormalizedTx[], graph: IntelGraph) {
  const pagerank = graph.pagerank();
  const betweenness = graph.betweenness();
  const componentSize = graph.connectedComponents();
  const nodeCount = graph.nodes.size || 1;

  interface WalletAgg {
    amounts: number[];
    fees: number[];
    times: number[];
    counterparties: Set<string>;
    ips: Map<string, number>;
    inCount: number;
    outCount: number;
    totalIn: number;
    totalOut: number;
    scenario: string | null;
  }
  const wallets = new Map<string, WalletAgg>();
  const ensure = (w: string): WalletAgg => {
    let agg = wallets.get(w);
    if (!agg) {
      agg = {
        amounts: [],
        fees: [],
        times: [],
        counterparties: new Set(),
        ips: new Map(),
        inCount: 0,
        outCount: 0,
        totalIn: 0,
        totalOut: 0,
        scenario: null,
      };
      wallets.set(w, agg);
    }
    return agg;
  };

  for (const tx of txs) {
    const amount = tx.output_amount ?? tx.input_amount ?? 0;
    const pairs: [string | null, "in" | "out", string | null][] = [
      [tx.input_wallet, "out", tx.output_wallet],
      [tx.output_wallet, "in", tx.input_wallet],
    ];
    for (const [wallet, direction, other] of pairs) {
      if (!wallet) continue;
      const agg = ensure(wallet);
      agg.amounts.push(amount);
      if (tx.fee !== null) agg.fees.push(tx.fee);
      if (tx.timestamp) agg.times.push(tx.timestamp);
      if (other) agg.counterparties.add(other);
      for (const ip of [tx.source_ip, tx.destination_ip]) {
        if (ip) agg.ips.set(ip, (agg.ips.get(ip) ?? 0) + 1);
      }
      if (direction === "in") {
        agg.inCount++;
        agg.totalIn += amount;
      } else {
        agg.outCount++;
        agg.totalOut += amount;
      }
      if (tx.scenario && tx.scenario !== "normal") agg.scenario = tx.scenario;
    }
  }

  const walletFeatures: EntityFeatures[] = [];
  for (const [address, agg] of wallets) {
    const times = [...agg.times].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(((times[i] ?? 0) - (times[i - 1] ?? 0)) / 60000);
    const spanHours = times.length > 1 ? ((times[times.length - 1] ?? 0) - (times[0] ?? 0)) / 3600000 : 0;

    // burst: max transactions inside a 10-minute sliding window (shared with the timeline view)
    const burst = maxWindow(times, BURST_WINDOW_MS).count;
    // peak transactions per hour window
    const perHour = maxWindow(times, 3600000).count;

    const id = nodeId("wallet", address);
    const txCount = agg.amounts.length;
    const repeatedIp = [...agg.ips.values()].filter((c) => c > 2).reduce((a, b) => a + b, 0);

    walletFeatures.push({
      entity_id: address,
      entity_type: "wallet",
      tx_count: txCount,
      ip_count: agg.ips.size,
      last_seen: times.length ? (times[times.length - 1] ?? null) : null,
      scenario: agg.scenario,
      features: {
        transaction_count: txCount,
        total_in: agg.totalIn,
        total_out: agg.totalOut,
        average_transaction_amount: mean(agg.amounts),
        max_transaction_amount: agg.amounts.length ? Math.max(...agg.amounts) : 0,
        average_fee: mean(agg.fees),
        transaction_velocity: spanHours > 0 ? txCount / spanHours : txCount,
        unique_counterparties: agg.counterparties.size,
        wallet_degree: graph.degree(id),
        incoming_transaction_count: agg.inCount,
        outgoing_transaction_count: agg.outCount,
        in_out_ratio: agg.outCount ? agg.inCount / agg.outCount : agg.inCount,
        average_time_gap: mean(gaps),
        burst_score: burst,
        unique_ip_count: agg.ips.size,
        ip_wallet_correlation_count: repeatedIp,
        graph_centrality: graph.degree(id) / nodeCount,
        pagerank: (pagerank.get(id) ?? 0) * nodeCount,
        betweenness: betweenness.get(id) ?? 0,
        connected_component_size: componentSize.get(id) ?? 1,
        active_time_span_hours: spanHours,
        max_transactions_per_window: perHour,
        short_gap_ratio: gaps.length ? gaps.filter((g) => g < 1).length / gaps.length : 0,
      },
    });
  }

  const allAmounts = txs.map((t) => t.output_amount ?? t.input_amount ?? 0);
  const avgAmount = mean(allAmounts);
  const ipCounts = new Map<string, number>();
  for (const tx of txs) for (const ip of [tx.source_ip, tx.destination_ip]) if (ip) ipCounts.set(ip, (ipCounts.get(ip) ?? 0) + 1);

  const txFeatures: EntityFeatures[] = txs.map((tx) => {
    const amount = tx.output_amount ?? tx.input_amount ?? 0;
    const fee = tx.fee ?? 0;
    return {
      entity_id: tx.txid,
      entity_type: "transaction" as const,
      tx_count: 1,
      ip_count: new Set([tx.source_ip, tx.destination_ip].filter(Boolean)).size,
      last_seen: tx.timestamp,
      scenario: tx.scenario && tx.scenario !== "normal" ? tx.scenario : null,
      features: {
        amount,
        fee,
        fee_ratio: amount ? fee / amount : 0,
        hour_of_day: tx.timestamp ? new Date(tx.timestamp).getUTCHours() : 0,
        input_wallet_degree: tx.input_wallet ? graph.degree(nodeId("wallet", tx.input_wallet)) : 0,
        output_wallet_degree: tx.output_wallet ? graph.degree(nodeId("wallet", tx.output_wallet)) : 0,
        amount_deviation: avgAmount ? (amount - avgAmount) / avgAmount : 0,
        ip_transaction_count: Math.max(
          tx.source_ip ? (ipCounts.get(tx.source_ip) ?? 0) : 0,
          tx.destination_ip ? (ipCounts.get(tx.destination_ip) ?? 0) : 0,
        ),
      },
    };
  });

  return { walletFeatures, txFeatures };
}

/** Second pass: neighbourhood risk once first-pass risk scores exist. */
export function addNeighborFeatures(
  walletFeatures: EntityFeatures[],
  graph: IntelGraph,
  riskByWallet: Map<string, number>,
) {
  for (const wf of walletFeatures) {
    const id = nodeId("wallet", wf.entity_id);
    const neighbourWallets = new Set<string>();
    for (const txn of graph.neighbors(id)) {
      for (const nb of graph.neighbors(txn)) {
        const node = graph.nodes.get(nb);
        if (node?.type === "wallet" && nb !== id) neighbourWallets.add(node.label);
      }
    }
    const suspicious = [...neighbourWallets].filter((w) => (riskByWallet.get(w) ?? 0) >= 60);
    wf.features["suspicious_neighbor_count"] = suspicious.length;
    wf.features["suspicious_neighbor_ratio"] = neighbourWallets.size ? suspicious.length / neighbourWallets.size : 0;
  }
}
