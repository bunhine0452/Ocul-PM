// `#firing-quotes` — 한 항목이 **실제로 불린 순간**의 인용.
//
// 원장 배지가 "몇 번" 을 말한다면 이건 "어떤 말에" 를 말한다. 상세를 열 때만
// 부른다 — 목록 전체에 얹으면 안 볼 것을 위해 쿼리 N 번을 치른다.
import { useEffect, useState } from "react";

import type { FiringQuote, FiringStat } from "@/lib/bindings";
import { firingApi } from "@/api/claudeSurface";

/** 상세 카드에 앉힐 만큼만. 더 보여 준다고 답이 더 분명해지지 않는다. */
const QUOTE_LIMIT = 3;

/**
 * @param stat 이 항목의 원장 통계. 없으면(발동 0회) 인용도 없으므로 부르지 않는다.
 */
export function useFiringQuotes(
  projectId: number,
  stat: FiringStat | undefined,
  days: number,
): FiringQuote[] {
  const [quotes, setQuotes] = useState<FiringQuote[]>([]);
  const kind = stat?.kind;
  const key = stat?.key;

  useEffect(() => {
    if (!kind || !key) {
      setQuotes([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const rows = await firingApi.quotes(projectId, kind, key, days, QUOTE_LIMIT);
        if (alive) setQuotes(rows);
      } catch {
        // 원장과 같은 규율 — 보조 신호라 조용히 빈손으로 둔다.
        if (alive) setQuotes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, kind, key, days]);

  return quotes;
}
