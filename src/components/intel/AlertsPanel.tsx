import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { getAlerts } from "@/lib/intel.functions";
import { fmtTime, Panel, RiskBadge, TypeBadge } from "./ui";

export interface AlertRow {
  entity_id: string;
  entity_type: string;
  risk_score: number;
  primary_reason: string | null;
  tx_count: number;
  ip_count: number;
  last_seen: string | null;
  scenario: string | null;
}

export default function AlertsPanel({
  datasetId,
  onInvestigate,
}: {
  datasetId: string;
  onInvestigate: (entityId: string, entityType: string) => void;
}) {
  const [type, setType] = useState("all");
  const [asc, setAsc] = useState(false);
  const fetchAlerts = useServerFn(getAlerts);
  const q = useQuery({
    queryKey: ["alerts", datasetId, type],
    queryFn: () => fetchAlerts({ data: { datasetId, entityType: type, limit: 80 } }),
  });

  const rows = [...((q.data ?? []) as AlertRow[])].sort((a, b) =>
    asc ? a.risk_score - b.risk_score : b.risk_score - a.risk_score,
  );

  return (
    <Panel
      title="Ranked investigation leads"
      action={
        <div className="flex gap-1">
          {["all", "wallet", "transaction"].map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded border px-2 py-0.5 font-mono text-[11px] uppercase ${
                type === t ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      }
    >
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading alerts…</p> : null}
      {!q.isLoading && !rows.length ? (
        <p className="text-sm text-muted-foreground">No scored entities yet. Run the AI analysis first.</p>
      ) : null}
      {rows.length ? (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="label-xs sticky top-0 bg-surface">
              <tr>
                <th className="py-2">#</th>
                <th className="py-2">Entity</th>
                <th className="py-2">Type</th>
                <th className="cursor-pointer py-2" onClick={() => setAsc((v) => !v)}>
                  Risk {asc ? "▲" : "▼"}
                </th>
                <th className="py-2">Primary reason</th>
                <th className="py-2">Tx</th>
                <th className="py-2">IPs</th>
                <th className="py-2">Last seen</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.entity_type}:${r.entity_id}`}
                  onClick={() => onInvestigate(r.entity_id, r.entity_type)}
                  className="cursor-pointer border-t border-border font-mono text-xs hover:bg-muted/40"
                >
                  <td className="py-2 text-muted-foreground">{i + 1}</td>
                  <td className="max-w-[210px] truncate py-2 text-foreground">{r.entity_id}</td>
                  <td className="py-2">
                    <TypeBadge type={r.entity_type} />
                  </td>
                  <td className="py-2">
                    <RiskBadge score={r.risk_score} />
                  </td>
                  <td className="max-w-[240px] truncate py-2">{r.primary_reason ?? "—"}</td>
                  <td className="py-2">{r.tx_count}</td>
                  <td className="py-2">{r.ip_count}</td>
                  <td className="py-2">{fmtTime(r.last_seen)}</td>
                  <td className="py-2 text-muted-foreground">
                    {r.risk_score >= 70 ? "Requires analyst review" : "Monitor"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Scores are behavioural anomaly / investigation-priority indicators produced by the Isolation Forest detector.
        They are not evidence of criminal activity or wallet ownership.
      </p>
    </Panel>
  );
}
