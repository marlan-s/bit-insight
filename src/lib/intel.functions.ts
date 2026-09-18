import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildGraph, nodeId } from "./pipeline/graph";
import { generateDataset, toCsv } from "./pipeline/generator";
import { ingest } from "./pipeline/normalize";
import { runPipeline } from "./pipeline/index";
import type { NormalizedTx } from "./pipeline/types";

function db(): SupabaseClient {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input as RequestInfo, { ...init, headers: h });
      },
    },
  });
}

interface TxRow {
  ts: string | null;
  txid: string;
  source_ip: string | null;
  source_port: number | null;
  destination_ip: string | null;
  destination_port: number | null;
  input_wallet: string | null;
  output_wallet: string | null;
  input_amount: number | null;
  output_amount: number | null;
  fee: number | null;
  script_type: string | null;
  scenario: string | null;
}

const toTx = (r: TxRow): NormalizedTx => ({
  txid: r.txid,
  timestamp: r.ts ? Date.parse(r.ts) : null,
  source_ip: r.source_ip,
  source_port: r.source_port,
  destination_ip: r.destination_ip,
  destination_port: r.destination_port,
  input_wallet: r.input_wallet,
  output_wallet: r.output_wallet,
  input_amount: r.input_amount,
  output_amount: r.output_amount,
  fee: r.fee,
  script_type: r.script_type,
  scenario: r.scenario,
});

async function loadTransactions(client: SupabaseClient, datasetId: string): Promise<NormalizedTx[]> {
  const all: TxRow[] = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const { data, error } = await client
      .from("transactions")
      .select("ts,txid,source_ip,source_port,destination_ip,destination_port,input_wallet,output_wallet,input_amount,output_amount,fee,script_type,scenario")
      .eq("dataset_id", datasetId)
      .order("id", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as TxRow[];
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all.map(toTx);
}

async function insertDataset(client: SupabaseClient, name: string, text: string) {
  const result = ingest(name, text);
  const { data, error } = await client
    .from("datasets")
    .insert({
      name,
      source_format: result.format,
      record_count: result.totalRows,
      valid_count: result.validCount,
      invalid_count: result.invalidCount,
      detected_fields: result.detectedFields,
      field_mapping: result.fieldMapping,
      ingest_errors: result.issues,
      status: "ingested",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not save the dataset: ${error.message}`);
  const datasetId = (data as { id: string }).id;

  const rows = result.records.map((t) => ({
    dataset_id: datasetId,
    ts: t.timestamp ? new Date(t.timestamp).toISOString() : null,
    txid: t.txid,
    source_ip: t.source_ip,
    source_port: t.source_port,
    destination_ip: t.destination_ip,
    destination_port: t.destination_port,
    input_wallet: t.input_wallet,
    output_wallet: t.output_wallet,
    input_amount: t.input_amount,
    output_amount: t.output_amount,
    fee: t.fee,
    script_type: t.script_type,
    scenario: t.scenario,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await client.from("transactions").insert(rows.slice(i, i + 500));
    if (insErr) throw new Error(`Could not store transactions: ${insErr.message}`);
  }

  return {
    datasetId,
    name,
    format: result.format,
    totalRows: result.totalRows,
    validCount: result.validCount,
    invalidCount: result.invalidCount,
    duplicateCount: result.duplicateCount,
    detectedFields: result.detectedFields,
    fieldMapping: result.fieldMapping,
    issues: result.issues,
  };
}

export const health = createServerFn({ method: "GET" }).handler(async () => {
  const { error } = await db().from("datasets").select("id").limit(1);
  return { ok: !error, offline: true, detector: "IsolationForest", error: error?.message ?? null };
});

export const listDatasets = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await db()
    .from("datasets")
    .select("id,name,source_format,record_count,valid_count,invalid_count,status,created_at")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const uploadDataset = createServerFn({ method: "POST" })
  .inputValidator((input: { filename: string; content: string }) => {
    if (!input?.filename) throw new Error("A filename is required.");
    if (!input?.content?.trim()) throw new Error("The uploaded file is empty.");
    if (input.content.length > 20_000_000) throw new Error("The file is too large (limit 20 MB).");
    return input;
  })
  .handler(async ({ data }) => insertDataset(db(), data.filename, data.content));

export const loadDemoDataset = createServerFn({ method: "POST" }).handler(async () => {
  const csv = toCsv(generateDataset());
  return insertDataset(db(), `demo_bitcoin_traffic_${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

export const processDataset = createServerFn({ method: "POST" })
  .inputValidator((input: { datasetId: string }) => {
    if (!input?.datasetId) throw new Error("No dataset selected.");
    return input;
  })
  .handler(async ({ data }) => {
    const client = db();
    const txs = await loadTransactions(client, data.datasetId);
    if (txs.length < 5) throw new Error("This dataset is too small to analyse (at least 5 transactions are needed).");

    let result;
    try {
      result = runPipeline(txs);
    } catch (e) {
      throw new Error(`Model training failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }

    await client.from("entities").delete().eq("dataset_id", data.datasetId);
    const rows = result.entities.map((e) => ({
      dataset_id: data.datasetId,
      entity_id: e.entity_id,
      entity_type: e.entity_type,
      risk_score: e.risk_score,
      anomaly_score: e.anomaly_score,
      primary_reason: e.primary_reason,
      tx_count: e.tx_count,
      ip_count: e.ip_count,
      last_seen: e.last_seen ? new Date(e.last_seen).toISOString() : null,
      features: e.features,
      explanation: e.explanation,
      scenario: e.scenario,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await client.from("entities").insert(rows.slice(i, i + 500));
      if (error) throw new Error(`Could not store results: ${error.message}`);
    }

    await client.from("model_runs").insert({
      dataset_id: data.datasetId,
      model_type: "isolation_forest",
      params: { trees: 120, sampleSize: 256, seed: 42, threshold: 70 },
      metrics: result.metrics,
      summary: result.summary,
    });
    await client.from("datasets").update({ status: "analysed" }).eq("id", data.datasetId);

    return { summary: result.summary, metrics: result.metrics, entityCount: result.entities.length };
  });

export const getDatasetSummary = createServerFn({ method: "POST" })
  .inputValidator((input: { datasetId: string }) => input)
  .handler(async ({ data }) => {
    const client = db();
    const [{ data: dataset }, { data: run }] = await Promise.all([
      client.from("datasets").select("*").eq("id", data.datasetId).maybeSingle(),
      client
        .from("model_runs")
        .select("*")
        .eq("dataset_id", data.datasetId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!dataset) throw new Error("Dataset not found.");
    return { dataset, run: run ?? null };
  });

export const getAlerts = createServerFn({ method: "POST" })
  .inputValidator((input: { datasetId: string; entityType?: string; limit?: number }) => input)
  .handler(async ({ data }) => {
    let query = db()
      .from("entities")
      .select("entity_id,entity_type,risk_score,primary_reason,tx_count,ip_count,last_seen,scenario")
      .eq("dataset_id", data.datasetId)
      .order("risk_score", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.entityType && data.entityType !== "all") query = query.eq("entity_type", data.entityType);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getEntityDetail = createServerFn({ method: "POST" })
  .inputValidator((input: { datasetId: string; entityId: string; entityType: string; hops?: number }) => input)
  .handler(async ({ data }) => {
    const client = db();
    const { data: entity } = await client
      .from("entities")
      .select("*")
      .eq("dataset_id", data.datasetId)
      .eq("entity_id", data.entityId)
      .eq("entity_type", data.entityType)
      .maybeSingle();

    const txs = await loadTransactions(client, data.datasetId);
    const graph = buildGraph(txs);
    const type = data.entityType === "transaction" ? "transaction" : data.entityType === "ip" ? "ip" : "wallet";
    const center = nodeId(type, data.entityId);
    if (!graph.nodes.has(center)) throw new Error("This entity is not present in the dataset graph.");

    const { nodes, edges } = graph.subgraph(center, data.hops ?? 1, 150);
    const riskByEntity = new Map<string, number>();
    const { data: scored } = await client
      .from("entities")
      .select("entity_id,entity_type,risk_score")
      .eq("dataset_id", data.datasetId);
    for (const s of (scored ?? []) as { entity_id: string; entity_type: string; risk_score: number }[]) {
      riskByEntity.set(`${s.entity_type}:${s.entity_id}`, s.risk_score);
    }

    const relatedTxs = txs.filter(
      (t) =>
        (type === "wallet" && (t.input_wallet === data.entityId || t.output_wallet === data.entityId)) ||
        (type === "transaction" && t.txid === data.entityId) ||
        (type === "ip" && (t.source_ip === data.entityId || t.destination_ip === data.entityId)),
    );

    const ips = new Map<string, number>();
    const counterparties = new Map<string, number>();
    for (const t of relatedTxs) {
      for (const ip of [t.source_ip, t.destination_ip]) if (ip) ips.set(ip, (ips.get(ip) ?? 0) + 1);
      for (const w of [t.input_wallet, t.output_wallet])
        if (w && w !== data.entityId) counterparties.set(w, (counterparties.get(w) ?? 0) + 1);
    }

    const neighbourWallets = new Set<string>();
    for (const n of graph.neighbors(center)) {
      for (const nb of graph.neighbors(n)) {
        const node = graph.nodes.get(nb);
        if (node?.type === "wallet" && nb !== center) neighbourWallets.add(node.label);
      }
    }
    const suspiciousNeighbours = [...neighbourWallets]
      .map((w) => ({ wallet: w, risk: riskByEntity.get(`wallet:${w}`) ?? 0 }))
      .filter((n) => n.risk >= 60)
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 10);

    const timeline = relatedTxs
      .filter((t) => t.timestamp)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      .map((t, i, arr) => {
        const prev = arr[i - 1]?.timestamp ?? null;
        const gapMin = prev && t.timestamp ? (t.timestamp - prev) / 60000 : null;
        return {
          txid: t.txid,
          timestamp: t.timestamp,
          amount: t.output_amount ?? t.input_amount ?? 0,
          direction: t.input_wallet === data.entityId ? "out" : "in",
          counterparty: t.input_wallet === data.entityId ? t.output_wallet : t.input_wallet,
          source_ip: t.source_ip,
          gapMinutes: gapMin,
          burst: gapMin !== null && gapMin < 1.5,
        };
      })
      .slice(0, 300);

    const componentSize = graph.connectedComponents().get(center) ?? 1;

    return {
      entity: entity ?? null,
      node: graph.nodes.get(center) ?? null,
      graph: {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          label: n.label,
          risk: riskByEntity.get(`${n.type}:${n.label}`) ?? 0,
          meta: n.meta,
        })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type })),
      },
      evidence: {
        degree: graph.degree(center),
        componentSize,
        ips: [...ips.entries()].map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count),
        counterparties: [...counterparties.entries()]
          .map(([wallet, count]) => ({ wallet, count, risk: riskByEntity.get(`wallet:${wallet}`) ?? 0 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20),
        suspiciousNeighbours,
        transactionCount: relatedTxs.length,
        firstSeen: relatedTxs.reduce<number | null>((m, t) => (t.timestamp && (m === null || t.timestamp < m) ? t.timestamp : m), null),
        lastSeen: relatedTxs.reduce<number | null>((m, t) => (t.timestamp && (m === null || t.timestamp > m) ? t.timestamp : m), null),
      },
      timeline,
    };
  });

export const expandNode = createServerFn({ method: "POST" })
  .inputValidator((input: { datasetId: string; nodeId: string }) => input)
  .handler(async ({ data }) => {
    const client = db();
    const txs = await loadTransactions(client, data.datasetId);
    const graph = buildGraph(txs);
    if (!graph.nodes.has(data.nodeId)) throw new Error("Unknown node.");
    const { nodes, edges } = graph.subgraph(data.nodeId, 1, 80);
    const { data: scored } = await client
      .from("entities")
      .select("entity_id,entity_type,risk_score")
      .eq("dataset_id", data.datasetId);
    const riskByEntity = new Map(
      ((scored ?? []) as { entity_id: string; entity_type: string; risk_score: number }[]).map((s) => [
        `${s.entity_type}:${s.entity_id}`,
        s.risk_score,
      ]),
    );
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        risk: riskByEntity.get(`${n.type}:${n.label}`) ?? 0,
        meta: n.meta,
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type })),
    };
  });
