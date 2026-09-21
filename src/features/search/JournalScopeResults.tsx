import type { EntryType, JournalSearchHit } from "@/lib/bindings";
import { TriggerBadge } from "@/features/oculpm/triggerMeta";
import { splitMatch } from "./searchUtils";
import { useT, type Lang } from "@/i18n";

// 검색 화면 「일지」 스코프 결과 리스트 (journal-scale-round {#search-scope-ui}).
// 별도 파일인 이유는 기능이 아니라 예산 — SearchScreenV2.tsx 가 파일 크기
// 래칫(800줄) 앞에서 여유가 47줄뿐이었다.
//
// 행은 검색 화면의 기존 관용구를 그대로 탄다: 카드는 `.card.sresult`, 클릭
// 가능한 헤더는 심볼 결과가 쓰는 `.sresult-symrow`(펼침 대신 이동을 묶는다),
// 스니펫은 `.scode`. 매치 하이라이트는 `searchUtils.splitMatch` — 코드 검색의
// 심볼 이름 하이라이트와 같은 순수 함수다.
//
// `JournalSearchHit` 에는 에이전트 필드가 없다 (백엔드 `journal_search.rs` 의
// 히트 구조체를 그대로 소비 — 커맨드 시그니처는 건드리지 않는다). 그 자리는
// 비워 둔다.

interface JournalScopeResultsProps {
  hits: JournalSearchHit[];
  /** 상한을 걸기 전 전체 매치 건수 — 헤더의 「N건 중 M건」. */
  total: number;
  query: string;
  canMore: boolean;
  onMore: () => void;
  /** 일지 화면으로 이동 + 해당 항목 포커스 (ShellV2 의 openEntryPath 핸드오프). */
  onOpen: (relativePath: string) => void;
}

const ENTRY_TYPES = new Set<string>(["bug", "feature", "error", "refactor", "chore"]);

export function JournalScopeResults({ hits, total, query, canMore, onMore, onOpen }: JournalScopeResultsProps) {
  const { t, lang } = useT();
  return (
    <div className="search-results">
      <div className="section-title search-results-bar">
        <span>{t("search.journalCount", { n: hits.length, total })}</span>
      </div>
      {hits.map((hit) => (
        <div className="card sresult" key={hit.relative_path}>
          <div className="sresult-head" style={{ padding: 0 }}>
            <button
              type="button"
              className="sresult-symrow"
              onClick={() => onOpen(hit.relative_path)}
            >
              {ENTRY_TYPES.has(hit.entry_type) ? (
                <TriggerBadge type={hit.entry_type as EntryType} withLabel={false} />
              ) : null}
              <span className="sresult-path">
                {splitMatch(hit.title, query).map((seg, i) =>
                  seg.hit ? (
                    <mark className="s-hit" key={i}>
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  ),
                )}
              </span>
              <span className="sresult-lines">{formatWorkday(hit.workday, lang)}</span>
            </button>
          </div>
          <div className="scode" style={{ whiteSpace: "pre-wrap" }}>
            {splitMatch(hit.snippet, query).map((seg, i) =>
              seg.hit ? (
                <mark className="s-hit" key={i}>
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </div>
        </div>
      ))}
      {canMore ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
          <button type="button" className="btn ghost" onClick={onMore}>
            {t("search.more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** "YYYYMMDD" → UI 언어를 따르는 짧은 날짜 표기 (HotspotCard 와 같은 포맷). */
function formatWorkday(workday: string, lang: Lang): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  const date = new Date(y, m, d);
  if (Number.isNaN(date.getTime())) return workday;
  return date.toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", {
    month: "long",
    day: "numeric",
  });
}
