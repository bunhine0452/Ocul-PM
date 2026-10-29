/**
 * 「확인할 것」 카드 — 오늘 화면의 첫 카드이자 거의 전부 (4.0 `{#ui-today}`).
 *
 * 행은 심각도 순이고(`todayModel.EXCEPTION_ORDER`) 각 행의 첫 버튼이 그 행의 기본 동작이다
 * — Enter 가 누르는 것도 그것이다. 비었으면 차분한 한 문단: 무엇을 봤고 무엇이 없었는지를
 * 말하되, 못 본 것(기록 없는 변경을 못 읽음)은 없다고 말하지 않는다.
 */

import type { RefObject } from "react";

import { Check } from "@/components/Icons";
import { SkeletonList } from "@/components/ui/Skeleton";
import { agentLabel } from "@/features/today/agentColor";
import { useT, type I18nKey } from "@/i18n";
import type { JournalEntrySummary } from "@/lib/bindings";
import { stripUserTag } from "@/features/planner/planMeta";
import { whenLabel } from "@/lib/whenLabel";
import type { ExceptionKind, TodayException } from "./todayModel";

const PILL: Record<ExceptionKind, { key: I18nKey; tone: string }> = {
  verdict: { key: "today.check.kind.verdict", tone: "danger" },
  evidence: { key: "today.check.kind.evidence", tone: "warn" },
  unrecorded: { key: "today.check.kind.unrecorded", tone: "warn" },
  silent: { key: "today.check.kind.unrecorded", tone: "warn" },
  blocked: { key: "today.check.kind.blocked", tone: "danger" },
  decision: { key: "today.check.kind.decision", tone: "accent" },
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
      const parts = [ex.plan.check, ex.verdict.summary || t("today.check.noSummary"), whenLabel(ex.verdict.ts), agentLabel(ex.verdict.agent_id)];
      return { title: t("today.check.verdictTitle", { plan: ex.plan.title }), meta: parts.filter(Boolean).join(" · "), mono: true };
    }
    case "evidence": {
      const e = ex.entry;
      const why = e.verified_by_user && e.verified_stale
        ? t("today.check.evidenceStale")
        : e.evidence > 0
          ? t("today.check.evidenceSection")
          : t("today.check.evidenceNone");
      return { title: e.title, meta: [why, whenLabel(e.created_at), agentLabel(e.agent_id)].join(" · "), mono: false };
    }
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

interface RowProps {
  ex: TodayException;
  active: boolean;
  rowRef: (el: HTMLLIElement | null) => void;
  onFocus: () => void;
  onPrimary: (ex: TodayException) => void;
  onVerify: (entry: JournalEntrySummary) => void;
}

function ExceptionRow({ ex, active, rowRef, onFocus, onPrimary, onVerify }: RowProps) {
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
        {/* 일지 행은 버튼이 「확인함」 하나다 — 그 일지(검증 상자 · diff)는 제목을 눌러 연다. */}
        {ex.kind === "evidence" ? (
          <button type="button" className="tdy-row-title tdy-row-open" title={t(PRIMARY[ex.kind])} onClick={() => onPrimary(ex)}>
            {title}
          </button>
        ) : (
          <div className="tdy-row-title">{title}</div>
        )}
        {meta ? <div className={"tdy-meta" + (mono ? " mono" : "")}>{meta}</div> : null}
      </div>
      {ex.kind === "evidence" ? (
        <button
          type="button"
          className="btn sm"
          aria-label={t("today.check.verifyAria", { title: ex.entry.title })}
          onClick={() => onVerify(ex.entry)}
        >
          <Check size={13} aria-hidden="true" />
          {t("today.check.verify")}
        </button>
      ) : (
        <button type="button" className="btn sm" onClick={() => onPrimary(ex)}>
          {t(PRIMARY[ex.kind])}
        </button>
      )}
    </li>
  );
}

interface TodayExceptionsProps {
  exceptions: TodayException[] | null;
  /** 오늘 일지 수 — 빈 문단의 재료. */
  entryCount: number;
  /** 기록 없는 변경을 읽었는가 — 못 읽었으면 「없어요」라고 말하지 않는다. */
  unrecordedKnown: boolean;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  rowRefs: RefObject<Array<HTMLLIElement | null>>;
  onPrimary: (ex: TodayException) => void;
  onVerify: (entry: JournalEntrySummary) => void;
}

export function TodayExceptions({
  exceptions,
  entryCount,
  unrecordedKnown,
  activeIndex,
  setActiveIndex,
  rowRefs,
  onPrimary,
  onVerify,
}: TodayExceptionsProps) {
  const { t } = useT();
  const count = exceptions?.length ?? null;
  return (
    <section className="card tdy-card" aria-labelledby="tdy-check-h">
      <header className="tdy-ch">
        <h2 id="tdy-check-h">{t("today.check.title")}</h2>
        {count != null ? <span className="tdy-cnt">{count}</span> : null}
      </header>
      {exceptions == null ? (
        <div className="tdy-pad">
          <SkeletonList rows={2} height={34} gap={8} />
        </div>
      ) : exceptions.length === 0 ? (
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
          {exceptions.map((ex, i) => (
            <ExceptionRow
              key={ex.key}
              ex={ex}
              active={i === Math.max(0, activeIndex)}
              rowRef={(el) => {
                if (rowRefs.current) rowRefs.current[i] = el;
              }}
              onFocus={() => setActiveIndex(i)}
              onPrimary={onPrimary}
              onVerify={onVerify}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
