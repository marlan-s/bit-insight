import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getDatasetSummary } from "@/lib/intel.functions";
import { fmtTime, num, Panel, Stat } from "./ui";

interface Metrics {
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

export default function OverviewPanel({ datasetId }: { datasetId: string }) {
  const fetchSummary = useServerFn(getDatasetSummary);
  const q = useQuery({
    queryKey: ["summary", datasetId],
    queryFn: () => fetchSummary({ data: { datasetId } }),
  });

  if (q.isLoading) return <Panel title="Overview">Loading…</Panel>;
  if (q.error) return <Panel title="Overview">{(q.error as Error).message}</Panel>;

  const run = q.data?.run as { metrics: Metrics; summary: Record<string, never> } | null;
  const summary = run?.summary as unknown as
    | {
        transactions: number;
        wallets: number;
        ips: number;
        totalAmount: number;
        suspiciousWallets: number;
        suspiciousTransactions: number;
        timeRange: { from: number | null; to: number | null };
      }
    | undefined;
  const metrics = run?.metrics;

  if (!summary) {
    return (
      <Panel title="Overview">
        <p className="text-sm text-muted-foreground">
          This dataset has not been analysed yet. Open the Dataset tab and run the AI analysis.
        </p>
      </Panel>
    );
  }

  const maxBucket = Math.max(1, ...(metrics?.anomalyDistribution ?? []).map((b) => b.count));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Transactions" value={num(summary.transactions, 0)} />
        <Stat label="Wallets" value={num(summary.wallets, 0)} />
        <Stat label="IP addresses" value={num(summary.ips, 0)} />
        <Stat label="Total value" value={`${num(summary.totalAmount, 2)} BTC`} />
        <Stat label="Suspicious wallets" value={num(summary.suspiciousWallets, 0)} hint="risk ≥ 70" />
        <Stat label="Suspicious transactions" value={num(summary.suspiciousTransactions, 0)} hint="risk ≥ 70" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Dataset time range">
          <div className="space-y-1 font-mono text-sm">
            <div>First observation: {fmtTime(summary.timeRange.from)}</div>
            <div>Last observation: {fmtTime(summary.timeRange.to)}</div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            IP-to-wallet links are observed network correlations, not proof of wallet ownership or identity.
          </p>
        </Panel>

        <Panel title="Model evaluation">
          {metrics ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
                <Cell k="Model" v={metrics.model} />
                <Cell k="Entities scored" v={String(metrics.trainedOn)} />
                <Cell k="Features" v={String(metrics.featureCount)} />
                <Cell k="Flagged share" v={`${(metrics.contamination * 100).toFixed(1)}%`} />
                {metrics.labelled ? (
                  <>
                    <Cell k="Precision" v={metrics.precision?.toFixed(2) ?? "—"} />
                    <Cell k="Recall" v={metrics.recall?.toFixed(2) ?? "—"} />
                    <Cell k="F1" v={metrics.f1?.toFixed(2) ?? "—"} />
                    <Cell k="ROC-AUC" v={metrics.rocAuc?.toFixed(3) ?? "—"} />
                  </>
                ) : null}
              </div>

              <div>
                <div className="label-xs mb-1">Anomaly score distribution</div>
                <div className="space-y-1">
                  {metrics.anomalyDistribution.map((b) => (
                    <div key={b.bucket} className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="w-14 text-muted-foreground">{b.bucket}</span>
                      <span className="h-2 rounded bg-accent" style={{ width: `${(b.count / maxBucket) * 70}%` }} />
                      <span>{b.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {metrics.confusion ? (
                <div className="font-mono text-[11px] text-muted-foreground">
                  Confusion @ risk ≥ 70 — TP {metrics.confusion.tp} · FP {metrics.confusion.fp} · FN{" "}
                  {metrics.confusion.fn} · TN {metrics.confusion.tn}
                </div>
              ) : null}

              {metrics.scenarioCoverage?.length ? (
                <div>
                  <div className="label-xs mb-1">Scenario detection coverage (evaluation labels only)</div>
                  <div className="flex flex-wrap gap-1 font-mono text-[11px]">
                    {metrics.scenarioCoverage.map((s) => (
                      <span key={s.scenario} className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
                        {s.scenario}: {s.detected}/{s.total}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {metrics.classImbalance ? (
                <p className="text-xs text-muted-foreground">{metrics.classImbalance}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No model run recorded yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-border bg-background/50 px-2 py-1.5">
      <div className="label-xs">{k}</div>
      <div className="truncate text-foreground">{v}</div>
    </div>
  );
}
