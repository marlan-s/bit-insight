// Canonical internal schema shared by ingestion, graph, features, ML and UI.

export interface NormalizedTx {
  txid: string;
  timestamp: number | null; // epoch ms
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
  scenario: string | null; // internal evaluation label only (never used by the detector)
}

export interface IngestIssue {
  row: number;
  reason: string;
}

export interface IngestResult {
  format: "csv" | "json" | "xml";
  records: NormalizedTx[];
  detectedFields: string[];
  fieldMapping: Record<string, string>;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  issues: IngestIssue[];
}

export type EntityType = "wallet" | "transaction" | "ip";

export interface ExplanationItem {
  feature: string;
  label: string;
  value: number;
  datasetAverage: number;
  zScore: number;
  contribution: number; // 0..1 share of the explanation
  text: string;
}

export interface ScoredEntity {
  entity_id: string;
  entity_type: EntityType;
  risk_score: number; // 0..100
  anomaly_score: number; // raw isolation-forest score 0..1
  primary_reason: string;
  tx_count: number;
  ip_count: number;
  last_seen: number | null;
  features: Record<string, number>;
  explanation: ExplanationItem[];
  scenario: string | null;
}

export interface PipelineMetrics {
  model: string;
  trainedOn: number;
  featureCount: number;
  contamination: number;
  anomalyDistribution: { bucket: string; count: number }[];
  labelled: boolean;
  precision?: number;
  recall?: number;
  f1?: number;
  rocAuc?: number;
  confusion?: { tp: number; fp: number; tn: number; fn: number };
  scenarioCoverage?: { scenario: string; total: number; detected: number }[];
  classImbalance?: string;
}
