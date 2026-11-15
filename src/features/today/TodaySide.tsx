/**
 * 오늘 화면의 곁 — 날짜 줄의 수 한 줄 · 지금 일하는 중 · 첫 기록까지 세 걸음.
 *
 * 셋 다 「지금 무엇을 결정할까」의 곁가지다: 계획에 남은 내 몫과 닫을 계획, 다른 기기와 주고받은 것은 날마다
 * 바뀌는 예외가 아니라 날짜 줄 오른쪽의 **수**로만 선다(영수증 규칙 5). 예전엔 이것들이 「먼저 볼 것」 밖에
 * 한 줄씩 넷까지 쌓여 가운뎃점과 괄호가 겹친 요약문처럼 읽혔다(11-15). 누가 돌고 있는지(멈췄나)는 카드
 * 하나, 기록이 하나도 없는 프로젝트는 첫 기록까지의 세 걸음 카드 하나다.
 */

import type { ReactNode } from "react";

import { NotebookText, SquareTerminal } from "@/components/Icons";
import type { TermInfo } from "@/api/terminal";
import { agentLabel } from "@/features/today/agentColor";
import { useT, type I18nKey } from "@/i18n";
import { relativeTime } from "@/lib/format";
import type { Arrived, DigestPlan, LocalOnly } from "@/lib/bindings";
import type { TodaySplit } from "./todayModel";
import { Num } from "./todayFormat";
import type { LiveSession } from "./useLiveSessions";
import { QUIET_MINUTES } from "./useLiveSessions";

/**
 * 「지금 일하는 중」 이 조용해졌을 때 보낼 터미널 세션 — 이 창에서 무언가 돌고 있는 세션이 **하나**일 때만.
 * 작업 세션(워처)과 터미널 세션은 이어져 있지 않다: 에이전트가 바깥 터미널에서 돌고 앱 안에는 빈 셸만 있거나,
 * 돌고 있는 세션이 둘이면 어느 것이 그 에이전트인지 모른다 — 엉뚱한 곳을 보여 주느니 단추를 세우지 않는다.
 */
export function liveTerm(terms: readonly TermInfo[]): TermInfo | null {
  const running = terms.filter((x) => x.alive && x.busy);
  return running.length === 1 ? running[0] : null;
}

export function LiveCard({
  sessions,
  now,
  term,
  onShowTerminal,
}: {
  sessions: LiveSession[];
  now: number;
  /** 이 창의 터미널 세션 — 없으면 「터미널에서 보기」 를 세우지 않는다(바깥 터미널에서 도는 에이전트다). */
  term: TermInfo | null;
  onShowTerminal: (id: number) => void;
}) {
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
              {/* 평소에는 회색 점 — 돌고 있는 것은 예외가 아니다(영수증 규칙 1). 조용해졌을 때만 호박색. */}
              <span className={"tdy-dot tdy-sess-dot" + (quiet ? " is-quiet" : "")} aria-hidden="true" />
              <div className="tdy-grow">
                <div>
                  {s.agentId ? agentLabel(s.agentId) : t("today.live.unknownAgent")}
                  {s.conversations > 1 ? (
                    <span className="tdy-meta"> · {t("today.live.conversations", { n: s.conversations })}</span>
                  ) : null}
                </div>
                {quiet ? (
                  // 묻지 않고 사실만 — 「멈췄는지 볼까요?」 는 볼 곳을 주지 않았다. 볼 곳은 그 터미널이다.
                  <div className="tdy-meta tdy-quiet">
                    <span className="tdy-warn">
                      {quietMin >= 60 ? t("today.live.quietHours", { n: Math.floor(quietMin / 60) }) : t("today.live.quiet", { n: quietMin })}
                    </span>
                    {term ? (
                      <button type="button" className="text-link" onClick={() => onShowTerminal(term.id)}>
                        {t("today.check.openTerminal")}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="tdy-meta">
                    {s.lastRecordAt != null
                      ? t("today.live.last", { ago: relativeTime(s.lastRecordAt, now) })
                      : t("today.live.noneYet", { ago: relativeTime(s.startedAt, now) })}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 하루 — 「올리거나 받아 온 지 N일」 은 이만큼 지나야 말한다. 어제 저녁에 올리고 오늘 아침에 여는 것은 조용하다. */
const DAY_MS = 86_400_000;

/** 수 하나 — 누르면 그 수가 가리키는 곳으로. 뜻 전체(문장)는 툴팁이 말한다. */
function NumLink({ k, n, title, onClick }: { k: I18nKey; n: number; title: string; onClick: () => void }) {
  return (
    <button type="button" className="tdy-num" title={title} onClick={onClick}>
      <Num k={k} n={n} />
    </button>
  );
}

/**
 * 날짜 줄 오른쪽의 수 한 줄 (11-15) — 「내 차례 3 · 닫을 계획 1 · 받아 온 일지 2 · 이 기기에만 4」.
 *
 * 0 인 수는 그리지 않는다. 「이 기기에만」 은 다른 기기에 없는 일지 · 계획 파일 수다 — 커밋 안 한 것과, 커밋했지만
 * 안 올린 커밋에 든 것(백엔드가 겹치는 파일은 한 번만 센다). 기록은 없고 안 올린 커밋만 있으면 그 커밋 수를
 * 「안 올린 커밋 N」 으로 말한다. 커밋 안 한 **코드만** 있을 때는 서지 않는다 — 일하는 내내 있어 그것까지 세면
 * 이 수가 하루 종일 섰다. 안 올린 것은 다른 기기의 Claude 에게 없는 일이라 「올리기 맡기기」 를 둔다(앱 안
 * 터미널의 Claude 에게 맡긴다 — 앱은 git 을 읽기만 한다). 그 동작은 수 줄 **밖**의 보통 단추다(11-15 V-01): 줄의
 * 수는 누르면 화면을 옮기고 이것만 터미널 세션을 열어 claude 를 돌리는데, 숫자 뒤에 구분 없이 같은 글자 모양으로
 * 붙어 「이 기기에만 4 올리기 맡기기」 한 문장처럼 읽혔다. 터미널 아이콘이 「실행」 임을 말한다.
 * 받아 온 일지가 없으면 주고받은 지 하루가 넘었을 때만 그 날수를 말한다(다른 곳의 기록을 받은 적이 없는
 * 저장소에는 말하지 않는다 — `synced_at` 이 없다).
 */
export function TodayNumbers({
  mine,
  plans,
  arrived,
  local,
  now,
  onOpenPlan,
  onOpenEntry,
  onOpenDiff,
  onHandOff,
  opening,
}: {
  mine: TodaySplit["mine"];
  plans: readonly DigestPlan[];
  arrived: Arrived | null;
  local: LocalOnly | null;
  now: number;
  onOpenPlan: (planId: string) => void;
  onOpenEntry: (relativePath: string) => void;
  onOpenDiff: () => void;
  onHandOff: () => void;
  /** 올리기를 맡길 터미널을 여는 중 — 두 번 누르면 두 세션이 뜨지 않게. */
  opening: boolean;
}) {
  const { t } = useT();
  const items: ReactNode[] = [];
  let handoff: ReactNode = null;
  const mineN = mine.reduce((sum, m) => sum + m.items.length, 0);
  if (mineN > 0) {
    items.push(
      <NumLink key="mine" k="today.nums.mine" n={mineN} title={t("today.mine.line", { p: mine.length, n: mineN })} onClick={() => onOpenPlan(mine[0].planId)} />,
    );
  }
  const closable = plans.filter((p) => p.closable);
  if (closable.length > 0) {
    items.push(
      <NumLink key="closable" k="today.nums.closable" n={closable.length} title={t("today.closable.hint")} onClick={() => onOpenPlan(closable[0].plan_id)} />,
    );
  }
  if (arrived && arrived.journals.length > 0) {
    items.push(
      <NumLink
        key="arrived"
        k="today.nums.arrived"
        n={arrived.journals.length}
        title={[t("today.arrived.line", { n: arrived.journals.length }), t("today.arrived.hint")].join(" ")}
        onClick={() => onOpenEntry(arrived.journals[0])}
      />,
    );
  } else if (arrived?.synced_at != null) {
    const days = Math.floor((now - arrived.synced_at * 1000) / DAY_MS);
    if (days >= 1) {
      items.push(
        <span key="synced" className="tdy-num-text" title={t("today.arrived.staleHint")}>
          <Num k="today.arrived.stale" n={days} />
        </span>,
      );
    }
  }
  const here = local ? local.records + local.unpushed_records : 0;
  if (local && (here > 0 || local.unpushed > 0)) {
    const detail: string[] = [];
    if (local.uncommitted > 0) detail.push(t("today.local.files", { n: local.uncommitted, r: local.records }));
    if (local.unpushed > 0) {
      detail.push(
        local.unpushed_records > 0
          ? t("today.local.unpushedRecords", { n: local.unpushed, r: local.unpushed_records })
          : t("today.local.unpushed", { n: local.unpushed }),
      );
    }
    items.push(
      <NumLink
        key="local"
        k={here > 0 ? "today.nums.local" : "today.local.unpushed"}
        n={here > 0 ? here : local.unpushed}
        title={[detail.join(" · "), t("today.local.hint")].join(" ")}
        onClick={onOpenDiff}
      />,
    );
    handoff = (
      <button type="button" className="btn sm tdy-handoff" title={t("today.local.handoffHint")} disabled={opening} onClick={onHandOff}>
        <SquareTerminal size={13} aria-hidden="true" />
        {opening ? t("today.busy.opening") : t("today.local.handoff")}
      </button>
    );
  }
  if (items.length === 0) return null;
  return (
    <>
      <div className="tdy-nums" role="group" aria-label={t("today.nums.aria")}>
        {items.flatMap((item, i) => (i === 0 ? [item] : [<span key={`sep${i}`} className="tdy-num-sep" aria-hidden="true">·</span>, item]))}
      </div>
      {handoff}
    </>
  );
}

interface Step {
  id: string;
  title: string;
  body: string;
  done: boolean;
  action?: { label: string; run: () => void; busy?: boolean };
}

/**
 * 첫 기록까지 세 걸음 (11-15) — 일지가 하나도 없는 프로젝트. 바쁜 날과 같은 틀(날짜 줄 · 두 칸) 안의 카드 하나라
 * 덜 만든 화면처럼 보이지 않는다. 끝난 걸음은 회색 ✓, 다음 걸음만 채운 단추를 갖는다(영수증 규칙 3) — 셋째
 * (첫 일지)는 에이전트가 일을 마치면 저절로 끝나는 걸음이라 단추가 없다.
 */
export function FirstSteps({
  connected,
  working,
  onConnect,
  onHandOff,
  opening,
}: {
  /** 에이전트가 이 프로젝트에 붙었다(플러그인이 깔렸거나 이미 무언가 일하는 중). */
  connected: boolean;
  /** 오늘 열린 작업 세션이 있다 — 첫 작업이 이미 넘어갔다. */
  working: boolean;
  onConnect: () => void;
  onHandOff: () => void;
  /** 첫 작업을 맡길 터미널을 여는 중. */
  opening: boolean;
}) {
  const { t } = useT();
  const steps: Step[] = [
    { id: "connect", title: t("today.first.step1"), body: t("today.first.step1Body"), done: connected, action: { label: t("today.first.connect"), run: onConnect } },
    {
      id: "task",
      title: t("today.first.step2"),
      body: t("today.first.step2Body"),
      done: working,
      action: { label: opening ? t("today.busy.opening") : t("today.first.step2Run"), run: onHandOff, busy: opening },
    },
    { id: "journal", title: t("today.first.step3"), body: t("today.first.step3Body"), done: false },
  ];
  const nextAt = steps.findIndex((s) => !s.done);
  return (
    <section className="card tdy-card tdy-first" aria-labelledby="tdy-first-h">
      <header className="tdy-ch">
        <NotebookText size={15} className="tdy-first-ico" aria-hidden="true" />
        <h2 id="tdy-first-h">{t("today.first.title")}</h2>
        <span className="tdy-meta">{t("today.first.body")}</span>
      </header>
      <ol className="tdy-steps">
        {steps.map((s, i) => (
          <li key={s.id} className="tdy-step" data-done={s.done ? "" : undefined}>
            <span className="tdy-step-mark" aria-hidden="true">
              {s.done ? "✓" : String(i + 1)}
            </span>
            <div className="tdy-grow">
              <div className="tdy-row-title">
                {s.title}
                {s.done ? <span className="tdy-sr"> · {t("today.first.done")}</span> : null}
              </div>
              <div className="tdy-meta">{s.body}</div>
            </div>
            {i === nextAt && s.action ? (
              <button type="button" className="btn primary sm" disabled={s.action.busy} onClick={s.action.run}>
                {s.action.label}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
