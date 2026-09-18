/**
 * Isolation Forest — unsupervised anomaly detection, implemented from scratch
 * so the whole pipeline runs offline with no external service.
 */

interface ITreeNode {
  splitFeature?: number;
  splitValue?: number;
  left?: ITreeNode;
  right?: ITreeNode;
  size: number;
  depth: number;
  isLeaf: boolean;
}

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

const c = (n: number) => (n <= 1 ? 0 : 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n);

function buildTree(rows: number[][], depth: number, maxDepth: number, rand: () => number): ITreeNode {
  if (depth >= maxDepth || rows.length <= 1) {
    return { size: rows.length, depth, isLeaf: true };
  }
  const dims = rows[0]?.length ?? 0;
  const candidates: number[] = [];
  for (let f = 0; f < dims; f++) {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const v = r[f] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max > min) candidates.push(f);
  }
  if (!candidates.length) return { size: rows.length, depth, isLeaf: true };
  const splitFeature = candidates[Math.floor(rand() * candidates.length)] ?? 0;
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const v = r[splitFeature] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const splitValue = min + rand() * (max - min);
  const left: number[][] = [];
  const right: number[][] = [];
  for (const r of rows) ((r[splitFeature] ?? 0) < splitValue ? left : right).push(r);
  return {
    splitFeature,
    splitValue,
    size: rows.length,
    depth,
    isLeaf: false,
    left: buildTree(left, depth + 1, maxDepth, rand),
    right: buildTree(right, depth + 1, maxDepth, rand),
  };
}

function pathLength(row: number[], node: ITreeNode): number {
  let cur = node;
  let depth = 0;
  while (!cur.isLeaf) {
    const v = row[cur.splitFeature ?? 0] ?? 0;
    const next = v < (cur.splitValue ?? 0) ? cur.left : cur.right;
    if (!next) break;
    cur = next;
    depth++;
  }
  return depth + c(cur.size);
}

export interface IsolationForestModel {
  trees: ITreeNode[];
  sampleSize: number;
  /** Anomaly score in [0,1]; higher = more anomalous. */
  score(row: number[]): number;
}

export function trainIsolationForest(
  data: number[][],
  opts: { trees?: number; sampleSize?: number; seed?: number } = {},
): IsolationForestModel {
  const nTrees = opts.trees ?? 120;
  const sampleSize = Math.max(4, Math.min(opts.sampleSize ?? 256, data.length));
  const rand = mulberry32(opts.seed ?? 42);
  const maxDepth = Math.ceil(Math.log2(Math.max(2, sampleSize)));
  const trees: ITreeNode[] = [];
  for (let t = 0; t < nTrees; t++) {
    const sample: number[][] = [];
    for (let i = 0; i < sampleSize; i++) {
      const row = data[Math.floor(rand() * data.length)];
      if (row) sample.push(row);
    }
    trees.push(buildTree(sample, 0, maxDepth, rand));
  }
  const norm = c(sampleSize) || 1;
  return {
    trees,
    sampleSize,
    score(row: number[]) {
      let total = 0;
      for (const tree of trees) total += pathLength(row, tree);
      const avg = total / trees.length;
      return Math.pow(2, -avg / norm);
    },
  };
}

/**
 * Per-feature contribution: how much the anomaly score drops when a feature is
 * replaced by the population median. Deterministic, model-based attribution.
 */
export function featureContributions(
  model: IsolationForestModel,
  row: number[],
  medians: number[],
): number[] {
  const base = model.score(row);
  return row.map((_, i) => {
    const probe = [...row];
    probe[i] = medians[i] ?? 0;
    return Math.max(0, base - model.score(probe));
  });
}
