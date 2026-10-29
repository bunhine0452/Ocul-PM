/**
 * 오늘 화면 오른쪽 칼럼 — 지금 일하는 중 · 계획 · 다음.
 *
 * 셋 다 「지금 무엇을 결정할까」에 답한다: 누가 돌고 있고(멈췄나), 계획은 판정을
 * 통과했나, 다음에 무엇을 넘길까. 숫자 장식은 없다.
 */

import { Copy } from "@/components/Icons";
import { agentLabel } from "@/features/today/agentColor";
import { useT } from "@/i18n";
import { relativeTime } from "@/lib/format";
import type { DigestItem, DigestPlan, TodayDigest } from "@/lib/bindings";
import type { LiveSession } from "./useLiveSessions";
import { QUIET_MINUTES } from "./useLiveSessions";
import { whenLabel } from "@/lib/whenLabel";

export function LiveCard({ sessions, now }: { sessions: LiveSession[]; now: number }) {
  const { t } = useT();
  if (sessions.length === 0) return null;
  return (
    <section className="card tdy-card" aria-labelledby="tdy-live-h">
      <header className="tdy-ch">
        <h2 id="tdy-live-h">{t("today.live.title")}</h2>
        <span className="tdy-cnt">{sessions.length}</span>
      </header>
      <ul className="tdy-list">
        {sessions.map((s) => {
          const since = s.lastRecordAt ?? s.startedAt;
          const quietMin = Math.floor((now - since) / 60_000);
          const quiet = quietMin >= QUIET_MINUTES;
          return (
            <li key={s.id} className="tdy-sess">
              <span className={"tdy-dot tdy-sess-dot" + (quiet ? " is-quiet" : "")} aria-hidden="true" />
              <div className="tdy-grow">
                <div>
                  {s.agentId ? agentLabel(s.agentId) : t("today.live.unknownAgent")}
                  {s.conversations > 1 ? (
                    <span className="tdy-meta"> · {t("today.live.conversations", { n: s.conversations })}</span>
                  ) : null}
                </div>
                <div className={quiet ? "tdy-meta tdy-warn" : "tdy-meta"}>
                  {quiet
                    ? t("today.live.quiet", { n: quietMin })
                    : s.lastRecordAt != null
                      ? t("today.live.last", { ago: relativeTime(s.lastRecordAt, now) })
                      : t("today.live.noneYet", { ago: relativeTime(s.startedAt, now) })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function VerdictLine({ plan }: { plan: DigestPlan }) {
  const { t } = useT();
  const v = plan.last_verdict;
  if (!v) {
    return <span className="tdy-meta">{plan.check ? t("today.plans.notRun") : t("today.plans.noCheck")}</span>;
  }
  return (
    <span className="tdy-meta">
      {t("today.plans.verdict")}{" "}
      <span className={v.passed ? "tdy-ok" : "tdy-bad"}>
        {v.passed ? t("today.plans.pass") : v.summary ? `✗ ${v.summary}` : t("today.plans.failed")}
      </span>
      {" · "}
      {whenLabel(v.ts)}
    </span>
  );
}

export function PlansCard({
  digest,
  onOpenPlan,
}: {
  digest: TodayDigest;
  onOpenPlan: (planId: string) => void;
}) {
  const { t } = useT();
  const userLeft = (planId: string) => digest.needs_user.filter((i) => i.plan_id === planId).length;
  return (
    <section className="card tdy-card" aria-labelledby="tdy-plans-h">
      <header className="tdy-ch">
        <h2 id="tdy-plans-h">{t("today.plans.title")}</h2>
        <span className="tdy-cnt">{digest.plans.length}</span>
      </header>
      {digest.plans.length === 0 ? (
        <p className="tdy-pad tdy-meta">{t("today.plans.none")}</p>
      ) : (
        <ul className="tdy-list">
          {digest.plans.map((p) => {
            const pct = p.item_count > 0 ? Math.round((p.done_count / p.item_count) * 100) : 0;
            const mine = userLeft(p.plan_id);
            return (
              <li key={p.plan_id}>
                <button
                  type="button"
                  className="tdy-plan"
                  aria-label={t("today.plans.openAria", { plan: p.title })}
                  onClick={() => onOpenPlan(p.plan_id)}
                >
                  <span className="tdy-plan-r1">
                    <b className="tdy-grow tdy-ellipsis">{p.title}</b>
                    <span className="tdy-meta mono">
                      {p.done_count}/{p.item_count}
                    </span>
                  </span>
                  <span className="tdy-bar" aria-hidden="true">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <span className="tdy-plan-r3">
                    <VerdictLine plan={p} />
                    {mine > 0 ? <span className="tdy-meta">· {t("today.plans.userLeft", { n: mine })}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function NextCard({
  next,
  onCopy,
  onOther,
}: {
  next: { plan: DigestPlan; item: DigestItem } | null;
  onCopy: () => void;
  onOther: () => void;
}) {
  const { t } = useT();
  return (
    <section className="card tdy-card" aria-labelledby="tdy-next-h">
      <header className="tdy-ch">
        <h2 id="tdy-next-h">{t("today.nextUp.title")}</h2>
      </header>
      <div className="tdy-next">
        {next ? (
          <>
            <div>
              <div className="tdy-strong">{next.item.title}</div>
              <div className="tdy-meta">{`${next.plan.title} · #${next.item.item_id}`}</div>
              {/* 완료 조건은 문단일 수 있다 — 두 줄까지만, 전부는 계획 화면에서. */}
              {next.plan.done_when ? (
                <div className="tdy-meta tdy-clamp" title={next.plan.done_when}>
                  {t("today.nextUp.doneWhen", { text: next.plan.done_when })}
                </div>
              ) : null}
            </div>
            <div className="tdy-actions">
              <button type="button" className="btn primary sm" onClick={onCopy}>
                <Copy size={13} aria-hidden="true" />
                {t("today.nextUp.copy")}
              </button>
              <button type="button" className="btn ghost sm" onClick={onOther}>
                {t("today.nextUp.other")}
              </button>
            </div>
            <div className="tdy-meta">
              {t("today.nextUp.hint")} <code className="tdy-code mono">/oculpm:next until-done</code>
            </div>
          </>
        ) : (
          <p className="tdy-meta">{t("today.nextUp.none")}</p>
        )}
      </div>
    </section>
  );
}
