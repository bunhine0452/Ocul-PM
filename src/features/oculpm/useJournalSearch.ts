import { useCallback, useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { toAppError } from "@/api/invoke";
import { tError } from "@/i18n/errors";
import type { JournalEntrySummary, JournalSearchHit } from "@/lib/bindings";
import { groupByWorkday, type JournalDay } from "./useJournalDays";
import { useJournalEvents } from "./useOculpmLive";

/** 검색 한 번에 받는 히트 상한 — 백엔드 `MAX_SEARCH_LIMIT` 과 같다. */
export const SEARCH_LIMIT = 200;
/** 한 번에 요약으로 풀 수 있는 날짜 수 — `oculpm_workday_brief` 의 상한(62). */
const MAX_DAYS = 62;

interface JournalSearchState {
  /** 날짜 묶음(최신 먼저) — 「최신」 순서. */
  days: JournalDay[] | null;
  /** 백엔드가 준 관련도 순서 그대로 — 「관련도」 순서(기본). */
  ranked: JournalEntrySummary[] | null;
  /** 줄의 둘째 줄에 서는 발췌 — 왜 걸렸는지 (경로 → 한 줄). */
  excerpts: ReadonlyMap<string, string>;
  loading: boolean;
  error: string | null;
  /** 상한을 걸기 전 매치 건수. */
  total: number | null;
  /** 지금 목록에 실린 건수. */
  loaded: number | null;
  refresh: () => void;
}

const NO_EXCERPTS: ReadonlyMap<string, string> = new Map();

/**
 * 히트 하나가 「왜 걸렸는가」 한 줄. 본문이면 맞은 곳 근방 발췌, 경로 · 태그면 그 자리(`why` 의 머리표를
 * 뗀 것), 제목이면 제목은 이미 줄 위에 있으니 본문 앞머리 발췌 — 앞머리가 제목 줄이면 그 줄은 뗀다.
 * 마크다운 표식(`[x]` · `##` · `**` · 억음부호)은 한 줄 발췌에서 뜻이 아니라 얼룩이다.
 */
export function excerptOf(hit: Pick<JournalSearchHit, "snippet" | "matched_field" | "why" | "title">): string {
  if (hit.matched_field === "path" || hit.matched_field === "tag") {
    const m = /^(?:path|tag):(.+)$/.exec(hit.why.trim());
    if (m) return m[1].trim();
  }
  let s = hit.snippet
    .replace(/\[[ xX]\]\s*/g, "")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .trim();
  const title = hit.title.replace(/\*\*|__|`/g, "").trim();
  if (title && s.startsWith(title)) s = s.slice(title.length).trim();
  return s;
}

/**
 * 일지 검색 — 제목·파일 경로·태그·슬러그·본문 (`oculpm_search_journal`, MCP `journal_search` 와
 * 같은 캐시 조회·랭킹이다). 히트는 경로와 발췌뿐이라 **요약 행으로 한 번 더 푼다**: 증거 등급·
 * 에이전트·시각은 요약에만 있다.
 *
 * 순서는 둘이다(11-15): 기본은 **백엔드가 준 관련도 순서 그대로**(`ranked`), 「최신」 을 고르면 날짜
 * 묶음(`days`). 예전엔 관련도로 받아 놓고 날짜순으로 다시 늘어놓아, 가장 잘 맞은 일지가 목록 중간에
 * 섰다. 발췌(`snippet` · `matched_field`)도 버리지 않는다 — 줄의 둘째 줄이 왜 걸렸는지를 말한다.
 *
 * `query` 가 비면 아무것도 묻지 않는다 (`days: null`) — 그때는 호출자가 평소 목록을 쓴다.
 * `types` 는 모듈 상수가 아니어도 되지만 내용이 같으면 같은 질의로 본다.
 */
export function useJournalSearch(
  projectId: number | null,
  todayKey: string | null,
  enabled: boolean,
  query: string,
  types: readonly string[],
): JournalSearchState {
  const [result, setResult] = useState<{
    days: JournalDay[];
    ranked: JournalEntrySummary[];
    excerpts: ReadonlyMap<string, string>;
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const q = query.trim();
  const active = enabled && projectId != null && !!todayKey && q !== "";
  useJournalEvents(projectId, active, refresh);

  const typesKey = useMemo(() => types.join(","), [types]);

  useEffect(() => {
    if (!active || projectId == null || !todayKey) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const page = await oculpmApi.searchJournal(
          projectId,
          q,
          typesKey ? { types: typesKey.split(",") } : undefined,
          SEARCH_LIMIT,
        );
        // 날짜는 히트 순서(관련도) 그대로 모아 62일까지 — 넘치는 날짜의 히트는 못 푼다.
        const workdays = [...new Set(page.hits.map((h) => h.workday))].slice(0, MAX_DAYS);
        const summaries = workdays.length ? await oculpmApi.workdayEntries(projectId, workdays) : [];
        if (cancelled) return;
        const byPath = new Map<string, JournalEntrySummary>(summaries.map((e) => [e.relative_path, e]));
        const ranked: JournalEntrySummary[] = [];
        const excerpts = new Map<string, string>();
        for (const h of page.hits) {
          const e = byPath.get(h.relative_path);
          if (!e) continue;
          ranked.push(e);
          const text = excerptOf(h);
          if (text) excerpts.set(e.relative_path, text);
        }
        setResult({ days: groupByWorkday(ranked, todayKey), ranked, excerpts, total: page.total });
      } catch (e) {
        if (cancelled) return;
        setError(tError(toAppError(e)));
        setResult(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, projectId, todayKey, q, typesKey, tick]);

  return {
    days: result?.days ?? null,
    ranked: result?.ranked ?? null,
    excerpts: result?.excerpts ?? NO_EXCERPTS,
    loading,
    error,
    total: result?.total ?? null,
    loaded: result?.ranked.length ?? null,
    refresh,
  };
}
