import type { NormalizedTx } from "./types";

export type NodeType = "wallet" | "transaction" | "ip";
export type EdgeType = "OBSERVED" | "INPUT_FROM" | "OUTPUT_TO" | "PARTICIPATED_IN" | "NEXT_TRANSACTION";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  meta: Record<string, string | number | null>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
}

export const nodeId = (type: NodeType, raw: string) => `${type}:${raw}`;

export class IntelGraph {
  nodes = new Map<string, GraphNode>();
  edges: GraphEdge[] = [];
  adjacency = new Map<string, Set<string>>();

  addNode(type: NodeType, raw: string, meta: Record<string, string | number | null> = {}) {
    const id = nodeId(type, raw);
    const existing = this.nodes.get(id);
    if (existing) {
      Object.assign(existing.meta, meta);
      return existing;
    }
    const node: GraphNode = { id, type, label: raw, meta: { ...meta } };
    this.nodes.set(id, node);
    this.adjacency.set(id, new Set());
    return node;
  }

  addEdge(source: string, target: string, type: EdgeType) {
    const id = `${source}->${target}:${type}`;
    if (!this.nodes.has(source) || !this.nodes.has(target)) return;
    this.edges.push({ id, source, target, type });
    this.adjacency.get(source)?.add(target);
    this.adjacency.get(target)?.add(source);
  }

  neighbors(id: string): string[] {
    return [...(this.adjacency.get(id) ?? [])];
  }

  degree(id: string): number {
    return this.adjacency.get(id)?.size ?? 0;
  }

  /** Undirected shortest path (BFS). */
  shortestPath(from: string, to: string): string[] | null {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    const prev = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift() as string;
      if (cur === to) break;
      for (const n of this.neighbors(cur)) {
        if (!prev.has(n)) {
          prev.set(n, cur);
          queue.push(n);
        }
      }
    }
    if (!prev.has(to)) return null;
    const path: string[] = [];
    let cur: string | null = to;
    while (cur) {
      path.unshift(cur);
      cur = prev.get(cur) ?? null;
    }
    return path;
  }

  /** k-hop neighbourhood subgraph around a node (used by the investigation view). */
  subgraph(center: string, hops = 1, maxNodes = 120) {
    const included = new Set<string>([center]);
    let frontier = [center];
    for (let h = 0; h < hops; h++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of this.neighbors(id)) {
          if (included.size >= maxNodes) break;
          if (!included.has(n)) {
            included.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    const nodes = [...included].map((id) => this.nodes.get(id)).filter(Boolean) as GraphNode[];
    const edges = this.edges.filter((e) => included.has(e.source) && included.has(e.target));
    return { nodes, edges };
  }

  connectedComponents(): Map<string, number> {
    const componentOf = new Map<string, number>();
    const sizes: number[] = [];
    let c = 0;
    for (const id of this.nodes.keys()) {
      if (componentOf.has(id)) continue;
      const stack = [id];
      const members: string[] = [];
      componentOf.set(id, c);
      while (stack.length) {
        const cur = stack.pop() as string;
        members.push(cur);
        for (const n of this.neighbors(cur)) {
          if (!componentOf.has(n)) {
            componentOf.set(n, c);
            stack.push(n);
          }
        }
      }
      sizes[c] = members.length;
      c++;
    }
    const sizeOf = new Map<string, number>();
    for (const [id, comp] of componentOf) sizeOf.set(id, sizes[comp] ?? 1);
    return sizeOf;
  }

  /** PageRank over the undirected projection. */
  pagerank(damping = 0.85, iterations = 20): Map<string, number> {
    const ids = [...this.nodes.keys()];
    const n = ids.length || 1;
    let rank = new Map(ids.map((id) => [id, 1 / n]));
    for (let it = 0; it < iterations; it++) {
      const next = new Map(ids.map((id) => [id, (1 - damping) / n]));
      for (const id of ids) {
        const deg = this.degree(id);
        const share = deg ? (rank.get(id) ?? 0) / deg : 0;
        if (!deg) continue;
        for (const nb of this.neighbors(id)) {
          next.set(nb, (next.get(nb) ?? 0) + damping * share);
        }
      }
      rank = next;
    }
    return rank;
  }

  /** Approximate betweenness centrality (Brandes on a sample of sources). */
  betweenness(sampleSize = 60): Map<string, number> {
    const ids = [...this.nodes.keys()];
    const score = new Map(ids.map((id) => [id, 0]));
    if (!ids.length) return score;
    const step = Math.max(1, Math.floor(ids.length / sampleSize));
    const sources = ids.filter((_, i) => i % step === 0);
    for (const s of sources) {
      const stack: string[] = [];
      const preds = new Map<string, string[]>();
      const sigma = new Map<string, number>([[s, 1]]);
      const dist = new Map<string, number>([[s, 0]]);
      const queue = [s];
      while (queue.length) {
        const v = queue.shift() as string;
        stack.push(v);
        for (const w of this.neighbors(v)) {
          if (!dist.has(w)) {
            dist.set(w, (dist.get(v) ?? 0) + 1);
            queue.push(w);
          }
          if (dist.get(w) === (dist.get(v) ?? 0) + 1) {
            sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0));
            preds.set(w, [...(preds.get(w) ?? []), v]);
          }
        }
      }
      const delta = new Map<string, number>();
      while (stack.length) {
        const w = stack.pop() as string;
        for (const v of preds.get(w) ?? []) {
          const c = ((sigma.get(v) ?? 0) / (sigma.get(w) || 1)) * (1 + (delta.get(w) ?? 0));
          delta.set(v, (delta.get(v) ?? 0) + c);
        }
        if (w !== s) score.set(w, (score.get(w) ?? 0) + (delta.get(w) ?? 0));
      }
    }
    // normalise
    const max = Math.max(1, ...score.values());
    for (const [k, v] of score) score.set(k, v / max);
    return score;
  }
}

/** Build the heterogeneous IP / TRANSACTION / WALLET graph from normalized rows. */
export function buildGraph(txs: NormalizedTx[]): IntelGraph {
  const g = new IntelGraph();
  const walletTimeline = new Map<string, { ts: number; txid: string }[]>();

  for (const tx of txs) {
    const amount = tx.output_amount ?? tx.input_amount ?? 0;
    const txNode = g.addNode("transaction", tx.txid, {
      txid: tx.txid,
      timestamp: tx.timestamp,
      amount,
      fee: tx.fee ?? 0,
      script_type: tx.script_type,
      source_ip: tx.source_ip,
      destination_ip: tx.destination_ip,
      source_port: tx.source_port,
      destination_port: tx.destination_port,
    });

    for (const [ip, role] of [
      [tx.source_ip, "source"],
      [tx.destination_ip, "destination"],
    ] as const) {
      if (!ip) continue;
      const ipNode = g.addNode("ip", ip, { ip, transaction_count: 0, first_seen: null, last_seen: null, role });
      ipNode.meta["transaction_count"] = Number(ipNode.meta["transaction_count"] ?? 0) + 1;
      if (tx.timestamp) {
        const first = ipNode.meta["first_seen"] as number | null;
        const last = ipNode.meta["last_seen"] as number | null;
        ipNode.meta["first_seen"] = first === null ? tx.timestamp : Math.min(first, tx.timestamp);
        ipNode.meta["last_seen"] = last === null ? tx.timestamp : Math.max(last, tx.timestamp);
      }
      g.addEdge(ipNode.id, txNode.id, "OBSERVED");
    }

    for (const [wallet, direction] of [
      [tx.input_wallet, "in"],
      [tx.output_wallet, "out"],
    ] as const) {
      if (!wallet) continue;
      const w = g.addNode("wallet", wallet, {
        address: wallet,
        transaction_count: 0,
        total_in: 0,
        total_out: 0,
        first_seen: null,
        last_seen: null,
        risk_score: 0,
      });
      w.meta["transaction_count"] = Number(w.meta["transaction_count"] ?? 0) + 1;
      if (direction === "in") w.meta["total_out"] = Number(w.meta["total_out"] ?? 0) + amount;
      else w.meta["total_in"] = Number(w.meta["total_in"] ?? 0) + amount;
      if (tx.timestamp) {
        const first = w.meta["first_seen"] as number | null;
        const last = w.meta["last_seen"] as number | null;
        w.meta["first_seen"] = first === null ? tx.timestamp : Math.min(first, tx.timestamp);
        w.meta["last_seen"] = last === null ? tx.timestamp : Math.max(last, tx.timestamp);
        walletTimeline.set(wallet, [...(walletTimeline.get(wallet) ?? []), { ts: tx.timestamp, txid: tx.txid }]);
      }
      g.addEdge(txNode.id, w.id, direction === "in" ? "INPUT_FROM" : "OUTPUT_TO");
      g.addEdge(w.id, txNode.id, "PARTICIPATED_IN");
    }
  }

  // sequential wallet activity: wallet -> NEXT_TRANSACTION -> tx
  for (const [wallet, events] of walletTimeline) {
    const sorted = [...events].sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!prev || !cur) continue;
      g.addEdge(nodeId("wallet", wallet), nodeId("transaction", cur.txid), "NEXT_TRANSACTION");
    }
  }

  // IP metadata: how many wallets were observed alongside each IP
  for (const node of g.nodes.values()) {
    if (node.type !== "ip") continue;
    const wallets = new Set<string>();
    for (const txn of g.neighbors(node.id)) {
      for (const nb of g.neighbors(txn)) {
        if (g.nodes.get(nb)?.type === "wallet") wallets.add(nb);
      }
    }
    node.meta["associated_wallet_count"] = wallets.size;
  }

  return g;
}
