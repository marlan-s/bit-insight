import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";

import { getAllAlerts, searchRelated } from "@/lib/intel.functions";
import { DEFAULT_FILTERS, filterAlerts, isFiltered, type AlertFilters } from "@/lib/pipeline/investigate";
import { fmtTime, Panel, RiskBadge, TypeBadge } from "./ui";

const PAGE = 50;

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-xs">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function AlertsPanel({
  datasetId,
  onInvestigate,
}: {
  datasetId: string;
  onInvestigate: (entityId: string, entityType: string) => void;
}) {
  const [f, setF] = useState<AlertFilters>(DEFAULT_FILTERS);
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const fetchAll = useServerFn(getAllAlerts);
  const search = useServerFn(searchRelated);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(f.query.trim()), 250);
    return () => clearTimeout(t);
  }, [f.query]);
  useEffect(() => setPage(0), [f, debounced]);

  const q = useQuery({ queryKey: ["all-alerts", datasetId], queryFn: () => fetchAll({ data: { datasetId } }) });
  const rel = useQuery({
    queryKey: ["search", datasetId, debounced.toLowerCase()],
    enabled: debounced.length >= 2,
    queryFn: () => search({ data: { datasetId, query: debounced } }),
  });

  const all = q.data ?? [];
  const referenceTs = useMemo(
    () => all.reduce<number | null>((m, r) => {
      const t = r.last_seen ? Date.parse(r.last_seen) : NaN;
      return Number.isNaN(t) ? m : m === null || t > m ? t : m;
    }, null),
    [all],
  );
  const related = useMemo(() => new Set(rel.data?.related ?? []), [rel.data]);
  const rows = useMemo(
    () => filterAlerts(all, { ...f, query: debounced }, { related, referenceTs }),
    [all, f, debounced, related, referenceTs],
  );
  const suspicious = all.filter((r) => r.risk_score >= 70).length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const visible = rows.slice(page * PAGE, page * PAGE + PAGE);
  const set = (patch: Partial<AlertFilters>) => setF((p) => ({ ...p, ...patch }));
  const sortHeader = (key: string, label: string) => (
    <th
      className="cursor-pointer py-2 select-none"
      onClick={() => set(f.sort === key ? { asc: !f.asc } : { sort: key, asc: key === "name" })}
    >
      {label} {f.sort === key ? (f.asc ? "▲" : "▼") : ""}
    </th>
  );
  const ipMatches = f.type === "all" || f.type === "ip" ? (rel.data?.ips ?? []) : [];

  return (
    <Panel title="Ranked investigation leads">
      <div className="mb-3 grid gap-2 md:grid-cols-[2fr_repeat(4,1fr)_auto] md:items-end">
        <label className="flex flex-col gap-1">
          <span className="label-xs">Search wallet · IP · TXID</span>
          <input
            aria-label="Search entities"
            value={f.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="e.g. wallet address, 10.0.3.14, txid…"
            className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground"
          />
        </label>
        <Select label="Entity type" value={f.type} onChange={(v) => set({ type: v })}
          options={[["all", "All"], ["wallet", "Wallet"], ["transaction", "Transaction"], ["ip", "IP"]]} />
        <Select label="Risk score" value={f.risk} onChange={(v) => set({ risk: v })}
          options={[["all", "All"], ["80-100", "80–100"], ["60-79", "60–79"], ["40-59", "40–59"], ["0-39", "0–39"]]} />
        <Select label="Last seen" value={f.time} onChange={(v) => set({ time: v })}
          options={[["all", "All time"], ["1h", "Last hour"], ["6h", "Last 6 hours"], ["24h", "Last 24 hours"]]} />
        <Select label="Sort by" value={f.sort} onChange={(v) => set({ sort: v, asc: v === "name" })}
          options={[["risk", "Risk score"], ["tx", "Transaction count"], ["last_seen", "Last seen"], ["name", "Entity name"]]} />
        <button
          onClick={() => { setF(DEFAULT_FILTERS); setDebounced(""); }}
          disabled={!isFiltered(f) && f.sort === "risk" && !f.asc}
          className="rounded border border-border px-3 py-1.5 font-mono text-xs uppercase text-muted-foreground hover:bg-muted/40 disabled:opacity-40"
        >
          Clear filters
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
        <span data-testid="result-count">
          {isFiltered({ ...f, query: debounced })
            ? `Showing ${rows.length} of ${all.length} scored entities`
            : `${all.length} scored entities · ${suspicious} with risk ≥ 70`}
          {rel.isFetching ? " · searching…" : ""}
          {debounced.length >= 2 && rel.data ? ` · ${rel.data.txCount} matching transactions` : ""}
        </span>
        {f.time !== "all" ? <span>Time range is relative to the latest observation in the dataset ({fmtTime(referenceTs)})</span> : null}
      </div>

      {ipMatches.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <span className="label-xs mr-1">Matching IPs (observations)</span>
          {ipMatches.map((ip) => (
            <button key={ip} onClick={() => onInvestigate(ip, "ip")}
              className="rounded border border-ip/40 bg-ip/10 px-1.5 py-0.5 font-mono text-[11px] text-ip">
              {ip}
            </button>
          ))}
        </div>
      ) : null}

      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading alerts…</p> : null}
      {q.error ? <p className="text-sm text-critical">{(q.error as Error).message}</p> : null}
      {!q.isLoading && !all.length ? (
        <p className="text-sm text-muted-foreground">No scored entities yet. Run the AI analysis first.</p>
      ) : null}
      {!q.isLoading && all.length > 0 && !rows.length && f.type !== "ip" ? (
        <p className="text-sm text-muted-foreground">No entities match these filters.</p>
      ) : null}
      {f.type === "ip" && !ipMatches.length ? (
        <p className="text-sm text-muted-foreground">IPs are network observations, not scored entities. Search an IP to open its observations.</p>
      ) : null}

      {visible.length ? (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="label-xs sticky top-0 bg-surface">
              <tr>
                <th className="py-2">#</th>
                {sortHeader("name", "Entity")}
                <th className="py-2">Type</th>
                {sortHeader("risk", "Risk")}
                <th className="py-2">Primary reason</th>
                {sortHeader("tx", "Tx")}
                <th className="py-2">IPs</th>
                {sortHeader("last_seen", "Last seen")}
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr
                  key={`${r.entity_type}:${r.entity_id}`}
                  onClick={() => onInvestigate(r.entity_id, r.entity_type)}
                  className="cursor-pointer border-t border-border font-mono text-xs hover:bg-muted/40"
                >
                  <td className="py-2 text-muted-foreground">{page * PAGE + i + 1}</td>
                  <td className="max-w-[210px] truncate py-2 text-foreground">{r.entity_id}</td>
                  <td className="py-2"><TypeBadge type={r.entity_type} /></td>
                  <td className="py-2"><RiskBadge score={r.risk_score} /></td>
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
      {pages > 1 ? (
        <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">Prev</button>
          <span>Page {page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">Next</button>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Scores are behavioural anomaly / investigation-priority indicators produced by the Isolation Forest detector.
        They are not evidence of criminal activity or wallet ownership.
      </p>
    </Panel>
  );
}
