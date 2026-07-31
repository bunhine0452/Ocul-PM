export function mean(values: number[]): number {
  if (values.length === 0) throw new Error("mean: empty array");
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median: empty array");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function histogram(values: number[], bucketSize: number): Map<number, number> {
  if (bucketSize <= 0) throw new Error("histogram: bucketSize must be positive");
  const buckets = new Map<number, number>();
  for (const v of values) {
    const bucket = Math.floor(v / bucketSize) * bucketSize;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return buckets;
}

export function formatPercent(value, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}
