// 이름·설명·키워드만 보는 말 매칭 — AI 패널의 능력 검색(`context_discover`)과
// 스킬 화면의 발동 시뮬레이터가 **같은 채점기**를 쓰게 하는 자리다.
//
// 같아야 하는 이유가 핵심이다. 시뮬레이터가 별도 채점기를 쓰면 그것은 예측이
// 아니라 창작이 된다 — "이렇게 말하면 걸립니다" 라고 보여 준 것이 실제로는 안
// 걸릴 수 있다. 한 함수를 공유하면 시뮬레이터가 보여 주는 것은 정의상 진짜다.

/** 한 후보의 점수. `hits` 는 질의 토큰 중 몇 개가 걸렸는가. */
export interface TermRank<T> {
  item: T;
  hits: number;
  /** 실제로 걸린 토큰 — 화면이 "이 말 때문에" 를 보여 줄 수 있게. */
  matched: string[];
}

/**
 * 질의를 공백으로 쪼개 토큰 포함 개수로 순위를 매긴다. 하나도 안 걸린 후보는
 * 빠진다. 본문은 보지 않는다 — 본문까지 색인하면 색인이 곧 컨텍스트만큼 커져,
 * 애초에 목록만 올린 이유가 사라진다.
 */
export function rankByTerms<T>(
  items: T[],
  termsOf: (item: T) => string[],
  query: string,
  limit = 8,
): TermRank<T>[] {
  const needles = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!needles.length) return [];
  return items
    .map((item) => {
      const hay = termsOf(item).filter(Boolean).join(" ").toLowerCase();
      const matched = needles.filter((n) => hay.includes(n));
      return { item, hits: matched.length, matched };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
}
