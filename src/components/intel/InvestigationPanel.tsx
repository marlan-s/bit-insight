import { ClientOnly } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { expandNode, getEntityDetail } from "@/lib/intel.functions";
import { buildEvidence, formatFeature, priorityLabel } from "@/lib/pipeline/investigate";
import type { ExplanationItem } from "@/lib/pipeline/types";
import { fmtTime, num, Panel, RiskBadge, riskLevel, TypeBadge } from "./ui";
import type { GraphEdgeData, GraphNodeData } from "./GraphCanvas";

const PRIORITY_CLASS = { critical: "text-critical", high: "text-high", medium: "text-medium", low: "text-low" } as const;

const GraphCanvas = lazy(() => import("./GraphCanvas"));

interface TimelineEvent {
  txid: string;
  timestamp: number | null;
  amount: number;
  direction: string | null;
  counterparty: string | null;
  source_ip: string | null;
  destination_ip: string | null;
  gapMinutes: number | null;
  burst: boolean;
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
  const [activeTx, setActiveTx] = useState<TimelineEvent | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ["entity", datasetId, entityType, entityId],
    enabled: Boolean(entityId),
    queryFn: () => fetchDetail({ data: { datasetId, entityId: entityId as string, entityType, hops: 1 } }),
  });

  useEffect(() => {
    setExtra({ nodes: [], edges: [] });
    setSelected(null);
    setActiveTx(null);
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
  const timeline = (detail?.timeline ?? []) as TimelineEvent[];
  const burst = detail?.burst;

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
  const topEvidence = buildEvidence(entity?.explanation, entity?.features, 4);
  const suspiciousCount = entity?.features?.["suspicious_neighbor_count"];
  const showExposure =
    typeof suspiciousCount === "number" && !topEvidence.some((e) => e.feature === "suspicious_neighbor_count");
  const highlightId = activeTx ? `transaction:${activeTx.txid}` : null;
  const txInGraph = highlightId ? nodeMap.has(highlightId) : false;
  const pickTx = (t: TimelineEvent) => {
    setActiveTx(t);
    setSelected(nodeMap.get(`transaction:${t.txid}`) ?? null);
  };
  const scrollTo = (r: React.RefObject<HTMLDivElement | null>) => r.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-4">
      {/* 1. ENTITY HEADER */}
      <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TypeBadge type={entityType} />
            <span className="label-xs">Investigation lead</span>
          </div>
          <div className="mt-1 font-mono text-lg break-all text-foreground">{entityId}</div>
        </div>
        {entity ? <RiskBadge score={risk} /> : <span className="label-xs">not directly scored</span>}
      </section>

      {/* 2. WHY THIS ENTITY? */}
      <section className="panel border-primary/40" data-testid="why-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="font-mono text-sm tracking-wider text-primary">WHY THIS ENTITY?</h2>
          <div className="flex gap-2">
            <button onClick={() => scrollTo(graphRef)} className="rounded border border-accent/50 px-2 py-0.5 font-mono text-[11px] uppercase text-accent">
              Explore graph
            </button>
            <button onClick={() => scrollTo(timelineRef)} className="rounded border border-accent/50 px-2 py-0.5 font-mono text-[11px] uppercase text-accent">
              View timeline
            </button>
          </div>
        </header>
        <div className="grid gap-4 p-4 lg:grid-cols-[200px_1fr]">
          <div className="space-y-3">
            <div>
              <div className="label-xs">Risk score</div>
              <div className="font-mono text-4xl text-foreground">
                {entity ? risk : "—"}
                <span className="text-base text-muted-foreground"> / 100</span>
              </div>
            </div>
            <div>
              <div className="label-xs">Investigation priority</div>
              <div className={`font-mono text-lg ${PRIORITY_CLASS[riskLevel(risk).token]}`}>{entity ? priorityLabel(risk) : "—"}</div>
            </div>
            {burst?.detected ? (
              <div>
                <div className="label-xs">Activity window (burst)</div>
                <div className="font-mono text-xs text-foreground">
                  {fmtTime(burst.startTs).slice(11, 19)} – {fmtTime(burst.endTs).slice(11, 19)}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(burst.startTs).slice(0, 10)}</div>
              </div>
            ) : null}
          </div>

          <div>
            <div className="label-xs mb-2">Top evidence · ranked by contribution to the anomaly score</div>
            {topEvidence.length || showExposure ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {topEvidence.map((e) => (
                  <div key={e.feature} className="rounded border border-border bg-background/50 p-3" data-feature={e.feature}>
                    <div className="text-sm text-foreground">{e.title}</div>
                    <div className="mt-1 font-mono text-base text-primary">{e.observed}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {e.baseline ? `Dataset baseline: ${e.baseline}` : null}
                      {e.zScore !== null ? ` · ${Math.abs(e.zScore).toFixed(1)} sd ${e.zScore >= 0 ? "above" : "below"}` : null}
                    </div>
                  </div>
                ))}
                {showExposure ? (
                  <div className="rounded border border-border bg-background/50 p-3" data-feature="suspicious_neighbor_count">
                    <div className="text-sm text-foreground">Network exposure</div>
                    <div className="mt-1 font-mono text-base text-primary">
                      {formatFeature("suspicious_neighbor_count", suspiciousCount as number)}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No model feature evidence is available for this entity (it is a network observation node, not a scored entity).
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {risk >= 70
                ? "Behavioural anomaly detected — high investigation priority, requires analyst review. "
                : "Low investigation priority based on current behavioural evidence. "}
              Observed associations are indicators, not proof of ownership or wrongdoing.
            </p>
          </div>
        </div>
      </section>

      {/* 3. TIMELINE + DETAILS */}
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div ref={timelineRef} className="scroll-mt-4">
          <Panel title={`Behavioural timeline (${timeline.length} events)`}>
            {burst?.detected ? (
              <div className="mb-3 rounded border border-critical/40 bg-critical/10 p-3" data-testid="burst-summary">
                <div className="font-mono text-xs uppercase tracking-wider text-critical">Transaction burst detected</div>
                <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-sm text-foreground">
                  <div>{burst.count} transactions</div>
                  <div>{num(burst.durationMinutes, 1)} min</div>
                  <div>avg gap {burst.averageGapSeconds !== null ? `${num(burst.averageGapSeconds, 0)} s` : "—"}</div>
                </div>
                {burst.baselinePerWindow !== null ? (
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Observed: {burst.count} tx / 10 min · Dataset baseline: {num(burst.baselinePerWindow, 1)} tx / 10 min (average burst score)
                  </div>
                ) : null}
              </div>
            ) : timeline.length ? (
              <p className="mb-3 text-xs text-muted-foreground">No transaction burst above the dataset baseline.</p>
            ) : null}

            <ActivityStrip timeline={timeline} active={activeTx?.txid ?? null} onPick={pickTx} />

            <div className="mt-2 max-h-[320px] space-y-1 overflow-auto font-mono text-[11px]">
              {timeline.map((t) => (
                <button
                  key={t.txid}
                  onClick={() => pickTx(t)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
                    activeTx?.txid === t.txid
                      ? "border border-primary/60 bg-primary/10"
                      : t.burst
                        ? "border border-critical/40 bg-critical/10"
                        : "bg-background/40 hover:bg-muted/40"
                  }`}
                >
                  <span className="text-muted-foreground">{fmtTime(t.timestamp).slice(11, 19)}</span>
                  <span className="max-w-[110px] truncate text-accent">{t.txid}</span>
                  <span>{num(t.amount, 4)} BTC</span>
                  {t.source_ip ? <span className="text-ip">{t.source_ip}</span> : null}
                  {t.direction ? <span className={t.direction === "out" ? "text-high" : "text-low"}>{t.direction === "out" ? "→" : "←"}</span> : null}
                  <span className="truncate">{t.counterparty ?? "—"}</span>
                  {t.burst ? <span className="ml-auto text-critical">burst</span> : null}
                </button>
              ))}
              {!timeline.length ? <p className="text-xs text-muted-foreground">No timestamped activity.</p> : null}
            </div>

            {activeTx ? (
              <div className="mt-3 rounded border border-primary/40 bg-background/60 p-3 font-mono text-xs" data-testid="tx-detail">
                <div className="flex items-center justify-between gap-2">
                  <span className="break-all text-foreground">{activeTx.txid}</span>
                  <button onClick={() => onInvestigate(activeTx.txid, "transaction")} className="rounded border border-accent/50 px-2 py-0.5 text-[11px] uppercase text-accent">
                    Investigate
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-muted-foreground">
                  <div>time: <span className="text-foreground">{fmtTime(activeTx.timestamp)}</span></div>
                  <div>amount: <span className="text-foreground">{num(activeTx.amount, 6)} BTC</span></div>
                  <div>source IP: <span className="text-foreground">{activeTx.source_ip ?? "—"}</span></div>
                  <div>destination IP: <span className="text-foreground">{activeTx.destination_ip ?? "—"}</span></div>
                  <div>direction: <span className="text-foreground">{activeTx.direction ?? "—"}</span></div>
                  <div className="truncate">counterparty: <span className="text-foreground">{activeTx.counterparty ?? "—"}</span></div>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {txInGraph ? "Highlighted in the graph below." : "Not in the current graph view — expand neighbours to reach it."}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>

        <Panel title="Entity details">
          {evidence ? (
            <div className="space-y-3 text-sm">
              <Section title="Statistics">
                <div className="grid grid-cols-2 gap-1 font-mono text-xs">
                  <div>transactions: <span className="text-foreground">{evidence.transactionCount}</span></div>
                  <div>graph degree: <span className="text-foreground">{evidence.degree}</span></div>
                  <div>component: <span className="text-foreground">{evidence.componentSize} nodes</span></div>
                  <div>anomalous neighbours: <span className="text-foreground">{evidence.suspiciousNeighbours.length}</span></div>
                  <div className="col-span-2">first {fmtTime(evidence.firstSeen)} · last {fmtTime(evidence.lastSeen)}</div>
                </div>
              </Section>

              <Section title="IP observations">
                <div className="flex flex-wrap gap-1">
                  {evidence.ips.slice(0, 14).map((ip) => (
                    <button key={ip.ip} onClick={() => onInvestigate(ip.ip, "ip")} className="rounded border border-ip/40 bg-ip/10 px-1.5 py-0.5 font-mono text-[11px] text-ip">
                      {ip.ip} ×{ip.count}
                    </button>
                  ))}
                  {!evidence.ips.length ? <span className="text-xs text-muted-foreground">none recorded</span> : null}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Observed association only — an IP does not identify the wallet holder.</p>
              </Section>

              <Section title="Anomalous neighbours">
                <div className="flex flex-wrap gap-1">
                  {evidence.suspiciousNeighbours.map((n) => (
                    <button key={n.wallet} onClick={() => onInvestigate(n.wallet, "wallet")} className="rounded border border-critical/40 bg-critical/10 px-1.5 py-0.5 font-mono text-[11px] text-critical">
                      {n.wallet.slice(0, 16)} · {n.risk}
                    </button>
                  ))}
                  {!evidence.suspiciousNeighbours.length ? <span className="text-xs text-muted-foreground">none</span> : null}
                </div>
              </Section>

              <Section title="Counterparties">
                <div className="flex flex-wrap gap-1">
                  {evidence.counterparties.slice(0, 14).map((c) => (
                    <button key={c.wallet} onClick={() => onInvestigate(c.wallet, "wallet")} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
                      {c.wallet.slice(0, 16)} ×{c.count}
                    </button>
                  ))}
                </div>
              </Section>

              {entity?.explanation?.length ? (
                <Section title="All model feature evidence">
                  <ul className="space-y-1">
                    {entity.explanation.map((x) => (
                      <li key={x.feature} className="font-mono text-[11px]">
                        <span className="text-foreground">{x.label}</span>: <span className="text-primary">{num(x.value, 2)}</span>
                        <span className="text-muted-foreground"> vs avg {num(x.datasetAverage, 2)} · {(x.contribution * 100).toFixed(0)}%</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </div>
          ) : null}
        </Panel>
      </div>

      {/* 4. GRAPH */}
      <div ref={graphRef} className="scroll-mt-4">
        <Panel
          title="Investigation graph — IP ⇄ transaction ⇄ wallet"
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
                highlight={highlightId}
              />
            </Suspense>
          </ClientOnly>
          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-wallet" /> wallet</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 bg-transaction" /> transaction</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rotate-45 bg-ip" /> ip</span>
            <span data-testid="graph-count">{nodeMap.size} nodes · {edgeMap.size} edges</span>
            {selected ? (
              <button onClick={() => doExpand(selected)} className="rounded border border-accent/50 px-2 py-0.5 uppercase text-accent">
                Expand selected
              </button>
            ) : null}
          </div>
          {selected ? (
            <div className="mt-3 rounded border border-border bg-background/50 p-3">
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm break-all">{selected.label}</div>
                <div className="flex gap-2">
                  <TypeBadge type={selected.type} />
                  <button onClick={() => onInvestigate(selected.label, selected.type)} className="rounded border border-accent/50 px-2 py-0.5 font-mono text-[11px] uppercase text-accent">
                    Investigate
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-3">
                {Object.entries(selected.meta ?? {}).map(([k, v]) => (
                  <div key={k} className="truncate">
                    {k}: <span className="text-foreground">{k.includes("seen") || k === "timestamp" ? fmtTime(v as number) : String(v ?? "—")}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

/** Compact time strip: each tick is a real transaction positioned by its timestamp; burst ticks are red. */
function ActivityStrip({
  timeline,
  active,
  onPick,
}: {
  timeline: TimelineEvent[];
  active: string | null;
  onPick: (t: TimelineEvent) => void;
}) {
  const times = timeline.map((t) => t.timestamp).filter((t): t is number => t !== null);
  if (times.length < 2) return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  return (
    <div>
      <div className="relative h-10 rounded border border-border bg-background/50">
        {timeline.slice(0, 500).map((t) =>
          t.timestamp === null ? null : (
            <button
              key={t.txid}
              title={`${fmtTime(t.timestamp)} · ${num(t.amount, 4)} BTC`}
              onClick={() => onPick(t)}
              className={`absolute top-1 bottom-1 w-[3px] -translate-x-1/2 rounded ${
                active === t.txid ? "bg-primary" : t.burst ? "bg-critical" : "bg-muted-foreground/50"
              }`}
              style={{ left: `${((t.timestamp - min) / span) * 98 + 1}%` }}
            />
          ),
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{fmtTime(min)}</span>
        <span>{fmtTime(max)}</span>
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
