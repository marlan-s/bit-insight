import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useRef } from "react";

export interface GraphNodeData {
  id: string;
  type: string;
  label: string;
  risk: number;
  meta: Record<string, unknown>;
}
export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  type: string;
}

const css = (name: string) =>
  typeof window === "undefined"
    ? "#888"
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

export default function GraphCanvas({
  nodes,
  edges,
  center,
  onSelect,
  onExpand,
}: {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  center: string;
  onSelect: (node: GraphNodeData) => void;
  onExpand: (node: GraphNodeData) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const handlers = useRef({ onSelect, onExpand });
  handlers.current = { onSelect, onExpand };

  useEffect(() => {
    if (!containerRef.current) return;
    const elements: ElementDefinition[] = [
      ...nodes.map((n) => ({ data: { ...n, isCenter: n.id === center ? 1 : 0 } })),
      ...edges.map((e) => ({ data: e })),
    ];
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      wheelSensitivity: 0.3,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-size": 8,
            "font-family": "JetBrains Mono, monospace",
            color: css("--foreground"),
            "text-valign": "bottom",
            "text-margin-y": 4,
            "text-max-width": "90px",
            "text-wrap": "ellipsis",
            width: 18,
            height: 18,
            "border-width": 2,
            "border-color": css("--border"),
          },
        },
        { selector: 'node[type="wallet"]', style: { "background-color": css("--wallet"), shape: "ellipse" } },
        { selector: 'node[type="transaction"]', style: { "background-color": css("--transaction"), shape: "round-rectangle" } },
        { selector: 'node[type="ip"]', style: { "background-color": css("--ip"), shape: "diamond", width: 20, height: 20 } },
        {
          selector: "node[risk >= 70]",
          style: { "border-color": css("--critical"), "border-width": 4 },
        },
        {
          selector: "node[isCenter = 1]",
          style: { width: 30, height: 30, "border-color": css("--primary"), "border-width": 4, "font-size": 10 },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": css("--border"),
            "target-arrow-color": css("--border"),
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.6,
            "curve-style": "bezier",
            label: "data(type)",
            "font-size": 6,
            "font-family": "JetBrains Mono, monospace",
            color: css("--muted-foreground"),
            "text-opacity": 0.75,
          },
        },
        { selector: 'edge[type="OBSERVED"]', style: { "line-color": css("--ip"), "target-arrow-color": css("--ip") } },
        { selector: ":selected", style: { "border-color": css("--primary"), "border-width": 4 } },
      ],
      layout: { name: "cose", animate: false, nodeRepulsion: () => 12000, idealEdgeLength: () => 70, padding: 24 },
    });
    cy.on("tap", "node", (evt) => handlers.current.onSelect(evt.target.data() as GraphNodeData));
    cy.on("dbltap", "node", (evt) => handlers.current.onExpand(evt.target.data() as GraphNodeData));
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges, center]);

  return <div ref={containerRef} className="h-[460px] w-full rounded bg-background/60" />;
}
