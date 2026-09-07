// `#prompt-simulator` — 시뮬레이터와 AI 패널 능력 검색이 **같은 채점기**를 쓴다는
// 계약. 갈리는 순간 시뮬레이터는 예측이 아니라 창작이 된다.
import { describe, expect, it } from "vitest";

import { rankByTerms } from "@/lib/termMatch";
import { discover } from "@/features/chat/contextLoad";
import type { Manifest } from "@/features/chat/manifest";

const entry = (id: string, terms: string[]) => ({
  kind: "skill" as const,
  id,
  label: id,
  terms,
  note: "",
});

const manifest: Manifest = {
  text: "",
  entries: [
    entry("diagnosing-bugs", ["diagnosing-bugs", "어려운 버그 진단", "디버깅", "재현"]),
    entry("grilling", ["grilling", "설계 결정을 라운드로 캐묻는다", "사양"]),
    entry("run-evals", ["run-evals", "EVALS.md 채점", "평가"]),
  ],
};

describe("rankByTerms — 이름·설명·키워드만 보는 채점기", () => {
  it("걸린 토큰 수로 순위를 매기고, 무엇이 걸렸는지 돌려준다", () => {
    const ranked = rankByTerms(manifest.entries, (e) => e.terms, "디버깅 재현");
    expect(ranked.map((r) => r.item.id)).toEqual(["diagnosing-bugs"]);
    expect(ranked[0].hits).toBe(2);
    expect(ranked[0].matched).toEqual(["디버깅", "재현"]);
  });

  it("하나도 안 걸리면 빈 목록 — 0건이 곧 발견이다", () => {
    expect(rankByTerms(manifest.entries, (e) => e.terms, "쿠버네티스")).toEqual([]);
    // 빈 질의로 전체를 흘리지 않는다.
    expect(rankByTerms(manifest.entries, (e) => e.terms, "   ")).toEqual([]);
  });

  it("본문은 안 본다 — terms 에 없는 말은 도달 경로가 아니다", () => {
    const withBody = [entry("x", ["x"])];
    expect(rankByTerms(withBody, (e) => e.terms, "본문에만 있는 말")).toEqual([]);
  });

  it("discover 는 이 채점기 위에 서 있다 — 두 화면이 같은 답을 낸다", () => {
    const viaDiscover = discover(manifest, "설계 사양").map((e) => e.id);
    const viaRank = rankByTerms(manifest.entries, (e) => e.terms, "설계 사양").map(
      (r) => r.item.id,
    );
    expect(viaDiscover).toEqual(viaRank);
    expect(viaDiscover).toEqual(["grilling"]);
  });

  it("limit 를 넘겨 자른다", () => {
    const many = Array.from({ length: 20 }, (_, i) => entry(`s${i}`, ["공통"]));
    expect(rankByTerms(many, (e) => e.terms, "공통", 3)).toHaveLength(3);
  });
});
