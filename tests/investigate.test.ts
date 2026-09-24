import { describe, expect, it } from "vitest";
import {
  buildEvidence, DEFAULT_FILTERS, filterAlerts, generateDataset, ingest, isFiltered, maxWindow,
  runPipeline, summarizeBurst, toCsv, type AlertFilters,
} from "../src/lib/pipeline";

const T0 = Date.parse("2026-01-01T10:00:00Z");
const rows = [
  { entity_id: "Wallet_A", entity_type: "wallet", risk_score: 91, tx_count: 40, last_seen: new Date(T0).toISOString() },
  { entity_id: "wallet_b", entity_type: "wallet", risk_score: 65, tx_count: 5, last_seen: new Date(T0 - 3 * 3600e3).toISOString() },
  { entity_id: "tx_001", entity_type: "transaction", risk_score: 30, tx_count: 1, last_seen: new Date(T0 - 30 * 3600e3).toISOString() },
];
const F = (p: Partial<AlertFilters>) => ({ ...DEFAULT_FILTERS, ...p });

describe("search", () => {
  it("wallet search is case-insensitive", () => {
    expect(filterAlerts(rows, F({ query: "WALLET_a" })).map((r) => r.entity_id)).toEqual(["Wallet_A"]);
  });
  it("txid search", () => expect(filterAlerts(rows, F({ query: "TX_001" }))).toHaveLength(1));
  it("IP search via related transactions", () => {
    const related = new Set(["transaction:tx_001", "wallet:wallet_b"]);
    expect(filterAlerts(rows, F({ query: "10.0.0.4" }), { related }).map((r) => r.entity_id).sort()).toEqual(["tx_001", "wallet_b"]);
  });
  it("no results", () => expect(filterAlerts(rows, F({ query: "zzz" }))).toHaveLength(0));
});

describe("filters", () => {
  it("risk range", () => expect(filterAlerts(rows, F({ risk: "80-100" })).map((r) => r.entity_id)).toEqual(["Wallet_A"]));
  it("entity type", () => expect(filterAlerts(rows, F({ type: "transaction" }))).toHaveLength(1));
  it("time range relative to latest observation", () => {
    expect(filterAlerts(rows, F({ time: "1h" }), { referenceTs: T0 })).toHaveLength(1);
    expect(filterAlerts(rows, F({ time: "6h" }), { referenceTs: T0 })).toHaveLength(2);
    expect(filterAlerts(rows, F({ time: "24h" }), { referenceTs: T0 })).toHaveLength(2);
  });
  it("combined", () => expect(filterAlerts(rows, F({ type: "wallet", risk: "60-79", query: "wallet" }))).toHaveLength(1));
  it("clear filters restores all, sorted by risk desc", () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(filterAlerts(rows, DEFAULT_FILTERS).map((r) => r.risk_score)).toEqual([91, 65, 30]);
  });
  it("sorting", () => {
    expect(filterAlerts(rows, F({ sort: "name", asc: true })).map((r) => r.entity_id)).toEqual(["tx_001", "Wallet_A", "wallet_b"]);
    expect(filterAlerts(rows, F({ sort: "tx" }))[0]?.entity_id).toBe("Wallet_A");
    expect(filterAlerts(rows, F({ sort: "last_seen", asc: true }))[0]?.entity_id).toBe("tx_001");
  });
});

describe("burst timeline", () => {
  it("empty and single transaction", () => {
    expect(summarizeBurst([], 2).detected).toBe(false);
    const one = summarizeBurst([T0], 2);
    expect(one.count).toBe(1);
    expect(one.detected).toBe(false);
  });
  it("detects dense window with count, duration and avg gap", () => {
    const times = [T0, T0 + 3600e3, ...Array.from({ length: 6 }, (_, i) => T0 + 7200e3 + i * 20e3)];
    const b = summarizeBurst(times, 3);
    expect(b.detected).toBe(true);
    expect(b.count).toBe(6);
    expect(b.durationMinutes).toBeCloseTo(100 / 60);
    expect(b.averageGapSeconds).toBeCloseTo(20);
    expect(b.startIndex).toBe(2);
  });
  it("not reported when at or below dataset baseline", () => {
    expect(summarizeBurst([T0, T0 + 1e3, T0 + 2e3], 5).detected).toBe(false);
  });
  it("matches the pipeline burst_score feature", () => {
    const times = [T0, T0 + 1e3, T0 + 700e3];
    expect(maxWindow(times, 600e3).count).toBe(2);
  });
});

describe("evidence card", () => {
  const explanation = [
    { feature: "burst_score", label: "Burst", value: 12, datasetAverage: 2.5, zScore: 3.2, contribution: 0.4, text: "" },
    { feature: "made_up", label: "Missing", value: 1, datasetAverage: 1, zScore: 0, contribution: 0.1, text: "" },
  ];
  it("values come verbatim from features / explanation", () => {
    const ev = buildEvidence(explanation, { burst_score: 12 });
    expect(ev).toHaveLength(1);
    expect(ev[0]?.observed).toBe("12 tx in 10 min");
    expect(ev[0]?.baseline).toBe("2.5 tx in 10 min");
  });
  it("missing features produce no evidence instead of broken UI", () => {
    expect(buildEvidence(null, null)).toEqual([]);
    expect(buildEvidence(explanation, {})).toEqual([]);
  });
});

describe("end-to-end on demo dataset", () => {
  const result = runPipeline(ingest("demo.csv", toCsv(generateDataset())).records);
  it("ranks, searches, and explains a high-risk wallet with real values", () => {
    const alerts = result.entities.map((e) => ({ ...e, last_seen: e.last_seen ? new Date(e.last_seen).toISOString() : null }));
    const top = filterAlerts(alerts, F({ type: "wallet", risk: "80-100" }));
    expect(top.length).toBeGreaterThan(0);
    const w = top[0]!;
    expect(filterAlerts(alerts, F({ query: w.entity_id.toUpperCase() }))[0]?.entity_id).toBe(w.entity_id);
    const ev = buildEvidence(w.explanation, w.features);
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) expect(w.features[e.feature]).toBeTypeOf("number");
    expect(w.risk_score).toBe(result.entities.find((e) => e.entity_id === w.entity_id)?.risk_score);
  });
  it("burst window agrees with the burst_score feature for every wallet", () => {
    const g = result.graph;
    for (const e of result.entities.filter((x) => x.entity_type === "wallet").slice(0, 40)) {
      const times: number[] = [];
      for (const n of g.neighbors(`wallet:${e.entity_id}`)) {
        const ts = g.nodes.get(n)?.meta["timestamp"];
        if (typeof ts === "number") times.push(ts);
      }
      times.sort((a, b) => a - b);
      expect(maxWindow(times, 600e3).count).toBe(e.features["burst_score"]);
    }
  });
});
