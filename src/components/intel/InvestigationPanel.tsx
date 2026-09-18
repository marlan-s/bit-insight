import { ClientOnly } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useEffect, useState } from "react";

import { expandNode, getEntityDetail } from "@/lib/intel.functions";
import { fmtTime, num, Panel, RiskBadge, riskLevel, TypeBadge } from "./ui";
import type { GraphEdgeData, GraphNodeData } from "./GraphCanvas";

const GraphCanvas = lazy(() => import("./GraphCanvas"));

interface ExplanationItem {
  feature: string;
  label: string;
  value: number;
  datasetAverage: number;
  zScore: number;
  contribution: number;
  text: string;
}

export default function InvestigationPanel({
  datasetId,
  entityId,
  entityType,
  onInvestigate,
}: {
  datasetId: string;
  entityId: string | null;
  entityType: string;
  onInvestigate: (id: string, type: string) => void;
}) {
  const fetchDetail = useServerFn(getEntityDetail);
  const expand = useServerFn(expandNode);
  const [extra, setExtra] = useState<{ nodes: GraphNodeData[]; edges: GraphEdgeData[] }>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<GraphNodeData | null>(null);

  const q = useQuery({
    queryKey: ["entity", datasetId, entityType, entityId],
    enabled: Boolean(entityId),
    queryFn: () => fetchDetail({ data: { datasetId, entityId: entityId as string, entityType, hops: 1 } }),
  });

  useEffect(() => {
    setExtra({ nodes: [], edges: [] });
    setSelected(null);
  }, [entityId, entityType]);

  if (!entityId) {
    return (
      <Panel title="Investigation">
        <p className="text-sm text-muted-foreground">
          Select an entity in the Risk Alerts table to open its evidence and correlation graph.
        </p>
      </Panel>
    );
  }
  if (q.isLoading) return <Panel title="Investigation">Loading entity…</Panel>;
  if (q.error) return <Panel title="Investigation">{(q.error as Error).message}</Panel>;

  const detail = q.data;
  const entity = detail?.entity as
    | { risk_score: number; primary_reason: string | null; explanation: ExplanationItem[]; features: Record<string, number>; scenario: string | null }
    | null
    | undefined;
  const evidence = detail?.evidence;
  const timeline = detail?.timeline ?? [];

  const baseNodes = (detail?.graph.nodes ?? []) as GraphNodeData[];
  const baseEdges = (detail?.graph.edges ?? []) as GraphEdgeData[];
  const nodeMap = new Map<string, GraphNodeData>();
  for (const n of [...baseNodes, ...extra.nodes]) nodeMap.set(n.id, n);
  const edgeMap = new Map<string, GraphEdgeData>();
  for (const e of [...baseEdges, ...extra.edges]) edgeMap.set(e.id, e);
  const center = `${entityType}:${entityId}`;

  const doExpand = async (node: GraphNodeData) => {
    const res = await expand({ data: { datasetId, nodeId: node.id } });
    setExtra((prev) => ({
      nodes: [...prev.nodes, ...(res.nodes as GraphNodeData[])],
      edges: [...prev.edges, ...(res.edges as GraphEdgeData[])],
    }));
  };

  const risk = entity?.risk_score ?? 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
      <div className="space-y-4">
        <Panel
          title="Entity"
          action={
            <div className="flex items-center gap-2">
              <TypeBadge type={entityType} />
              {entity ? <RiskBadge score={risk} /> : null}
            </div>
          }
        >
          <div className="font-mono text-lg break-all text-foreground">{entityId}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {entity ? (
              <>
                Risk level: <span className="text-foreground">{riskLevel(risk).label}</span> · Primary reason:{" "}
                <span className="text-foreground">{entity.primary_reason}</span>
              </>
            ) : (
              "This node was not scored directly (network observation node)."
            )}
          </div>

          {entity?.explanation?.length ? (
            <div className="mt-4">
              <div className="label-xs">Why this was flagged — model feature evidence</div>
              <ul className="mt-2 space-y-2">
                {entity.explanation.map((x) => (
                  <li key={x.feature} className="rounded border border-border bg-background/50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-foreground">{x.label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {(x.contribution * 100).toFixed(0)}% of model evidence
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-xs">
                      <span className="text-primary">{num(x.value, 2)}</span>
                      <span className="text-muted-foreground"> vs dataset average {num(x.datasetAverage, 2)} </span>
                      <span className={x.zScore >= 0 ? "text-critical" : "text-low"}>
                        ({Math.abs(x.zScore).toFixed(1)} sd {x.zScore >= 0 ? "above" : "below"})
                      </span>
                    </div>
                    <div className="mt-1 h-1 w-full rounded bg-muted">
                      <div className="h-full rounded bg-accent" style={{ width: `${Math.min(100, x.contribution * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 rounded border border-primary/30 bg-primary/10 p-2 text-xs text-foreground">
            {risk >= 70
              ? "High-priority entity for analyst review. Observed associations are behavioural indicators, not proof of ownership or wrongdoing."
              : "Low investigation priority based on current behavioural evidence."}
          </div>
        </Panel>

        <Panel
          title="Correlation graph — IP ⇄ transaction ⇄ wallet"
          action={<span className="label-xs">click = details · double-click = expand neighbours</span>}
        >
          <ClientOnly fallback={<div className="h-[460px] animate-pulse rounded bg-muted/40" />}>
            <Suspense fallback={<div className="h-[460px] animate-pulse rounded bg-muted/40" />}>
              <GraphCanvas
                nodes={[...nodeMap.values()]}
                edges={[...edgeMap.values()]}
                center={center}
                onSelect={setSelected}
                onExpand={doExpand}
              />
            </Suspense>
          </ClientOnly>
          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-wallet" /> wallet
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 bg-transaction" /> transaction
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rotate-45 bg-ip" /> ip
            </span>
            <span>{nodeMap.size} nodes · {edgeMap.size} edges</span>
          </div>
          {selected ? (
            <div className="mt-3 rounded border border-border bg-background/50 p-3">
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm break-all">{selected.label}</div>
                <div className="flex gap-2">
                  <TypeBadge type={selected.type} />
                  <button
                    onClick={() => onInvestigate(selected.label, selected.type)}
                    className="rounded border border-accent/50 px-2 py-0.5 font-mono text-[11px] uppercase text-accent"
                  >
                    Investigate
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-3">
                {Object.entries(selected.meta ?? {}).map(([k, v]) => (
                  <div key={k} className="truncate">
                    {k}:{" "}
                    <span className="text-foreground">
                      {k.includes("seen") || k === "timestamp" ? fmtTime(v as number) : String(v ?? "—")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Evidence">
          {evidence ? (
            <div className="space-y-3 text-sm">
              <Section title="Network observations">
                <div className="font-mono text-xs">
                  first observed {fmtTime(evidence.firstSeen)} · last observed {fmtTime(evidence.lastSeen)}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {evidence.ips.slice(0, 14).map((ip) => (
                    <button
                      key={ip.ip}
                      onClick={() => onInvestigate(ip.ip, "ip")}
                      className="rounded border border-ip/40 bg-ip/10 px-1.5 py-0.5 font-mono text-[11px] text-ip"
                    >
                      {ip.ip} ×{ip.count}
                    </button>
                  ))}
                  {!evidence.ips.length ? <span className="text-xs text-muted-foreground">none recorded</span> : null}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Observed association only — an IP does not identify the wallet holder.
                </p>
              </Section>

              <Section title="Graph evidence">
                <div className="font-mono text-xs">
                  degree {evidence.degree} · connected component {evidence.componentSize} nodes · suspicious neighbours{" "}
                  {evidence.suspiciousNeighbours.length}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {evidence.suspiciousNeighbours.map((n) => (
                    <button
                      key={n.wallet}
                      onClick={() => onInvestigate(n.wallet, "wallet")}
                      className="rounded border border-critical/40 bg-critical/10 px-1.5 py-0.5 font-mono text-[11px] text-critical"
                    >
                      {n.wallet.slice(0, 16)} · {n.risk}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Counterparties">
                <div className="flex flex-wrap gap-1">
                  {evidence.counterparties.slice(0, 14).map((c) => (
                    <button
                      key={c.wallet}
                      onClick={() => onInvestigate(c.wallet, "wallet")}
                      className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {c.wallet.slice(0, 16)} ×{c.count}
                    </button>
                  ))}
                </div>
              </Section>

              {entity?.features ? (
                <Section title="Behavioural features">
                  <div className="grid grid-cols-2 gap-1 font-mono text-[11px]">
                    {Object.entries(entity.features)
                      .slice(0, 16)
                      .map(([k, v]) => (
                        <div key={k} className="truncate rounded border border-border bg-background/50 px-1.5 py-1">
                          {k}: <span className="text-primary">{num(v as number, 2)}</span>
                        </div>
                      ))}
                  </div>
                </Section>
              ) : null}
            </div>
          ) : null}
        </Panel>

        <Panel title={`Timeline (${timeline.length} events)`}>
          <div className="max-h-[320px] space-y-1 overflow-auto font-mono text-[11px]">
            {timeline.map((t) => (
              <div
                key={t.txid}
                className={`flex items-center gap-2 rounded px-2 py-1 ${
                  t.burst ? "border border-critical/40 bg-critical/10" : "bg-background/40"
                }`}
              >
                <span className="text-muted-foreground">{fmtTime(t.timestamp).slice(11, 19)}</span>
                <span className={t.direction === "out" ? "text-high" : "text-low"}>{t.direction}</span>
                <span>{num(t.amount, 4)} BTC</span>
                <button
                  onClick={() => onInvestigate(t.txid, "transaction")}
                  className="truncate text-accent hover:underline"
                >
                  {t.txid}
                </button>
                {t.gapMinutes !== null ? (
                  <span className="ml-auto text-muted-foreground">+{num(t.gapMinutes, 1)}m</span>
                ) : null}
                {t.burst ? <span className="text-critical">burst</span> : null}
              </div>
            ))}
            {!timeline.length ? <p className="text-xs text-muted-foreground">No timestamped activity.</p> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-xs mb-1">{title}</div>
      {children}
    </div>
  );
}
