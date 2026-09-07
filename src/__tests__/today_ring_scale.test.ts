import { describe, expect, it } from "vitest";

// Today 링의 눈금 (v3-release {#today-overcount}).
//
// 컴포넌트 테스트(`today_ring.test.tsx`)는 **그려진 것**을 본다. 여기서는
// 그리기 전의 산수를 본다 — 이 자리가 두 번 틀렸기 때문이다: 평평한 클램프가
// 안쪽 링을 닫았고(c844555), `k=400` 은 실제 분포에서 매일 상한에 붙었다.

import {
  MIN_GAP_DEG,
  R_INNER,
  R_MID,
  R_OUTER,
  RING_K,
  capUnits,
  maxFraction,
  ringArc,
} from "@/features/today/ringScale";

describe("ringScale — 그릴 수 있는 상한", () => {
  it("반지름이 작을수록 캡이 비싸고 상한이 낮다", () => {
    expect(capUnits(R_INNER)).toBeGreaterThan(capUnits(R_MID));
    expect(capUnits(R_MID)).toBeGreaterThan(capUnits(R_OUTER));
    expect(maxFraction(R_INNER)).toBeLessThan(maxFraction(R_MID));
    expect(maxFraction(R_MID)).toBeLessThan(maxFraction(R_OUTER));
  });

  it("어떤 값을 줘도 캡을 포함한 칠한 길이가 트랙을 다 먹지 않는다", () => {
    for (const r of [R_OUTER, R_MID, R_INNER]) {
      const { fraction } = ringArc(Number.MAX_SAFE_INTEGER, 1, r);
      const painted = fraction * 100 + 2 * capUnits(r);
      expect(painted).toBeLessThanOrEqual(100 - (MIN_GAP_DEG / 360) * 100 + 1e-9);
    }
  });

  it("0 은 호가 아니라 없음이다 (둥근 캡 아래 0 길이 대시는 점으로 그려진다)", () => {
    expect(ringArc(0, RING_K.files, R_MID)).toEqual({ fraction: 0, capped: false });
    expect(ringArc(-3, RING_K.files, R_MID)).toEqual({ fraction: 0, capped: false });
  });
});

describe("ringScale — 의미의 눈금", () => {
  it("k 에서 정확히 절반이 찬다", () => {
    expect(ringArc(RING_K.lines, RING_K.lines, R_INNER).fraction).toBeCloseTo(0.5, 10);
  });

  it("라인 눈금이 실측 분포를 가른다 — 옛 k=400 은 그 구간을 전부 상한으로 뭉갰다", () => {
    // 2026-09-07 실측(이 저장소 `.oculpm/index/diffs/**`, 8월 이후 26 워크데이):
    // 중앙값 15,400줄 · 범위 65~41,790줄. 아래 넷은 그 범위를 훑는 실제 날이고,
    // 넷 다 옛 눈금의 상한(~4,100줄) 위에 있다 — 26일 중 22일이 그랬다.
    const days = [6_154, 15_400, 26_563, 41_790];
    const now = days.map((v) => ringArc(v, RING_K.lines, R_INNER).fraction);
    const old = days.map((v) => ringArc(v, 400, R_INNER).fraction);

    // 옛 값에서는 네 날이 전부 같은 상한에 눌려 서로 구별되지 않았다.
    expect(new Set(old.map((f) => f.toFixed(6))).size).toBe(1);
    expect(old.every((f) => f === maxFraction(R_INNER))).toBe(true);

    // 새 값에서는 자란다. 상한은 사라지지 않았고 **훨씬 위로** 갔다 —
    // 26일 중 22일이 눌리던 것이 가장 바쁜 하루(41,790줄, ~40,800 문턱)만
    // 남는다. 그 하루는 `capped` 가 말한다.
    for (let i = 1; i < now.length - 1; i++) expect(now[i]).toBeGreaterThan(now[i - 1]);
    expect(now.slice(0, -1).every((f) => f < maxFraction(R_INNER))).toBe(true);
    expect(ringArc(days[days.length - 1], RING_K.lines, R_INNER).capped).toBe(true);
    expect(ringArc(40_000, RING_K.lines, R_INNER).capped).toBe(false);
    // 중앙값이 링 한가운데쯤에 오는지 — 눈금의 뜻이 여기 있다.
    expect(now[1]).toBeGreaterThan(0.6);
    expect(now[1]).toBeLessThan(0.9);
  });

  it("파일 눈금이 실측 분포를 가른다 — 옛 k=8 은 상한이 108개였다", () => {
    // 2026-09-07 실측(이 저장소 캐시의 워크데이별 `COUNT(DISTINCT file_path)`,
    // 44 워크데이): 중앙값 55개 · p75 100 · p90 170 · 범위 2~209.
    // 아래 다섯은 그 분포를 훑는 실제 날이다.
    const days = [55, 84, 126, 156, 209];
    const now = days.map((v) => ringArc(v, RING_K.files, R_MID).fraction);
    const old = days.map((v) => ringArc(v, 8, R_MID).fraction);

    // 옛 눈금은 108개(=k×13.54)부터 상한이라 뒤 세 날이 한 덩어리로 뭉갰다 —
    // 44일 중 9일(8월 이후로는 26일 중 8일)이 그랬다.
    expect(new Set(old.slice(2).map((f) => f.toFixed(6))).size).toBe(1);
    expect(old.slice(2).every((f) => f === maxFraction(R_MID))).toBe(true);

    // 새 눈금(k=20)의 상한은 271개 — 실측 44일 중 눌리는 날이 하나도 없다.
    for (let i = 1; i < now.length; i++) expect(now[i]).toBeGreaterThan(now[i - 1]);
    expect(now.every((f) => f < maxFraction(R_MID))).toBe(true);
    expect(days.every((v) => !ringArc(v, RING_K.files, R_MID).capped)).toBe(true);

    // 중앙값이 링 한가운데쯤. `lines` 와 같은 읽기를 노렸다.
    expect(now[0]).toBeGreaterThan(0.6);
    expect(now[0]).toBeLessThan(0.85);

    // 상한을 없앤 게 아니라 이 저장소 위로 올렸다 — 더 바쁜 하루에는 걸린다.
    expect(ringArc(271, RING_K.files, R_MID).capped).toBe(true);
    expect(ringArc(270, RING_K.files, R_MID).capped).toBe(false);
  });

  it("일지 눈금은 실측 최댓날(46건)도 안 누른다 — 그래서 안 건드렸다", () => {
    expect(ringArc(46, RING_K.journals, R_OUTER).capped).toBe(false);
    expect(ringArc(65, RING_K.journals, R_OUTER).capped).toBe(true);
  });

  it("상한에 눌린 것을 값으로 내보낸다 (화면이 말할 수 있게)", () => {
    expect(ringArc(4_100, 400, R_INNER).capped).toBe(true);
    expect(ringArc(4_100, RING_K.lines, R_INNER).capped).toBe(false);
    // 눌린 호는 값이 더 커져도 자라지 않는다 — capped 가 참인 이유 그 자체.
    const a = ringArc(50_000, 400, R_INNER);
    const b = ringArc(500_000, 400, R_INNER);
    expect(a.fraction).toBe(b.fraction);
    expect(a.capped && b.capped).toBe(true);
  });
});
