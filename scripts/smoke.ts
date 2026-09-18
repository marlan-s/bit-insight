import { generateDataset, toCsv } from "../src/lib/pipeline/generator";
import { ingest } from "../src/lib/pipeline/normalize";
import { runPipeline } from "../src/lib/pipeline/index";

const txs = generateDataset();
const csv = toCsv(txs);
const ingested = ingest("demo.csv", csv);
console.log("ingested", ingested.validCount, "invalid", ingested.invalidCount, "format", ingested.format);

const t0 = Date.now();
const result = runPipeline(ingested.records);
console.log("pipeline ms", Date.now() - t0);
console.log("summary", result.summary);
console.log("metrics", JSON.stringify(result.metrics, null, 1).slice(0, 1200));
console.log("\nTop 12 entities:");
for (const e of result.entities.slice(0, 12)) {
  console.log(
    `${e.risk_score}\t${e.entity_type}\t${e.entity_id}\t${e.primary_reason}\tscenario=${e.scenario ?? "-"}`,
  );
}
console.log("\nexplanation sample:", result.entities[0]?.explanation.map((x) => x.text));
