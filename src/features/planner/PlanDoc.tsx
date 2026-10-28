/**
 * 계획 한 장 — 메타 한 줄 · 문서 제목 · 완료 조건/확인 명령/마지막 판정 · 다음 · 단계 격자 ·
 * 갱신 기록 (시안 Plan).
 *
 * 판정 카드가 제목 바로 아래에 있는 이유: 「항목이 다 닫혔다」와 「완료 조건이 참이다」는
 * 다른 주장이고, 둘째를 말하는 것은 에이전트가 아니라 확인 명령의 결과 끝 줄이다.
 */

import { Copy } from "@/components/Icons";
import { agentLabel } from "@/features/today/agentColor";
import { whenLabel } from "@/lib/whenLabel";
import { getLang, useT } from "@/i18n";
import type { PlanDetail, PlanItemDto } from "@/lib/bindings";
import { PlanItems } from "./PlanItems";
import { PlanLog } from "./PlanLog";
import { hasOpenLeaves, nextLeaf } from "./planMeta";

function dateOf(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat(getLang(), { month: "long", day: "numeric" }).format(new Date(ms));
}

function JudgeCard({ detail }: { detail: PlanDetail }) {
  const { t } = useT();
  const v = detail.plan.last_verdict;
  return (
    <section className="card plv-judge" aria-label={t("plan.judge.aria")}>
      <div>
        <h3 className="plv-sec-h">{t("plan.judge.doneWhen")}</h3>
        <p className={detail.done_when ? "plv-judge-text" : "plv-meta"}>{detail.done_when ?? t("plan.judge.noDoneWhen")}</p>
      </div>
      <div className="plv-judge-row">
        <div className="plv-judge-check">
          <h3 className="plv-sec-h">{t("plan.judge.check")}</h3>
          {detail.check ? <code className="plv-code mono">{detail.check}</code> : <p className="plv-meta">{t("plan.judge.noCheck")}</p>}
        </div>
        <div className="plv-judge-last">
          <h3 className="plv-sec-h">{t("plan.judge.last")}</h3>
          {v ? (
            <>
              <div className="plv-judge-chip">
                <span className={"chip sm " + (v.passed ? "ok" : "danger")}>{v.passed ? t("plan.judge.pass") : t("plan.judge.fail")}</span>
                <span className="plv-meta">
                  {whenLabel(v.ts)} · {agentLabel(v.agent_id)}
                </span>
              </div>
              {v.summary ? <div className="plv-meta mono plv-judge-summary">{v.summary}</div> : null}
            </>
          ) : (
            <p className="plv-meta">{t("plan.judge.notRun")}</p>
          )}
        </div>
      </div>
      <p className="plv-meta">{t("plan.judge.rule")}</p>
    </section>
  );
}

function NextRow({
  items,
  onCopy,
  onCopyUntilDone,
}: {
  items: PlanItemDto[];
  onCopy: (item: PlanItemDto) => void;
  onCopyUntilDone: (item: PlanItemDto) => void;
}) {
  const { t } = useT();
  const next = nextLeaf(items);
  return (
    <div className="plv-next">
      <b className="plv-next-label">{t("plan.nextRow.label")}</b>
      {next ? (
        <>
          <span className="plv-next-title">{next.title}</span>
          <span className="plv-meta mono">#{next.item_id}</span>
          <span className="plv-grow" />
          <button type="button" className="btn primary sm" onClick={() => onCopy(next)}>
            <Copy size={13} aria-hidden="true" />
            {t("plan.nextRow.copy")}
          </button>
          <button type="button" className="btn sm" title={t("plan.nextRow.untilDoneTitle")} onClick={() => onCopyUntilDone(next)}>
            {t("plan.nextRow.untilDone")}
          </button>
        </>
      ) : (
        <span className="plv-meta">{hasOpenLeaves(items) ? t("plan.nextRow.none") : t("plan.nextRow.allClosed")}</span>
      )}
    </div>
  );
}

export function PlanDoc({
  projectId,
  detail,
  locked,
  onSetStatus,
  onCopy,
  onCopyUntilDone,
  onOpenJournal,
}: {
  projectId: number;
  detail: PlanDetail;
  locked: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onCopy: (item: PlanItemDto) => void;
  onCopyUntilDone: (item: PlanItemDto) => void;
  onOpenJournal: (ref: string) => void;
}) {
  const { t } = useT();
  const p = detail.plan;
  return (
    <article className="plv-doc">
      <header className="plv-head">
        <div className="plv-meta">
          {t("plan.doc.meta", { date: dateOf(p.updated_at), agent: agentLabel(p.owner_agent), n: p.item_count })}
          {locked ? ` · ${t("plan.doc.locked")}` : null}
        </div>
        <h2 className="plv-title">{p.title}</h2>
      </header>
      <JudgeCard detail={detail} />
      {locked ? null : <NextRow items={detail.items} onCopy={onCopy} onCopyUntilDone={onCopyUntilDone} />}
      <PlanItems items={detail.items} locked={locked} onSetStatus={onSetStatus} onOpenJournal={onOpenJournal} />
      <PlanLog projectId={projectId} planId={p.plan_id} revision={detail.items.map((i) => i.status).join("")} decisions={detail.decisions} />
    </article>
  );
}
