import { useCallback, useEffect, useState } from "react";

import { planApi } from "@/api/plan";
import { Disclosure } from "@/components/Disclosure";
import { agentLabel } from "@/features/today/agentColor";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { getLang, useT } from "@/i18n";
import type { PlanDecisionDto, PlanItemDto, PlanItemUpdateDto } from "@/lib/bindings";
import { STATUS_META, stripUserTag } from "./planMeta";
import { StatusMark } from "./StatusMark";

/** ISO 시각 → 「11월 14일 17:26」 (로컬). 못 읽으면 원문. */
function stamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat(getLang(), { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

/**
 * 펼친 계획 기록이 한 번에 그리는 줄 수 (11-22) — 최신부터. 끝까지 맡긴 긴 실행은 항목마다 잡음 · 판정 · 닫음을
 * 적어 기록이 수백 줄이 된다. 펼치는 한 번에 그 전부(400줄 = DOM 4,407개)를 세우지 않고, 나머지는 「N줄 더
 * 보기」 가 이만큼씩 더 그린다.
 */
export const LOG_LIMIT = 50;

/**
 * 「이력 N줄 · 결정 M」 — 계획 문서 끝의 계획 기록(plan-log)과 결정, 한 줄로 접힌 채 시작한다.
 * 0 인 쪽은 쓰지 않고, 둘 다 0 이면(또는 아직 읽는 중이면) 줄 자체를 세우지 않는다 (화면 검사 {#hide-zero}).
 *
 * 행은 항목별 이력과 같은 투영(`oculpm_plan_item_updates`)이고 계획 단위로 한 번
 * 읽는다 (`plan_log`). 못 읽으면 「모름」 — 0줄과 같은 얼굴을 하지 않는다.
 *
 * 11-15: 행은 표가 아니라 두 줄 목록이다 — 상자 · 상태 이름(할 일 → 완료) · 항목 제목 / 시각 · 누가 · 메모.
 * 표일 때는 `in_progress → done` · `#id` · ISO 시각이 날것으로 섰고 좁은 창에서 오른쪽이 잘렸다. 디스크가
 * 바뀌면(에이전트가 기록을 더하면) 스스로 다시 읽는다 — 문서의 항목 상태만 보고는 기록 줄이 늘어난 것을
 * 놓쳤다. 화면이 계획마다 새로 그린다(`key`) — 다른 계획의 행이 한 프레임 남지 않게.
 */
export function PlanLog({
  projectId,
  planId,
  revision,
  decisions,
  items,
}: {
  projectId: number;
  planId: string;
  /** 계획이 바뀐 신호 — 다시 읽는다. */
  revision: string;
  decisions: PlanDecisionDto[];
  /** 항목 제목을 찾을 곳 — 행이 id 대신 제목을 말한다. */
  items: readonly PlanItemDto[];
}) {
  const { t } = useT();
  const [rows, setRows] = useState<PlanItemUpdateDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(LOG_LIMIT);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useOculpmDataEvents("planner", projectId, true, reload);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void Promise.resolve()
      .then(() => planApi.log(projectId, planId))
      .then((res) => {
        if (!cancelled) setRows(res ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, planId, revision, tick]);

  const parts = [
    rows && rows.length > 0 ? t("plan.log.rows", { n: rows.length }) : null,
    decisions.length > 0 ? t("plan.log.decisionCount", { n: decisions.length }) : null,
  ].filter(Boolean);
  if (!failed && parts.length === 0) return null;

  // 최신이 위 — 펼쳤을 때 한 번에 `LOG_LIMIT` 줄까지만 그린다. 머리의 「계획 기록 N줄」 은 늘 전부를 센다.
  const newest = rows ? rows.slice(Math.max(0, rows.length - limit)).reverse() : [];
  const hidden = rows ? rows.length - newest.length : 0;

  const titleOf = (id: string) => {
    const it = items.find((i) => i.item_id === id);
    return it ? stripUserTag(it.title) : id;
  };
  const statusName = (s: string | null) => (s ? t(STATUS_META[s]?.labelKey ?? "plan.status.todo") : "·");

  return (
    <Disclosure className="plv-log" label={failed ? t("plan.log.unknown") : parts.join(" · ")}>
      {decisions.length > 0 ? (
        <section className="plv-log-sec" aria-label={t("plan.log.decisions")}>
          <h3>{t("plan.log.decisions")}</h3>
          <ul className="plv-decisions">
            {decisions.map((d) => (
              <li key={d.decision_id}>
                <b>{d.title}</b>
                {d.body ? <p>{d.body}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className="plv-log-list" aria-label={t("plan.log.listAria")}>
          {newest.map((r, i) => (
              <li key={`${r.ts}-${r.item_id}-${i}`} className="plv-log-row">
                <span className="plv-log-r1">
                  {r.to_status ? <StatusMark status={r.to_status} /> : null}
                  {r.from_status || r.to_status ? (
                    <span className="plv-log-move">
                      {r.from_status ? `${statusName(r.from_status)} → ` : ""}
                      {statusName(r.to_status)}
                    </span>
                  ) : null}
                  <span className="plv-log-title" title={`#${r.item_id}`}>
                    {titleOf(r.item_id)}
                  </span>
                </span>
                <span className="plv-log-r2">
                  <span className="plv-time">{stamp(r.ts)}</span>
                  <span>{agentLabel(r.agent_id)}</span>
                  {r.note ? <span className="plv-log-note">{r.note}</span> : null}
                </span>
              </li>
            ))}
          {hidden > 0 ? (
            <li className="plv-log-more">
              <button type="button" className="btn sm" onClick={() => setLimit((n) => n + LOG_LIMIT)}>
                {t("plan.log.more", { n: Math.min(LOG_LIMIT, hidden) })}
              </button>
            </li>
          ) : null}
        </ul>
      ) : rows ? (
        <p className="plv-log-empty">{t("plan.log.empty")}</p>
      ) : null}
    </Disclosure>
  );
}
