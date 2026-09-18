import type { NormalizedTx } from "./types";

/**
 * Synthetic Bitcoin-style traffic generator. Suspicious scenarios use
 * overlapping distributions with normal behaviour so the detector has a real task.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCRIPT_TYPES = ["P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"];

export interface GeneratorOptions {
  seed?: number;
  normalWallets?: number;
  normalTransactions?: number;
  startTime?: number;
}

export function generateDataset(opts: GeneratorOptions = {}): NormalizedTx[] {
  const rand = mulberry32(opts.seed ?? 7);
  const normalWallets = opts.normalWallets ?? 140;
  const normalTx = opts.normalTransactions ?? 1400;
  const start = opts.startTime ?? Date.UTC(2026, 2, 14, 8, 0, 0);

  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)] as T;
  const gauss = (mu: number, sigma: number) => {
    const u = Math.max(rand(), 1e-9);
    const v = Math.max(rand(), 1e-9);
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const logAmount = () => Math.max(0.0005, Math.exp(gauss(-1.9, 1.05)));
  const ip = (n: number) => `${10 + (n % 80)}.${(n * 7) % 255}.${(n * 13) % 255}.${(n * 29) % 254}`;

  const wallets = Array.from({ length: normalWallets }, (_, i) => `bc1q${(i + 1).toString(36).padStart(5, "0")}norm`);
  const ips = Array.from({ length: 70 }, (_, i) => ip(i + 3));
  const txs: NormalizedTx[] = [];
  let counter = 0;

  const makeTx = (
    from: string,
    to: string,
    ts: number,
    amount: number,
    scenario: string,
    srcIp?: string,
    dstIp?: string,
  ): NormalizedTx => {
    counter++;
    return {
      txid: `tx_${counter.toString().padStart(6, "0")}`,
      timestamp: Math.round(ts),
      source_ip: srcIp ?? pick(ips),
      source_port: 30000 + Math.floor(rand() * 25000),
      destination_ip: dstIp ?? pick(ips),
      destination_port: 8333,
      input_wallet: from,
      output_wallet: to,
      input_amount: Number((amount * (1 + rand() * 0.02)).toFixed(8)),
      output_amount: Number(amount.toFixed(8)),
      fee: Number(Math.max(0.00002, gauss(0.00025, 0.0001)).toFixed(8)),
      script_type: pick(SCRIPT_TYPES),
      scenario,
    };
  };

  // ---------- normal background traffic ----------
  for (let i = 0; i < normalTx; i++) {
    const from = pick(wallets);
    let to = pick(wallets);
    if (to === from) to = pick(wallets);
    const ts = start + rand() * 12 * 3600 * 1000;
    txs.push(makeTx(from, to, ts, logAmount(), "normal"));
  }

  // ---------- A. burst wallet ----------
  for (let w = 0; w < 2; w++) {
    const burstWallet = `bc1qburst${w}xxxxx`;
    const t0 = start + (2 + w) * 3600 * 1000;
    for (let i = 0; i < 46; i++) {
      txs.push(makeTx(burstWallet, pick(wallets), t0 + i * (20000 + rand() * 25000), logAmount() * 1.2, "burst"));
    }
  }

  // ---------- B. fan-in wallet ----------
  const fanIn = "bc1qfanin0xxxxxx";
  for (let i = 0; i < 58; i++) {
    txs.push(makeTx(pick(wallets), fanIn, start + 3.5 * 3600000 + rand() * 5400000, logAmount() * 0.8, "fan_in"));
  }

  // ---------- C. fan-out wallet ----------
  const fanOut = "bc1qfanout0xxxxx";
  for (let i = 0; i < 54; i++) {
    txs.push(makeTx(fanOut, `bc1qsink${i.toString().padStart(3, "0")}x`, start + 5 * 3600000 + rand() * 5400000, logAmount() * 0.7, "fan_out"));
  }

  // ---------- D. rapid transfer chain (peel chain) ----------
  let chainAmount = 4.2;
  let chainTime = start + 6 * 3600000;
  let prev = "bc1qchain00xxxxxx";
  for (let i = 1; i <= 14; i++) {
    const next = `bc1qchain${i.toString().padStart(2, "0")}xxxxxx`;
    chainTime += 45000 + rand() * 60000;
    chainAmount *= 0.86;
    txs.push(makeTx(prev, next, chainTime, chainAmount, "rapid_chain"));
    prev = next;
  }

  // ---------- E. high IP diversity ----------
  const diverse = "bc1qipdiv0xxxxxx";
  for (let i = 0; i < 34; i++) {
    txs.push(
      makeTx(diverse, pick(wallets), start + 7 * 3600000 + rand() * 7200000, logAmount(), "ip_diversity", ip(200 + i * 3), ip(120 + i)),
    );
  }

  // ---------- F. repeated IP-wallet correlation ----------
  const repeated = "bc1qiprep0xxxxxx";
  const stickyIp = "203.0.113.77";
  for (let i = 0; i < 30; i++) {
    txs.push(makeTx(repeated, pick(wallets), start + 8 * 3600000 + rand() * 5400000, logAmount(), "repeated_ip", stickyIp, stickyIp));
  }

  // ---------- G. high-value outlier ----------
  const whale = "bc1qwhale0xxxxxx";
  for (let i = 0; i < 9; i++) {
    txs.push(makeTx(whale, pick(wallets), start + 9 * 3600000 + rand() * 3600000, 9 + rand() * 24, "high_value"));
  }

  // ---------- H. suspicious neighbourhood ----------
  const hubs = ["bc1qhub0xxxxxxxx", "bc1qhub1xxxxxxxx", "bc1qhub2xxxxxxxx"];
  for (let i = 0; i < 40; i++) {
    const a = pick(hubs);
    let b = pick(hubs);
    if (a === b) b = fanIn;
    txs.push(makeTx(a, b, start + 10 * 3600000 + rand() * 3600000, logAmount() * 1.4, "suspicious_cluster"));
  }
  for (const hub of hubs) {
    for (let i = 0; i < 8; i++) {
      txs.push(makeTx(hub, pick(wallets), start + 10.5 * 3600000 + rand() * 3600000, logAmount(), "suspicious_cluster"));
    }
  }

  return txs.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

export function toCsv(txs: NormalizedTx[]): string {
  const cols: (keyof NormalizedTx)[] = [
    "timestamp",
    "source_ip",
    "source_port",
    "destination_ip",
    "destination_port",
    "txid",
    "input_wallet",
    "output_wallet",
    "input_amount",
    "output_amount",
    "fee",
    "script_type",
    "scenario",
  ];
  const head = cols.join(",");
  const rows = txs.map((t) =>
    cols
      .map((c) => {
        const v = t[c];
        if (c === "timestamp" && typeof v === "number") return new Date(v).toISOString();
        return v ?? "";
      })
      .join(","),
  );
  return [head, ...rows].join("\n");
}
