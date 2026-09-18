import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { listDatasets, loadDemoDataset, processDataset, uploadDataset } from "@/lib/intel.functions";
import { fmtTime, Panel } from "./ui";

interface IngestSummary {
  datasetId: string;
  name: string;
  format: string;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  detectedFields: string[];
  fieldMapping: Record<string, string>;
  issues: { row: number; reason: string }[];
}

export default function DatasetPanel({
  datasetId,
  onDataset,
  onAnalysed,
}: {
  datasetId: string | null;
  onDataset: (id: string) => void;
  onAnalysed: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ingest, setIngest] = useState<IngestSummary | null>(null);
  const [stage, setStage] = useState<string>("idle");
  const qc = useQueryClient();

  const upload = useServerFn(uploadDataset);
  const demo = useServerFn(loadDemoDataset);
  const process = useServerFn(processDataset);

  const datasets = useQuery({ queryKey: ["datasets"], queryFn: () => listDatasets() });

  const afterIngest = async (res: IngestSummary) => {
    setIngest(res);
    onDataset(res.datasetId);
    qc.invalidateQueries({ queryKey: ["datasets"] });
    setStage("Building graph, extracting features, training detector…");
    await process({ data: { datasetId: res.datasetId } });
    setStage("complete");
    qc.invalidateQueries();
    onAnalysed();
    toast.success("Analysis complete — ranked alerts are ready.");
  };

  const runUpload = useMutation({
    mutationFn: async (file: File) => {
      setStage("Parsing and normalising…");
      const text = await file.text();
      const res = (await upload({ data: { filename: file.name, content: text } })) as IngestSummary;
      await afterIngest(res);
    },
    onError: (e: Error) => {
      setStage("failed");
      toast.error(e.message || "The file could not be processed.");
    },
  });

  const runDemo = useMutation({
    mutationFn: async () => {
      setStage("Generating synthetic Bitcoin traffic…");
      const res = (await demo()) as IngestSummary;
      await afterIngest(res);
    },
    onError: (e: Error) => {
      setStage("failed");
      toast.error(e.message || "The demo dataset could not be loaded.");
    },
  });

  const reanalyse = useMutation({
    mutationFn: async () => {
      if (!datasetId) throw new Error("Select a dataset first.");
      setStage("Re-running AI analysis…");
      await process({ data: { datasetId } });
      setStage("complete");
      qc.invalidateQueries();
      onAnalysed();
      toast.success("AI analysis finished.");
    },
    onError: (e: Error) => {
      setStage("failed");
      toast.error(e.message);
    },
  });

  const busy = runUpload.isPending || runDemo.isPending || reanalyse.isPending;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <Panel title="1 · Ingest dataset">
        <p className="text-sm text-muted-foreground">
          Upload bulk Bitcoin transaction / network metadata as CSV, JSON or XML. Column aliases such as
          <span className="font-mono text-foreground"> src_ip</span>,
          <span className="font-mono text-foreground"> from_wallet</span> or
          <span className="font-mono text-foreground"> transaction_id</span> are mapped automatically.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.json,.xml,text/csv,application/json,text/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) runUpload.mutate(f);
              e.target.value = "";
            }}
          />
          <button
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="rounded border border-border bg-secondary px-3 py-2 font-mono text-xs uppercase tracking-wider text-secondary-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            Upload file
          </button>
          <button
            disabled={busy}
            onClick={() => runDemo.mutate()}
            className="rounded bg-primary px-3 py-2 font-mono text-xs uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Load demo dataset
          </button>
          <button
            disabled={busy || !datasetId}
            onClick={() => reanalyse.mutate()}
            className="rounded border border-accent/50 bg-accent/10 px-3 py-2 font-mono text-xs uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          >
            Run AI analysis
          </button>
        </div>

        <div className="mt-4 rounded border border-border bg-background/50 p-3 font-mono text-xs">
          <div className="label-xs mb-1">Pipeline status</div>
          <div className={busy ? "text-primary" : stage === "failed" ? "text-destructive" : "text-foreground"}>
            {busy ? stage : stage === "complete" ? "Correlate → Detect → Prioritize → Explain: complete" : stage}
          </div>
          {busy ? (
            <div className="mt-2 h-1 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
          ) : null}
        </div>

        {ingest ? (
          <div className="mt-4 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
              <Kv k="File" v={ingest.name} />
              <Kv k="Format" v={ingest.format.toUpperCase()} />
              <Kv k="Records" v={String(ingest.totalRows)} />
              <Kv k="Valid" v={String(ingest.validCount)} />
              <Kv k="Invalid" v={String(ingest.invalidCount)} />
              <Kv k="Duplicates" v={String(ingest.duplicateCount)} />
            </div>
            <div>
              <div className="label-xs mt-3">Detected schema mapping</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(ingest.fieldMapping).map(([raw, canonical]) => (
                  <span key={raw} className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px]">
                    {raw} → <span className="text-primary">{canonical}</span>
                  </span>
                ))}
              </div>
            </div>
            {ingest.issues.length ? (
              <div>
                <div className="label-xs mt-3">Rejected rows (first {ingest.issues.length})</div>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto font-mono text-[11px] text-destructive">
                  {ingest.issues.map((i) => (
                    <li key={i.row}>
                      row {i.row}: {i.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel title="Stored datasets">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="label-xs">
              <tr>
                <th className="pb-2">Name</th>
                <th className="pb-2">Format</th>
                <th className="pb-2">Valid</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {(datasets.data ?? []).map((d) => (
                <tr
                  key={d.id}
                  onClick={() => onDataset(d.id)}
                  className={`cursor-pointer border-t border-border hover:bg-muted/40 ${
                    d.id === datasetId ? "bg-primary/10" : ""
                  }`}
                >
                  <td className="max-w-[220px] truncate py-2">{d.name}</td>
                  <td className="py-2 uppercase">{d.source_format}</td>
                  <td className="py-2">{d.valid_count}</td>
                  <td className="py-2">{d.status}</td>
                  <td className="py-2">{fmtTime(d.created_at)}</td>
                </tr>
              ))}
              {!datasets.data?.length ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No datasets yet — load the demo dataset to start.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-border bg-background/50 px-2 py-1.5">
      <div className="label-xs">{k}</div>
      <div className="truncate text-foreground">{v}</div>
    </div>
  );
}
