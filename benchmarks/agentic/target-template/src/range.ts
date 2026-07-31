export interface Range {
  start: number;
  end: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new Error("clamp: min > max");
  return Math.min(Math.max(value, min), max);
}

/** "3-7" 형태의 문자열을 Range 로 파싱한다. */
export function parseRange(input: string): Range {
  throw new Error("parseRange: not implemented");
}
