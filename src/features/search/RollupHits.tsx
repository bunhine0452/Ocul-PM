import { useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useT } from "@/i18n";
import type { RollupSummary } from "@/lib/bindings";

/**
 * 검색 결과의 맨 위 — 요약이 있으면 요약부터 (UI 밀도 라운드 2).
 *
 * 에이전트는 `journal_search` 응답의 `rollups` 를 먼저 읽는다. 사람의 검색 화면도 같은
 * 순서여야 한다: 한 주를 한 장으로 접은 요약이 질의어를 담고 있으면 일지 행들보다
 * 먼저 선다. 매칭은 소박하다 — 질의어 토큰(2자 이상)이 요약 문단이나 주 이름에 있으면.
 */
export function RollupHits({ projectId, query }: { projectId: number; query: string }) {
  const { t } = useT();
  const [rollups, setRollups] = useState<RollupSummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    oculpmApi
      .rollupList(projectId)
      .then((list) => {
        if (!cancelled) setRollups(list);
      })
      .catch(() => {
        if (!cancelled) setRollups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const hits = useMemo(() => {
    if (!rollups) return [];
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((tk) => tk.length >= 2);
    if (tokens.length === 0) return [];
    return rollups
      .filter((r) => {
        const hay = `${r.week} ${r.summary}`.toLowerCase();
        return tokens.some((tk) => hay.includes(tk));
      })
      .slice(0, 2);
  }, [rollups, query]);

  if (hits.length === 0) return null;
  return (
    <div className="search-results rollup-hits">
      <div className="section-title search-results-bar">
        <span>{t("search.rollupFirst")}</span>
      </div>
      {hits.map((r) => (
        <div className="card sresult rollup-hit" key={r.week}>
          <div className="rh-head">
            <span className="rh-pill">{t("search.rollupHit")}</span>
            <b>{r.week}</b>
            <span className="rh-sub">{t("search.rollupHitSub", { n: r.entry_count })}</span>
            {r.stale ? <span className="chip sm warn">{t("today.rollup.stale")}</span> : null}
          </div>
          <p className="rh-body">{r.summary}</p>
          <span className="rh-path mono">{r.path}</span>
        </div>
      ))}
    </div>
  );
}
