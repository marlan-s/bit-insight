import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildGraph, nodeId } from "./pipeline/graph";
import { generateDataset, toCsv } from "./pipeline/generator";
import { ingest } from "./pipeline/normalize";
import { runPipeline } from "./pipeline/index";
import type { NormalizedTx } from "./pipeline/types";
import { summarizeBurst } from "./pipeline/investigate";

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
    const scored: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: page } = await client
        .from("entities")
        .select("entity_id,entity_type,risk_score,features")
        .eq("dataset_id", data.datasetId)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      scored.push(...(page ?? []));
      if ((page ?? []).length < 1000) break;
    }
    const scoredRows = scored as {
      entity_id: string;
      entity_type: string;
      risk_score: number;
      features: Record<string, number> | null;
    }[];
    for (const s of scoredRows) riskByEntity.set(`${s.entity_type}:${s.entity_id}`, s.risk_score);
    const walletFeatureRows = scoredRows.filter((s) => s.entity_type === "wallet");

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

    const sorted = relatedTxs
      .filter((t) => t.timestamp)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    // Burst baseline = dataset average of the burst_score feature over scored wallets (computed by the pipeline).
    const burstVals = walletFeatureRows
      .map((r) => r.features?.["burst_score"])
      .filter((v): v is number => typeof v === "number");
    // Prefer the exact average the model used when explaining this entity; else recompute from stored features.
    const explAvg = ((entity as { explanation?: { feature: string; datasetAverage: number }[] } | null)?.explanation ?? [])
      .find((x) => x.feature === "burst_score")?.datasetAverage;
    const burstBaseline = typeof explAvg === "number" ? explAvg : burstVals.length ? burstVals.reduce((a, b) => a + b, 0) / burstVals.length : null;
    const burst = summarizeBurst(
      sorted.map((t) => t.timestamp as number),
      burstBaseline,
    );
    const isWallet = type === "wallet";
    const timeline = sorted
      .map((t, i, arr) => {
        const prev = arr[i - 1]?.timestamp ?? null;
        const gapMin = prev && t.timestamp ? (t.timestamp - prev) / 60000 : null;
        return {
          txid: t.txid,
          timestamp: t.timestamp,
          amount: t.output_amount ?? t.input_amount ?? 0,
          direction: isWallet ? (t.input_wallet === data.entityId ? "out" : "in") : null,
          counterparty: isWallet
            ? t.input_wallet === data.entityId
              ? t.output_wallet
              : t.input_wallet
            : `${t.input_wallet ?? "?"} → ${t.output_wallet ?? "?"}`,
          source_ip: t.source_ip,
          destination_ip: t.destination_ip,
          gapMinutes: gapMin,
          burst: burst.detected && i >= burst.startIndex && i <= burst.endIndex,
        };
      })
      .slice(0, 500);

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
      burst,
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

/** All scored entities (light columns) for client-side search/filter/sort. Paged past the 1000-row cap. */
export const getAllAlerts = createServerFn({ method: "POST" })
  .inputValidator((input: { datasetId: string }) => input)
  .handler(async ({ data }) => {
    const client = db();
    const all: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await client
        .from("entities")
        .select("entity_id,entity_type,risk_score,primary_reason,tx_count,ip_count,last_seen,scenario")
        .eq("dataset_id", data.datasetId)
        .order("risk_score", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      all.push(...(rows ?? []));
      if ((rows ?? []).length < 1000) break;
    }
    return all as {
      entity_id: string; entity_type: string; risk_score: number; primary_reason: string | null;
      tx_count: number; ip_count: number; last_seen: string | null; scenario: string | null;
    }[];
  });

/** Case-insensitive search across wallet addresses, IPs and TXIDs in stored transactions. */
export const searchRelated = createServerFn({ method: "POST" })
  .inputValidator((input: { datasetId: string; query: string }) => {
    const q = (input?.query ?? "").trim().slice(0, 120).replace(/[%,()*\\]/g, "");
    return { datasetId: input.datasetId, query: q };
  })
  .handler(async ({ data }) => {
    if (data.query.length < 2) return { related: [] as string[], ips: [] as string[], txCount: 0 };
    const like = `%${data.query}%`;
    const { data: rows, error } = await db()
      .from("transactions")
      .select("txid,input_wallet,output_wallet,source_ip,destination_ip")
      .eq("dataset_id", data.datasetId)
      .or(
        `txid.ilike.${like},input_wallet.ilike.${like},output_wallet.ilike.${like},source_ip.ilike.${like},destination_ip.ilike.${like}`,
      )
      .limit(1000);
    if (error) throw new Error(error.message);
    const q = data.query.toLowerCase();
    const related = new Set<string>();
    const ips = new Set<string>();
    for (const r of (rows ?? []) as { txid: string; input_wallet: string | null; output_wallet: string | null; source_ip: string | null; destination_ip: string | null }[]) {
      related.add(`transaction:${r.txid}`);
      for (const w of [r.input_wallet, r.output_wallet]) if (w && w.toLowerCase().includes(q)) related.add(`wallet:${w}`);
      for (const ip of [r.source_ip, r.destination_ip]) if (ip && ip.toLowerCase().includes(q)) ips.add(ip);
    }
    return { related: [...related], ips: [...ips].slice(0, 20), txCount: (rows ?? []).length };
  });
