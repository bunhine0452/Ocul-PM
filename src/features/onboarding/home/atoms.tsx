/**
 * 메인 화면 원자 컴포넌트 모음.
 *
 * 파일 하나에 모은 이유: 전부 30줄 이하 표시 전용이고 서로 함께 바뀐다.
 * 각각을 별 파일로 쪼개면 import 줄이 실제 코드보다 길어진다.
 */
import { agentColor, agentLabelWithModel } from "@/features/today/agentColor";
import { Pencil, Trash2 } from "@/components/Icons";
import { SPARK_DAYS } from "./homeModel";

// ── 프로젝트 마크 ───────────────────────────────────────────────────────

export function Mark({ text, large }: { text: string; large?: boolean }) {
  return (
    <span className={"home-mark" + (large ? " home-mark--lg" : "")} aria-hidden="true">
      {text}
    </span>
  );
}

// ── 작업 유형 키커 ──────────────────────────────────────────────────────

const TRIGGER_LABEL: Record<string, string> = {
  feature: "기능",
  bug: "버그",
  refactor: "리팩토링",
  error: "에러",
  chore: "잡일",
};

/**
 * 작업 유형을 **단어**로 표시한다. 예전 화면은 색 점 하나에 `title` 속성만
 * 달아 뒀는데, `title` 은 키보드·터치·스크린리더 어디로도 도달하지 않아
 * 사실상 유일한 의미 전달 경로가 색 하나였다.
 */
export function TriggerKicker({ type, title }: { type: string | null; title: string | null }) {
  if (!type && !title) return null;
  const key = type && TRIGGER_LABEL[type] ? type : "chore";
  return (
    <span className="flex items-center gap-2 min-w-0">
      {type && (
        <span className="home-kicker" data-trigger={key}>
          <span className="home-kicker-bar" />
          {TRIGGER_LABEL[key]}
        </span>
      )}
      {title && (
        <span className="text-[12.5px] text-[var(--text)] truncate min-w-0">{title}</span>
      )}
    </span>
  );
}

// ── 에이전트 배지 ───────────────────────────────────────────────────────

/** 색은 보조 신호일 뿐 — 라벨 텍스트가 항상 함께 간다. */
export function AgentBadge({ agentId, version }: { agentId: string | null; version: string | null }) {
  if (!agentId) return null;
  return (
    <span className="home-agent">
      <span className="home-agent-dot" style={{ background: agentColor(agentId) }} />
      {agentLabelWithModel(agentId, version)}
    </span>
  );
}

// ── 스파크라인 ──────────────────────────────────────────────────────────

/**
 * 최근 `SPARK_DAYS` 일 활동 추이. 라이브러리 0.
 * 값이 전부 0이면 아예 그리지 않는다 — 빈 막대 줄은 "데이터 없음"과
 * "그 기간에 일 안 함"을 구분하지 못해 노이즈만 된다.
 */
export function Sparkline({ data, label }: { data: number[]; label?: string }) {
  const max = Math.max(...data, 0);
  if (max === 0) return null;
  return (
    <span
      className="home-spark"
      role="img"
      aria-label={label ?? `최근 ${SPARK_DAYS}일 활동 추이`}
    >
      {data.map((n, i) => (
        <span
          key={i}
          className="home-spark-bar"
          data-zero={n === 0 ? "1" : undefined}
          style={{
            height: n === 0 ? "2px" : `${Math.max(12, (n / max) * 100)}%`,
            animationDelay: `${Math.min(i, 14) * 12}ms`,
          }}
        />
      ))}
    </span>
  );
}

// ── 진행률 ──────────────────────────────────────────────────────────────

export function Progress({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="home-prog flex-1 min-w-[48px]" role="img" aria-label={`${total}개 중 ${done}개 완료`}>
        <span className="home-prog-fill block" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[11px] text-[var(--text-3)] tabular-nums whitespace-nowrap">
        {done}/{total}
      </span>
    </span>
  );
}

// ── 검색 하이라이트 ─────────────────────────────────────────────────────

/**
 * 질의와 겹치는 구간을 표시. 정확한 부분문자열만 칠한다 — 퍼지/초성 매칭까지
 * 칠하려 들면 하이라이트가 흩뿌려져 오히려 읽기 어렵다.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="home-hit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

// ── 행/타일 액션 ────────────────────────────────────────────────────────

/**
 * 이름 변경 / 제거. `home-above` 로 스트레치 오픈 레이어(::after) 위에 뜬다.
 * 노출 조건은 CSS 가 관리한다 (hover / focus-within / 커서 3조건).
 */
export function RowActions({
  name,
  onRename,
  onDelete,
}: {
  name: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="home-actions home-above">
      <button
        type="button"
        className="home-iconbtn"
        aria-label={`${name} 이름 변경`}
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className="home-iconbtn home-iconbtn--danger"
        aria-label={`${name} 제거`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

// ── 스켈레톤 ────────────────────────────────────────────────────────────

/** 실물과 같은 치수 — 도착했을 때 레이아웃이 움직이지 않게. */
export function Skel({ w, h = 10 }: { w: number | string; h?: number }) {
  return <span className="home-skel block" style={{ width: w, height: h }} aria-hidden="true" />;
}

// ── 로드 실패 각주 ──────────────────────────────────────────────────────

/**
 * 기록 집계만 실패한 상태. 프로젝트 목록 자체는 멀쩡하므로 붉은 에러 배너를
 * 띄우지 않는다 — 화면을 못 쓰는 게 아니라 곁가지 정보가 빈 것뿐이다.
 */
export function BriefFootnote({ onRetry }: { onRetry: () => void }) {
  return (
    <span className="flex items-center gap-2 text-[10px] font-mono text-[var(--text-3)]">
      기록 미확인
      <button
        type="button"
        onClick={onRetry}
        className="underline underline-offset-2 hover:text-[var(--text-2)] cursor-pointer"
      >
        다시 시도
      </button>
    </span>
  );
}
