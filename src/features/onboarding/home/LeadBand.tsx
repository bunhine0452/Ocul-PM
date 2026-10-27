/**
 * 사령탑 밴드 — "어디서 이어서 일하지?" 의 답 하나 (2026-09-11 원장 리디자인).
 *
 * 2026-08-12 에 벤토 사령탑을 걷어낸 이유는 **높이**였다 — 340px 타일이
 * 프로젝트 9개에서 화면 절반을 먹었다. 이 밴드는 그 교훈을 지킨다: 높이는
 * 텍스트 세 줄이 정하는 약 110px 이고, 폭은 창 전체다. 순위 1위 하나가
 * 큰 활자로 서고, 그 오른쪽에 14일 맥박이 커진다. 나머지 프로젝트는 아래
 * 원장에서 같은 규칙으로 읽힌다.
 *
 * 커서 평면에서는 그냥 첫 행이다 — `wiring` 을 원장 행과 똑같이 받는다.
 */
import { useEffect, useState } from "react";
import { ListTodo } from "@/components/Icons";
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import type { Project, PromiseScorecard } from "@/lib/bindings";
import { useT } from "@/i18n";
import { Progress, RowActions, Skel, Sparkline } from "./atoms";
import { relativeTime, SPARK_DAYS, tildePath, type ProjectRowT } from "./homeModel";
import { resolveProjectColor, resolveProjectIcon } from "./projectAppearance";
import type { RowWiring } from "./rows";

export function LeadBand({
  row,
  now,
  loading,
  indexing,
  opened,
  wiring,
  onOpen,
  onRename,
  onDelete,
}: {
  row: ProjectRowT;
  now: number;
  /**
   * 첫 집계가 아직이다 — 이름·경로·열림은 로컬이라 그대로 서고, 집계에서
   * 오는 것(시각·다음 할 일·맥박·플랜)만 자리를 지킨다. 밴드 통째로
   * 스켈레톤이면 커서 평면의 첫 행(=탭 스톱)이 화면에 없는 상태가 된다.
   */
  loading: boolean;
  indexing: boolean;
  opened: boolean;
  wiring: RowWiring;
  onOpen: (p: Project) => void;
  onRename: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const { t } = useT();
  const p = row.project;
  const snap = row.snap;
  const when = relativeTime(snap?.lastAt ?? null, now);
  const next = snap?.nextTasks?.[0] ?? null;
  const plan = snap?.activePlan ?? null;
  const spark = snap?.spark ?? [];
  const windowTotal = spark.reduce((a, b) => a + b, 0);
  const { Icon } = resolveProjectIcon(p.name, p.icon);
  const color = resolveProjectColor(p.name, p.color);
  const pending = loading && !snap;

  // 「오늘 어디서부터」 (UI 밀도 라운드 2) — 1위 프로젝트 하나에만 완료 조건과 숫자 셋
  // (증거 · 미기록 · 사용자 몫)을 붙인다. 실패는 조용히 비운다 — 밴드의 나머지는 로컬
  // 집계라 그대로 서고, 이 둘만 "모름" 으로 남는다.
  const [goal, setGoal] = useState<string | null>(null);
  const [score, setScore] = useState<PromiseScorecard | null>(null);
  useEffect(() => {
    let cancelled = false;
    setGoal(null);
    setScore(null);
    // 둘 다 선택 자료다 — API 가 없는 자리(공급자 없이 밴드만 그리는 테스트)에서는
    // 동기 예외까지 삼키고 「모름」으로 둔다.
    try {
      if (plan?.plan_id) {
        void planApi
          .get(p.id, plan.plan_id)
          .then((d) => {
            if (!cancelled) setGoal(d?.done_when ?? null);
          })
          .catch(() => {});
      }
      void oculpmApi
        .promiseScorecard(p.id, 30)
        .then((sc) => {
          if (!cancelled && sc?.journal) setScore(sc);
        })
        .catch(() => {});
    } catch {
      /* 선택 자료 — 없으면 없는 대로 */
    }
    return () => {
      cancelled = true;
    };
  }, [p.id, plan?.plan_id]);
  const evidencePct =
    score && score.journal.judged_entries > 0
      ? Math.round((score.journal.evidence_entries / score.journal.judged_entries) * 100)
      : null;
  // i18n-ignore-next-line -- 플랜 항목 문구의 「[사용자]」 표식을 찾는 정규식 (표시 문자열 아님)
  const userItems = snap?.nextTasks?.filter((n) => /\[사용자\]|\[user\]/i.test(n.item_title)).length ?? 0;

  return (
    <section
      ref={(el) => wiring.register(row.id, el)}
      data-pc={color}
      className={"hl-lead" + (wiring.isCursor ? " is-cursor" : "")}
      aria-label={t("home.resumeWork")}
      aria-busy={pending || undefined}
      onKeyDown={wiring.onRowKeyDown}
      onFocus={() => wiring.onRowFocus(row.id)}
      onPointerMove={() => wiring.onRowPointerMove(row.id)}
    >
      <div className="hl-lead-main">
        <p className="hl-lead-eyebrow">
          <span>{t("home.resumeWork")}</span>
          {opened && <span className="hl-chip">{t("project.opened")}</span>}
          {indexing && (
            <span className="hl-chip" role="status">
              {t("home.indexing")}
            </span>
          )}
        </p>
        <div className="hl-lead-title">
          <span className="hl-mark hl-mark--lead" aria-hidden="true">
            <Icon strokeWidth={1.8} />
          </span>
          <button
            type="button"
            className="hl-lead-name home-open"
            tabIndex={wiring.tabbable ? 0 : -1}
            onClick={() => onOpen(p)}
            aria-label={t("home.openAria", { name: p.name, when })}
          >
            {p.name}
          </button>
        </div>
        <p className="hl-lead-meta">
          <span className="hl-path">{tildePath(p.root_path)}</span>
          {pending ? (
            <Skel w={64} h={10} />
          ) : (
            <span className="hl-lead-when">{when}</span>
          )}
          {snap && snap.todayCount > 0 && (
            <span className="hl-today">{t("home.datelineToday", { n: snap.todayCount })}</span>
          )}
        </p>
        {goal ? (
          <p className="hl-lead-goal">
            <span className="hl-lead-goal-tag">{t("plan.doneWhen")}</span>
            <span>{goal}</span>
          </p>
        ) : null}
        <p className="hl-lead-next">
          {pending ? (
            <Skel w={320} h={11} />
          ) : next ? (
            <>
              <ListTodo className="hl-next-icon" strokeWidth={2} aria-hidden="true" />
              <span>{next.item_title}</span>
            </>
          ) : snap?.lastTitle ? (
            <span className="hl-dim">{snap.lastTitle}</span>
          ) : (
            <span className="hl-dim">{t("home.noRecord")}</span>
          )}
        </p>
      </div>

      {/* 오른쪽 — 맥박. 원장 행의 62px 스파크가 여기서는 폭 200·높이 48 로
          커진다. 이 화면에서 유일하게 큰 그림이고, 그래서 하나뿐이다. */}
      <div className="hl-lead-side">
        {pending ? (
          <Skel w={200} h={48} />
        ) : (
          <>
            <span className="hl-pulse">
              <Sparkline data={spark} label={t("home.sparkProjectAria", { name: p.name })} />
            </span>
            <span className="hl-pulse-label">
              {t("home.pulseLabel", { days: SPARK_DAYS, n: windowTotal })}
            </span>
          </>
        )}
        {plan && plan.total > 0 && (
          <span className="hl-lead-plan">
            <span className="hl-lead-plan-title">{plan.plan_title}</span>
            <Progress done={plan.done} total={plan.total} />
          </span>
        )}
        {score ? (
          <span className="hl-lead-nums" aria-label={t("home.numsAria")}>
            <span><i>{t("home.numEvidence")}</i><b data-tone={evidencePct !== null && evidencePct >= 97 ? "ok" : "warn"}>{evidencePct === null ? "—" : `${evidencePct}%`}</b></span>
            <span><i>{t("home.numRework")}</i><b data-tone={score.journal.bug_entries > 0 && score.journal.rework_within_7d / score.journal.bug_entries > 0.3 ? "warn" : "ok"}>{score.journal.bug_entries === 0 ? "—" : `${Math.round((score.journal.rework_within_7d / score.journal.bug_entries) * 100)}%`}</b></span>
            <span><i>{t("home.numUser")}</i><b>{userItems}</b></span>
          </span>
        ) : null}
      </div>

      <span className="hl-actions hl-lead-actions">
        <RowActions
          name={p.name}
          tabbable={wiring.tabbable}
          onRename={() => onRename(p)}
          onDelete={() => onDelete(p)}
        />
      </span>
    </section>
  );
}
