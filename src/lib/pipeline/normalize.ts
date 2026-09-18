import type { IngestIssue, IngestResult, NormalizedTx } from "./types";

/** Canonical field -> accepted aliases (lowercased, non-alphanumeric stripped). */
const ALIASES: Record<string, string[]> = {
  timestamp: ["timestamp", "time", "ts", "datetime", "date", "blocktime", "observedat", "seentime"],
  source_ip: ["sourceip", "srcip", "ipsrc", "fromip", "origin_ip", "originip", "ip", "clientip"],
  source_port: ["sourceport", "srcport", "portsrc", "fromport", "clientport"],
  destination_ip: ["destinationip", "dstip", "destip", "toip", "peerip", "serverip"],
  destination_port: ["destinationport", "dstport", "destport", "toport", "serverport"],
  txid: ["txid", "transactionid", "txhash", "hash", "transaction", "txnid", "tx"],
  input_wallet: ["inputwallet", "fromwallet", "sender", "senderwallet", "inputaddress", "fromaddress", "srcwallet", "inaddr"],
  output_wallet: ["outputwallet", "towallet", "receiver", "receiverwallet", "outputaddress", "toaddress", "dstwallet", "outaddr"],
  input_amount: ["inputamount", "amountin", "valuein", "inamount", "sentamount", "amount"],
  output_amount: ["outputamount", "amountout", "valueout", "outamount", "receivedamount", "value"],
  fee: ["fee", "txfee", "minerfee", "feebtc"],
  script_type: ["scripttype", "script", "type", "outputtype", "addresstype"],
  scenario: ["scenario", "label", "groundtruth", "pattern"],
};

const REQUIRED: (keyof NormalizedTx)[] = ["txid"];

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function buildFieldMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const k = key(header);
    for (const [canonical, aliases] of Object.entries(ALIASES)) {
      if (mapping[header]) break;
      if (aliases.includes(k)) mapping[header] = canonical;
    }
  }
  return mapping;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9eE+.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.trunc(n);
}

export function parseTimestamp(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  const raw = String(v).trim();
  if (/^\d{10}$/.test(raw)) return Number(raw) * 1000;
  if (/^\d{13}$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") + "Z" : raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Map one raw record (already key/value) onto the canonical schema. */
export function normalizeRecord(raw: Record<string, unknown>, mapping: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(raw)) {
    const canonical = mapping[rawKey] ?? mapping[key(rawKey)];
    if (canonical) out[canonical] = value;
  }
  const tx: NormalizedTx = {
    txid: str(out["txid"]) ?? "",
    timestamp: parseTimestamp(out["timestamp"]),
    source_ip: str(out["source_ip"]),
    source_port: toInt(out["source_port"]),
    destination_ip: str(out["destination_ip"]),
    destination_port: toInt(out["destination_port"]),
    input_wallet: str(out["input_wallet"]),
    output_wallet: str(out["output_wallet"]),
    input_amount: toNumber(out["input_amount"]),
    output_amount: toNumber(out["output_amount"]),
    fee: toNumber(out["fee"]),
    script_type: str(out["script_type"]),
    scenario: str(out["scenario"]),
  };
  return tx;
}

function validate(tx: NormalizedTx): string | null {
  for (const field of REQUIRED) {
    if (!tx[field]) return `missing required field: ${field}`;
  }
  if (!tx.input_wallet && !tx.output_wallet) return "no wallet information (input_wallet/output_wallet)";
  if (tx.input_amount !== null && tx.input_amount < 0) return "negative input_amount";
  if (tx.output_amount !== null && tx.output_amount < 0) return "negative output_amount";
  return null;
}

// ---------- CSV ----------

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------- XML ----------

export function parseXmlRecords(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  // Records are any repeated element containing leaf children.
  const blocks = text.match(/<([A-Za-z_][\w.-]*)\b[^>]*>[\s\S]*?<\/\1>/g) ?? [];
  for (const block of blocks) {
    const inner = block.replace(/^<[^>]+>/, "").replace(/<\/[^>]+>$/, "");
    if (/<[A-Za-z_][\w.-]*\b[^>]*>[\s\S]*?<[A-Za-z_][\w.-]*\b[^>]*>[\s\S]*?<\//.test(inner) === false && !/</.test(inner)) continue;
    const leaves = [...inner.matchAll(/<([A-Za-z_][\w.-]*)\b[^>]*>([^<]*)<\/\1>/g)];
    if (leaves.length < 2) continue;
    const rec: Record<string, unknown> = {};
    for (const m of leaves) rec[m[1] ?? ""] = (m[2] ?? "").trim();
    // attributes on the record element itself
    const attrs = [...(block.match(/^<[^>]+>/)?.[0] ?? "").matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)];
    for (const a of attrs) rec[a[1] ?? ""] = a[2];
    records.push(rec);
  }
  return records;
}

function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, prefix ? `${prefix}_${k}` : k, out);
      else out[prefix ? `${prefix}_${k}` : k] = v;
    }
  }
  return out;
}

export function detectFormat(filename: string, text: string): "csv" | "json" | "xml" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".csv")) return "csv";
  const head = text.trimStart()[0];
  if (head === "{" || head === "[") return "json";
  if (head === "<") return "xml";
  return "csv";
}

/** Parse + normalize an uploaded file of any supported format. */
export function ingest(filename: string, text: string): IngestResult {
  const format = detectFormat(filename, text);
  if (!text.trim()) throw new Error("The file is empty.");

  let rawRecords: Record<string, unknown>[] = [];

  if (format === "csv") {
    const rows = parseCsvRows(text);
    if (rows.length < 2) throw new Error("The CSV file has no data rows.");
    const headers = (rows[0] ?? []).map((h) => h.trim());
    rawRecords = rows.slice(1).map((r) => {
      const rec: Record<string, unknown> = {};
      headers.forEach((h, i) => (rec[h] = r[i]));
      return rec;
    });
  } else if (format === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("The JSON file could not be parsed. Check for a trailing comma or missing bracket.");
    }
    const arr = Array.isArray(parsed)
      ? parsed
      : ((parsed as Record<string, unknown>)?.["transactions"] ??
          (parsed as Record<string, unknown>)?.["records"] ??
          (parsed as Record<string, unknown>)?.["data"]);
    if (!Array.isArray(arr)) throw new Error("The JSON file must contain an array of transaction records.");
    rawRecords = arr.map((r) => flatten(r));
  } else {
    rawRecords = parseXmlRecords(text);
    if (!rawRecords.length) throw new Error("No transaction records were found in the XML file.");
  }

  if (!rawRecords.length) throw new Error("No records were found in the file.");

  const detectedFields = Array.from(new Set(rawRecords.flatMap((r) => Object.keys(r))));
  const mapping = buildFieldMapping(detectedFields);
  const mappedCanonical = new Set(Object.values(mapping));
  if (!mappedCanonical.has("txid")) {
    throw new Error(
      `No transaction id column found. Detected columns: ${detectedFields.slice(0, 12).join(", ")}`,
    );
  }

  const issues: IngestIssue[] = [];
  const seen = new Set<string>();
  const records: NormalizedTx[] = [];
  let duplicateCount = 0;

  rawRecords.forEach((raw, i) => {
    let tx: NormalizedTx;
    try {
      tx = normalizeRecord(raw, mapping);
    } catch {
      issues.push({ row: i + 1, reason: "record could not be read" });
      return;
    }
    const error = validate(tx);
    if (error) {
      issues.push({ row: i + 1, reason: error });
      return;
    }
    const dedupe = `${tx.txid}|${tx.input_wallet}|${tx.output_wallet}|${tx.output_amount}`;
    if (seen.has(dedupe)) {
      duplicateCount++;
      return;
    }
    seen.add(dedupe);
    records.push(tx);
  });

  if (!records.length) {
    throw new Error(
      `All ${rawRecords.length} records were rejected. First problem: ${issues[0]?.reason ?? "unknown"}`,
    );
  }

  return {
    format,
    records,
    detectedFields,
    fieldMapping: mapping,
    totalRows: rawRecords.length,
    validCount: records.length,
    invalidCount: issues.length,
    duplicateCount,
    issues: issues.slice(0, 50),
  };
}
