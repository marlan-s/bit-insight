import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import AlertsPanel from "@/components/intel/AlertsPanel";
import DatasetPanel from "@/components/intel/DatasetPanel";
import InvestigationPanel from "@/components/intel/InvestigationPanel";
import OverviewPanel from "@/components/intel/OverviewPanel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BTC-INTEL · Bitcoin Transaction Intelligence Console" },
      {
        name: "description",
        content:
          "Offline, explainable Bitcoin transaction intelligence: correlate IP, transaction and wallet observations, detect anomalies with machine learning, and prioritise investigation leads.",
      },
      { property: "og:title", content: "BTC-INTEL · Bitcoin Transaction Intelligence Console" },
      {
        property: "og:description",
        content:
          "Correlate → Detect → Prioritize → Explain. An offline investigative console for Bitcoin network and transaction metadata.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Console,
});

const TABS = ["Dataset", "Overview", "Risk Alerts", "Investigation"] as const;
type Tab = (typeof TABS)[number];

function Console() {
  const [tab, setTab] = useState<Tab>("Dataset");
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [entity, setEntity] = useState<{ id: string; type: string } | null>(null);

  const investigate = (id: string, type: string) => {
    setEntity({ id, type });
    setTab("Investigation");
  };

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-4 py-5">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="font-mono text-xl tracking-tight text-foreground">
            BTC<span className="text-primary">-INTEL</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Offline Bitcoin transaction intelligence · correlate → detect → prioritize → explain
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span className="rounded border border-low/40 bg-low/10 px-2 py-0.5 text-low">OFFLINE / LOCAL ONLY</span>
          <span className="rounded border border-border px-2 py-0.5">Isolation Forest detector</span>
        </div>
      </header>

      <nav className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={t !== "Dataset" && !datasetId}
            className={`rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors disabled:opacity-40 ${
              tab === t
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Dataset" ? (
        <DatasetPanel
          datasetId={datasetId}
          onDataset={setDatasetId}
          onAnalysed={() => setTab("Risk Alerts")}
        />
      ) : null}
      {tab === "Overview" && datasetId ? <OverviewPanel datasetId={datasetId} /> : null}
      {tab === "Risk Alerts" && datasetId ? (
        <AlertsPanel datasetId={datasetId} onInvestigate={investigate} />
      ) : null}
      {tab === "Investigation" && datasetId ? (
        <InvestigationPanel
          datasetId={datasetId}
          entityId={entity?.id ?? null}
          entityType={entity?.type ?? "wallet"}
          onInvestigate={investigate}
        />
      ) : null}

      <footer className="mt-8 border-t border-border pt-3 text-[11px] text-muted-foreground">
        Analytical tool only. Risk scores are behavioural anomaly indicators for analyst triage — they do not establish
        wallet ownership, personal identity, or criminal guilt. IP-to-wallet links are observed correlations.
      </footer>
    </main>
  );
}
