// 「12분 전」 · 「어제」 — 단위와 수만 정한다. 말은 부르는 쪽이 l10n 으로 붙인다.

export type Ago = { unit: "now" | "min" | "hour" | "day"; n: number };

export function ago(iso: string, now: number): Ago | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return { unit: "now", n: 0 };
  if (min < 60) return { unit: "min", n: min };
  const hour = Math.floor(min / 60);
  if (hour < 24) return { unit: "hour", n: hour };
  return { unit: "day", n: Math.floor(hour / 24) };
}
