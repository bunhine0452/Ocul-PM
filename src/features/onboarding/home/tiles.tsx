/**
 * 벤토 밴드의 타일들 — 사령탑 / 오늘의 흐름 / 판 / 추가 슬롯.
 *
 * 크기가 곧 위계다. 사령탑(7열 × 340px)은 "지금 이어서 할 곳"에 **선언으로**
 * 답한다 — 프로젝트명·마지막 활동·다음 할 일·최근 기록·활동 추이·마지막
 * 에이전트를 고정 위치에 둬서, 100번째 사용에서도 눈이 같은 자리를 본다.
 */
import { ArrowRight, Bot, NotebookText, Plus, Sparkles, FolderOpen } from "@/components/Icons";
import type { Project } from "@/lib/bindings";

import { AgentBadge, Mark, Progress, RowActions, Skel, Sparkline, TriggerKicker } from "./atoms";
import {
  FEED_MAX,
  hhmm,
  initials,
  relativeTime,
  tildePath,
  type ProjectRowT,
} from "./homeModel";
import type { HomeBrief } from "@/lib/bindings";

// ── 사령탑 ──────────────────────────────────────────────────────────────

export function ResumeTile({
  row,
  now,
  loading,
  indexing,
  onOpen,
  onRename,
  onDelete,
}: {
  row: ProjectRowT;
  now: number;
  loading: boolean;
  indexing: boolean;
  onOpen: (p: Project) => void;
  onRename: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const { project: p, snap } = row;
  const when = relativeTime(snap?.lastAt ?? null, now);

  return (
    <article className="home-tile home-tile--hero home-t-hero home-in-bento p-[22px] flex flex-col">
      <header className="flex items-start justify-between gap-3">
        <span className="home-eyebrow">이어서 일하기</span>
        <span className="flex items-center gap-2">
          <span className="home-when">마지막 활동 {when}</span>
          <RowActions name={p.name} onRename={() => onRename(p)} onDelete={() => onDelete(p)} />
        </span>
      </header>

      <div className="flex items-center gap-3 mt-4">
        <Mark text={initials(p.name)} large />
        <div className="min-w-0">
          <h2 className="text-[30px] font-bold tracking-[-0.022em] text-[var(--text)] truncate leading-tight">
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="home-open text-left bg-transparent border-0 p-0 cursor-pointer text-inherit font-inherit"
              aria-label={`${p.name} 열기 — 마지막 활동 ${when}`}
            >
              {p.name}
            </button>
          </h2>
          <p className="home-path mt-0.5">{tildePath(p.root_path)}</p>
        </div>
        {indexing && (
          <span className="home-kbd ml-auto self-start" role="status">
            인덱싱 중
          </span>
        )}
      </div>

      {/* identity 는 LLM 캐시라 있는 프로젝트가 많지 않다 — 없으면 줄 자체를
          렌더하지 않는다 (여기서 생성하지 않는다). */}
      {snap?.identity && (
        <p className="mt-3 text-[12.5px] font-medium text-[var(--text-2)] leading-relaxed line-clamp-2">
          {snap.identity}
        </p>
      )}

      {snap?.nextTasks && snap.nextTasks.length > 0 && (
        <section className="mt-5" aria-label="다음 할 일">
          <h3 className="home-eyebrow">다음 할 일</h3>
          <ul className="mt-2 space-y-1.5">
            {snap.nextTasks.map((t) => (
              <li key={`${t.plan_id}:${t.item_id}`} className="flex items-center gap-2 min-w-0">
                <span
                  className="text-[11px] shrink-0"
                  style={{ color: t.status === "in_progress" ? "var(--accent)" : "var(--text-3)" }}
                  aria-hidden="true"
                >
                  {t.status === "in_progress" ? "◐" : t.status === "blocked" ? "⊘" : "○"}
                </span>
                <span className="text-[12.5px] text-[var(--text)] truncate min-w-0">
                  {t.item_title}
                </span>
                <span className="text-[10.5px] font-mono text-[var(--text-3)] ml-auto shrink-0">
                  {t.phase ?? t.plan_title}
                </span>
              </li>
            ))}
          </ul>
          {snap.activePlan && (
            <div className="mt-2.5">
              <Progress done={snap.activePlan.done} total={snap.activePlan.total} />
            </div>
          )}
        </section>
      )}

      {snap?.lastTitle && (
        <section className="mt-5" aria-label="최근 기록">
          <h3 className="home-eyebrow">최근 기록</h3>
          <div className="mt-2">
            <TriggerKicker type={snap.lastType} title={snap.lastTitle} />
          </div>
        </section>
      )}

      {loading && !snap && (
        <div className="mt-5 space-y-2">
          <Skel w="40%" h={11} />
          <Skel w="70%" h={11} />
        </div>
      )}

      <footer className="mt-auto pt-5 flex items-end justify-between gap-3">
        <span className="min-w-0 flex flex-col gap-1.5">
          {snap && <Sparkline data={snap.spark} label={`${p.name} 최근 활동 추이`} />}
          <AgentBadge agentId={snap?.lastAgentId ?? null} version={snap?.lastAgentVersion ?? null} />
        </span>
        <span className="home-kbd shrink-0" aria-hidden="true">
          ⏎ 열기
        </span>
      </footer>
    </article>
  );
}

// ── 오늘의 흐름 (크로스 프로젝트 피드) ──────────────────────────────────

export function FlowTile({
  brief,
  projects,
  loading,
  failed,
  onOpenProject,
}: {
  brief: HomeBrief | null;
  projects: Project[];
  loading: boolean;
  /** 집계 자체가 실패했는가. `기록 0건` 과 반드시 구분해야 한다. */
  failed: boolean;
  onOpenProject: (p: Project) => void;
}) {
  const feed = (brief?.feed ?? []).slice(0, FEED_MAX);
  const byId = new Map(projects.map((p) => [p.id, p]));

  return (
    <article className="home-tile home-t-flow home-in-bento p-4 flex flex-col" aria-label="오늘의 흐름">
      <header className="flex items-center justify-between gap-3">
        <h2 className="home-eyebrow flex items-center gap-1.5">
          <NotebookText className="w-3.5 h-3.5 text-[var(--accent)]" strokeWidth={2} />
          오늘의 흐름
        </h2>
        {brief && (
          <span className="home-when">
            오늘 <span className="text-[var(--text)] font-bold">{brief.today_total}</span>건
          </span>
        )}
      </header>

      {loading && feed.length === 0 && (
        <ul className="mt-3 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-2">
              <Skel w={32} h={9} />
              <Skel w="70%" h={11} />
            </li>
          ))}
        </ul>
      )}

      {/* 집계가 실패했을 때 "아직 기록이 없어요" 라고 말하면 거짓말이다 —
          기록은 있는데 못 읽어온 것일 수 있다. 두 상태를 구분한다. */}
      {!loading && feed.length === 0 && failed && (
        <p className="mt-4 text-[12.5px] text-[var(--text-2)] leading-relaxed">
          기록을 불러오지 못했어요.
          <br />
          <span className="text-[11px] text-[var(--text-3)]">
            프로젝트는 아래에서 그대로 열 수 있습니다.
          </span>
        </p>
      )}
      {!loading && feed.length === 0 && !failed && (
        <p className="mt-4 text-[12.5px] text-[var(--text-2)] leading-relaxed">
          아직 기록이 없어요.
          <br />
          <span className="text-[11px] text-[var(--text-3)]">
            평소처럼 에이전트로 작업하면 여기에 쌓입니다.
          </span>
        </p>
      )}

      <ul className="mt-2 -mx-1.5">
        {feed.map((it) => {
          const p = byId.get(it.project_id);
          return (
            <li key={`${it.project_id}:${it.relative_path}`}>
              <button
                type="button"
                disabled={!p}
                onClick={() => p && onOpenProject(p)}
                className="w-full flex items-start gap-2.5 px-1.5 py-1.5 rounded-[var(--radius-s)] text-left transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60 disabled:cursor-default cursor-pointer"
                aria-label={p ? `${p.name} 열기 — ${it.title}` : it.title}
              >
                <span className="text-[10.5px] font-mono text-[var(--text-3)] w-9 shrink-0 pt-0.5 tabular-nums">
                  {hhmm(it.created_at)}
                </span>
                <span className="min-w-0 flex flex-col gap-0.5">
                  <TriggerKicker type={it.type} title={null} />
                  <span className="text-[12.5px] text-[var(--text)] leading-snug line-clamp-2">
                    {it.title}
                  </span>
                  {p && (
                    <span className="text-[10.5px] font-mono text-[var(--text-3)] truncate">
                      {p.name}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// ── 판 (중간 밀도 타일) ─────────────────────────────────────────────────

export function ProjectPanel({
  row,
  now,
  onOpen,
  onRename,
  onDelete,
  indexing,
}: {
  row: ProjectRowT;
  now: number;
  indexing: boolean;
  onOpen: (p: Project) => void;
  onRename: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const { project: p, snap } = row;
  const when = relativeTime(snap?.lastAt ?? null, now);

  return (
    <article className="home-tile home-t-panel home-in-bento p-4 flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <Mark text={initials(p.name)} />
          <h3 className="text-[17px] font-bold tracking-[-0.012em] truncate min-w-0">
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="home-open text-left bg-transparent border-0 p-0 cursor-pointer text-inherit"
              aria-label={`${p.name} 열기 — 마지막 활동 ${when}`}
            >
              {p.name}
            </button>
          </h3>
          {indexing && (
            <span className="home-kbd shrink-0" role="status">
              인덱싱
            </span>
          )}
        </span>
        <span className="home-when shrink-0">{when}</span>
      </header>

      <div className="flex items-center gap-3 min-w-0">
        {snap && <Sparkline data={snap.spark} label={`${p.name} 최근 활동 추이`} />}
        {snap?.activePlan && (
          <span className="min-w-0 flex-1 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-2)] truncate min-w-0">
              {snap.nextTasks[0]?.item_title ?? snap.activePlan.plan_title}
            </span>
            <span className="text-[10.5px] font-mono text-[var(--text-3)] tabular-nums shrink-0">
              {snap.activePlan.done}/{snap.activePlan.total}
            </span>
          </span>
        )}
      </div>

      {snap?.lastTitle ? (
        <TriggerKicker type={snap.lastType} title={snap.lastTitle} />
      ) : (
        <span className="home-path">{tildePath(p.root_path)}</span>
      )}

      <footer className="mt-auto flex items-center justify-between gap-2">
        <AgentBadge agentId={snap?.lastAgentId ?? null} version={snap?.lastAgentVersion ?? null} />
        <RowActions name={p.name} onRename={() => onRename(p)} onDelete={() => onDelete(p)} />
      </footer>
    </article>
  );
}

// ── 추가 슬롯 ───────────────────────────────────────────────────────────

/**
 * 프로젝트 수에 따라 벤토 격자에 생기는 구멍을 메운다. 격자가 비어 보이는 걸
 * 막는 게 목적이라 `variant` 로 차지할 칸을 바꾼다.
 */
export function AddTile({
  variant,
  onAddExisting,
  onStartNew,
}: {
  variant: "hero" | "panel" | "tall" | "wide";
  onAddExisting: () => void;
  onStartNew: () => void;
}) {
  const span =
    variant === "hero"
      ? "home-t-hero"
      : variant === "tall"
        ? "home-t-flow"
        : variant === "wide"
          ? "home-t-wide"
          : "home-t-panel";

  return (
    <div className={`home-add ${span} home-in-bento p-5`} style={{ display: "grid" }}>
      <div className="flex flex-col items-center gap-3">
        <Plus className="w-7 h-7" strokeWidth={1.5} aria-hidden="true" />
        <span className="text-[13px] font-bold">프로젝트 추가</span>
        <span className="flex items-center gap-2">
          <button type="button" onClick={onAddExisting} className="home-chipbtn">
            <FolderOpen className="w-3 h-3" />
            기존 폴더
          </button>
          <button type="button" onClick={onStartNew} className="home-chipbtn">
            <Sparkles className="w-3 h-3" />
            새 프로젝트
          </button>
        </span>
      </div>
    </div>
  );
}

// ── 온보딩 (프로젝트 0개) ───────────────────────────────────────────────

/**
 * 첫 사용자에게 **수동 기록이 아니라는** 멘탈 모델을 준다.
 *
 * ⚠️ 이 안의 한국어 문자열 5개는 `src/__tests__/start_screen.test.tsx` 의
 * 계약이다 ("Ocul-PM 은 이렇게 동작해요" / "평소처럼 에이전트로 코딩" /
 * "자동으로 기록·정리" / aria-label "프로젝트 추가하고 시작하기").
 * 바꾸려면 그 테스트도 같은 커밋에서 고쳐야 한다.
 */
export function OnboardingTile({ onStart }: { onStart: () => void }) {
  const steps = [
    {
      n: 1,
      Icon: FolderOpen,
      title: "프로젝트 폴더 추가",
      body: "폴더를 불러오면 Ocul-PM 이 코딩 에이전트용 규칙(AGENTS.md)을 자동으로 심어요.",
    },
    {
      n: 2,
      Icon: Bot,
      title: "평소처럼 에이전트로 코딩",
      body: "Claude Code·Cursor·Gemini 등 쓰던 에이전트로 작업하면, 그 규칙에 따라 에이전트가 작업 일지를 남겨요.",
    },
    {
      n: 3,
      Icon: NotebookText,
      title: "자동으로 기록·정리",
      body: "남겨진 작업 일지·변경 diff·통계를 Today 화면에 모아 보여줍니다.",
    },
  ];

  return (
    <article className="home-tile home-tile--hero home-t-wide home-in-bento p-7 space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-[22px] font-bold tracking-tight text-[var(--text)]">
          Ocul-PM 은 이렇게 동작해요
        </h2>
        <p className="text-[13px] text-[var(--text-2)] leading-relaxed">
          직접 기록하지 않아도 됩니다. 평소처럼 코딩 에이전트로 작업하면, Ocul-PM 이 변경·작업
          일지·통계를 <span className="text-[var(--text)] font-semibold">자동으로</span> 모아줍니다.
        </p>
      </div>

      <ol className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {steps.map(({ n, Icon, title, body }) => (
          <li
            key={n}
            className="rounded-[var(--radius-m)] border border-[var(--border-card)] bg-[var(--bg-inset)] p-4 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[34px] font-medium leading-none text-[var(--text-3)] tabular-nums"
                style={{ fontFamily: "var(--font-heading, serif)" }}
                aria-hidden="true"
              >
                {n}
              </span>
              <Icon className="w-4 h-4 text-[var(--accent)]" strokeWidth={1.75} />
              <h3 className="text-[13px] font-bold text-[var(--text)]">{title}</h3>
            </div>
            <p className="text-[11.5px] text-[var(--text-2)] leading-relaxed">{body}</p>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onStart}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-m)] bg-[var(--accent)] text-[var(--text-on-accent)] text-[13px] font-bold hover:bg-[var(--accent-strong)] transition-colors cursor-pointer"
        aria-label="프로젝트 추가하고 시작하기"
      >
        <Plus className="w-4 h-4" />
        프로젝트 추가하고 시작하기
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </article>
  );
}
