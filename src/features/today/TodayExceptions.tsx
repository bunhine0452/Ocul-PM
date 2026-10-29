/**
 * 오늘 화면의 예외 두 칸 (4.0 `{#ui-today}` → 화면 검사 `{#today-split}`).
 *
 * 「먼저 볼 것」 은 지금 손댈 것만 심각도 순으로(`todayModel.EXCEPTION_ORDER`), 검증 없이 끝난
 * 일지는 그 아래 한 묶음이다 — 읽음 버튼은 묶음 머리에 하나, 행마다 붙은 것은 행에 올라가야 보인다.
 * 두 칸의 행은 한 목록(`TodaySplit.rows`)이라 j/k 가 칸을 건너 이어지고, 각 행의 첫 버튼이 그 행의
 * 기본 동작이다 — Enter 가 누르는 것도 그것이다. 비었으면 차분한 한 문단: 무엇을 봤고 무엇이
 * 없었는지를 말하되, 못 본 것(일지 없는 변경을 못 읽음)은 없다고 말하지 않는다.
 */

import type { RefObject } from "react";

import { Check } from "@/components/Icons";
import { SkeletonList } from "@/components/ui/Skeleton";
import { agentLabel } from "@/features/today/agentColor";
import { useT, type I18nKey } from "@/i18n";
import type { JournalEntrySummary } from "@/lib/bindings";
import { stripUserTag } from "@/features/planner/planMeta";
import { whenLabel } from "@/lib/whenLabel";
import type { ExceptionKind, TodayException, TodaySplit } from "./todayModel";

const PILL: Record<ExceptionKind, { key: I18nKey; tone: string }> = {
  verdict: { key: "today.check.kind.verdict", tone: "danger" },
  evidence: { key: "today.check.kind.evidence", tone: "warn" },
  unrecorded: { key: "today.check.kind.unrecorded", tone: "warn" },
  silent: { key: "today.check.kind.unrecorded", tone: "warn" },
  blocked: { key: "today.check.kind.blocked", tone: "danger" },
  decision: { key: "today.check.kind.decision", tone: "" },
  plugin: { key: "today.check.kind.plugin", tone: "" },
};

const PRIMARY: Record<ExceptionKind, I18nKey> = {
  verdict: "today.check.openOutput",
  evidence: "today.check.diff",
  unrecorded: "today.check.viewChanges",
  silent: "today.check.viewChanges",
  blocked: "today.check.openPlan",
  decision: "today.check.openPlan",
  plugin: "today.pluginDrift.copy",
};

function shortId(id: string): string {
  return id.length > 9 ? `${id.slice(0, 8)}…` : id;
}

function useRowText(ex: TodayException): { title: string; meta: string; mono: boolean } {
  const { t } = useT();
  switch (ex.kind) {
    case "verdict": {
      // 누가 돌렸는지는 빼고 무엇이 나왔는지만 — 같은 에이전트 이름이 줄마다 섰다 ({#today-repeat}).
      const parts = [ex.plan.check, ex.verdict.summary || t("today.check.noSummary"), whenLabel(ex.verdict.ts)];
      return { title: t("today.check.verdictTitle", { plan: ex.plan.title }), meta: parts.filter(Boolean).join(" · "), mono: true };
    }
    case "evidence":
      return { title: ex.entry.title, meta: "", mono: false };
    case "unrecorded": {
      const [first, ...rest] = ex.files;
      return {
        title: t("today.check.unrecordedTitle", { n: ex.files.length }),
        meta: rest.length > 0 ? t("today.check.moreFiles", { first, n: rest.length }) : first,
        mono: false,
      };
    }
    case "silent": {
      const last = ex.signals.reduce((a, b) => (b.ts > a.ts ? b : a));
      return {
        title: t("today.check.silentTitle", { n: ex.signals.length }),
        meta: t("today.check.silentMeta", { time: whenLabel(last.ts), id: shortId(last.session_id) }),
        mono: false,
      };
    }
    case "blocked":
    case "decision": {
      const [first, ...rest] = ex.items;
      const title = stripUserTag(first.title);
      const meta = [t("today.check.inPlan", { plan: ex.planTitle }), `#${first.item_id}`];
      if (ex.kind === "decision") meta.push(t("today.check.userShare"));
      return { title: rest.length > 0 ? t("today.check.moreItems", { title, n: rest.length }) : title, meta: meta.join(" · "), mono: false };
    }
    case "plugin":
      return {
        title: t("today.pluginDrift.title", { installed: ex.installed, bundled: ex.bundled }),
        meta: "/plugin update oculpm@oculpm",
        mono: true,
      };
  }
}

interface RowNav {
  active: boolean;
  rowRef: (el: HTMLLIElement | null) => void;
  onFocus: () => void;
}

function ExceptionRow({ ex, active, rowRef, onFocus, onPrimary }: RowNav & { ex: TodayException; onPrimary: (ex: TodayException) => void }) {
  const { t } = useT();
  const { title, meta, mono } = useRowText(ex);
  const pill = PILL[ex.kind];
  return (
    <li
      ref={rowRef}
      className="tdy-row"
      tabIndex={active ? 0 : -1}
      data-kind={ex.kind}
      aria-label={`${t(pill.key)} — ${title}`}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocus();
      }}
    >
      <span className={"chip sm " + pill.tone}>{t(pill.key)}</span>
      <div className="tdy-row-t">
        <div className="tdy-row-title">{title}</div>
        {meta ? <div className={"tdy-meta" + (mono ? " mono" : "")}>{meta}</div> : null}
      </div>
      <button type="button" className="btn sm" onClick={() => onPrimary(ex)}>
        {t(PRIMARY[ex.kind])}
      </button>
    </li>
  );
}

/**
 * 검증 없이 끝난 일지 한 행 — 시각 · 제목(누르면 그 일지) · 행에 올라가야 보이는 「읽음」.
 * 이유(검증에 명령이 없음 / 검증을 안 적음)는 묶음 머리가 이미 말하니 툴팁으로 내리고, 읽은 뒤
 * 바뀐 일지만 그 이유를 줄에 쓴다 — 다른 행과 이유가 다르다.
 */
function UnreadRow({
  ex,
  active,
  rowRef,
  onFocus,
  onOpen,
  onVerify,
  showAgent,
}: RowNav & {
  ex: Extract<TodayException, { kind: "evidence" }>;
  onOpen: (ex: TodayException) => void;
  onVerify: (entry: JournalEntrySummary) => void;
  showAgent: boolean;
}) {
  const { t } = useT();
  const e = ex.entry;
  const stale = e.verified_by_user && e.verified_stale;
  const why = stale ? t("today.check.evidenceStale") : e.evidence > 0 ? t("today.check.evidenceSection") : t("today.check.evidenceNone");
  const meta = [stale ? why : null, showAgent ? agentLabel(e.agent_id) : null].filter(Boolean).join(" · ");
  return (
    <li
      ref={rowRef}
      className="tdy-row tdy-unread"
      tabIndex={active ? 0 : -1}
      data-kind={ex.kind}
      aria-label={e.title}
      title={why}
      onFocus={(ev) => {
        if (ev.target === ev.currentTarget) onFocus();
      }}
    >
      <span className="tdy-time">{whenLabel(e.created_at)}</span>
      <div className="tdy-row-t">
        <button type="button" className="tdy-row-title tdy-row-open" onClick={() => onOpen(ex)}>
          {e.title}
        </button>
        {meta ? <div className="tdy-meta">{meta}</div> : null}
      </div>
      <button
        type="button"
        className="btn ghost sm tdy-row-quiet"
        aria-label={t("today.check.verifyAria", { title: e.title })}
        onClick={() => onVerify(e)}
      >
        <Check size={13} aria-hidden="true" />
        {t("today.check.verify")}
      </button>
    </li>
  );
}

interface TodayExceptionsProps {
  /** `null` = 아직 모름(읽는 중). */
  split: TodaySplit | null;
  /** 오늘 일지 수 — 빈 문단의 재료. */
  entryCount: number;
  /** 일지 없는 변경을 읽었는가 — 못 읽었으면 「없어요」라고 말하지 않는다. */
  unrecordedKnown: boolean;
  /** 오늘 일지를 쓴 에이전트가 둘 이상인가 — 하나면 줄마다 이름을 쓰지 않는다. */
  showAgent: boolean;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  rowRefs: RefObject<Array<HTMLLIElement | null>>;
  onPrimary: (ex: TodayException) => void;
  onVerify: (entry: JournalEntrySummary) => void;
  onVerifyAll: (entries: JournalEntrySummary[]) => void;
}

export function TodayExceptions({
  split,
  entryCount,
  unrecordedKnown,
  showAgent,
  activeIndex,
  setActiveIndex,
  rowRefs,
  onPrimary,
  onVerify,
  onVerifyAll,
}: TodayExceptionsProps) {
  const { t } = useT();
  const nav = (i: number): RowNav => ({
    active: i === Math.max(0, activeIndex),
    rowRef: (el) => {
      if (rowRefs.current) rowRefs.current[i] = el;
    },
    onFocus: () => setActiveIndex(i),
  });

  if (split == null) {
    return (
      <section className="card tdy-card" aria-labelledby="tdy-check-h">
        <header className="tdy-ch">
          <h2 id="tdy-check-h">{t("today.check.title")}</h2>
        </header>
        <div className="tdy-pad">
          <SkeletonList rows={2} height={34} gap={8} />
        </div>
      </section>
    );
  }

  const { first, unread } = split;
  return (
    <>
      {first.length > 0 || unread.length === 0 ? (
        <section className="card tdy-card" aria-labelledby="tdy-check-h">
          <header className="tdy-ch">
            <h2 id="tdy-check-h">{t("today.check.title")}</h2>
            {first.length > 0 ? <span className="tdy-cnt">{first.length}</span> : null}
          </header>
          {first.length === 0 ? (
            <div className="tdy-empty">
              <Check size={18} className="tdy-empty-ico" aria-hidden="true" />
              <div>
                <div className="tdy-strong">{t("today.check.emptyTitle")}</div>
                <div className="tdy-meta">
                  {entryCount === 0
                    ? t("today.check.emptyBodyQuiet")
                    : unrecordedKnown
                      ? t("today.check.emptyBody", { n: entryCount })
                      : t("today.check.emptyBodyUnknown", { n: entryCount })}
                </div>
              </div>
            </div>
          ) : (
            <ul className="tdy-rows" aria-label={t("today.check.title")}>
              {first.map((ex, i) => (
                <ExceptionRow key={ex.key} ex={ex} {...nav(i)} onPrimary={onPrimary} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {unread.length > 0 ? (
        <section className="card tdy-card" aria-labelledby="tdy-unread-h">
          <header className="tdy-ch">
            <h2 id="tdy-unread-h">{t("today.unread.title")}</h2>
            <span className="tdy-cnt">{unread.length}</span>
            <span className="tdy-sp" />
            <button type="button" className="btn ghost sm" onClick={() => onVerifyAll(unread.map((u) => u.entry))}>
              {t("today.unread.allRead")}
            </button>
          </header>
          <ul className="tdy-rows" aria-label={t("today.unread.title")}>
            {unread.map((ex, j) => (
              <UnreadRow
                key={ex.key}
                ex={ex}
                {...nav(first.length + j)}
                onOpen={onPrimary}
                onVerify={onVerify}
                showAgent={showAgent}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
