/**
 * 계획 한 장 — 메타 한 줄 · 문서 제목 · 완료 조건/확인 명령/마지막 결과 · 다음 · 단계 격자 ·
 * 계획 기록 (시안 Plan).
 *
 * 판정 카드가 제목 바로 아래에 있는 이유: 「항목이 다 닫혔다」와 「완료 조건이 참이다」는
 * 다른 주장이고, 둘째를 말하는 것은 에이전트가 아니라 확인 명령의 결과 끝 줄이다.
 *
 * 판정은 오늘 화면과 같은 네 모습이다(11-15, `verdictStateOf`): 통과 · 실패 · 통과 뒤 바뀜 · 여기선 아직.
 * 계획 화면만 앞의 둘을 알아, 오늘이 호박색 ✓ 로 짚는 계획을 회색 통과로 그렸다.
 *
 * 확인 명령 아래 「셸에서 돌리기」(11-15 사용자 결정, X-02) — 묻는 창은 `PlannerScreenV2` 가 띄운다
 * (`CheckRunDialog` 머리말).
 */

import { useId, useState } from "react";

import { SquareTerminal } from "@/components/Icons";
import { SubText, VerdictLine } from "@/components/VerdictLine";
import { agentLabel } from "@/features/today/agentColor";
import { osLabel } from "@/features/today/todayModel";
import { useOpenInEditor } from "@/features/shell/useOpenInEditor";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { blocked } from "@/lib/blocked";
import { relativeTime } from "@/lib/format";
import { whenLabel } from "@/lib/whenLabel";
import { getLang, useT } from "@/i18n";
import type { PlanDetail, PlanItemDto } from "@/lib/bindings";
import { PlanItems } from "./PlanItems";
import { PlanLog } from "./PlanLog";
import { hasOpenLeaves, lastLogAt, nextLeaf, stripUserTag } from "./planMeta";
import { checkLines, verdictStateOf, verdictSub } from "./verdictState";
import { blockedReason, prepareCheck, revealHidden } from "@/features/terminal/runCheck";
import { requestSendToClaude } from "@/features/terminal/sendToClaude";

function dateOf(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat(getLang(), { month: "long", day: "numeric" }).format(new Date(ms));
}

/** 읽지 못한 줄 — warn 칩 하나, 누르면 줄 목록과 파일로 여는 길 (일지 상세의 파싱 경고와 같은 꼴). */
function WarnLines({ warnings, filePath }: { warnings: string[]; filePath: string }) {
  const { t } = useT();
  const { state } = useWorkspace();
  const editor = useOpenInEditor(state.currentProjectRoot);
  const [open, setOpen] = useState(false);
  return (
    <div className="plv-warn">
      <button type="button" className="chip sm warn plv-warn-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("plan.warnLines", { n: warnings.length })}
      </button>
      {open ? (
        <div className="plv-warn-list">
          <ul>
            {warnings.map((w, i) => (
              <li key={`${i}-${w}`}>{w}</li>
            ))}
          </ul>
          <button type="button" className="btn sm" onClick={() => editor.open(filePath)}>
            {t("plan.openFile")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 확인 명령 아래 「셸에서 돌리기」 — 보통 단추(채운 단추는 「다음」 하나, 영수증 규칙 3). 누르면 거른 한 줄을 넘기고
 * 부른 쪽이 묻는다. 여러 줄 · 보이지 않는 글자 · 백틱이면 단추를 막고(`blocked` — 포커스는 남아 이유가 읽힌다)
 * 이유를 옆에 문장으로 둔다(`runCheck.blockedReason`). 거르고 나니 돌릴 글자가 없으면 단추가 없다.
 */
function CheckRunRow({ check, onRun }: { check: string; onRun: (line: string) => void }) {
  const { t } = useT();
  const reasonId = useId();
  const prep = prepareCheck(check);
  if (prep.kind === "empty") return null;
  const reason = blockedReason(t, prep);
  return (
    <div className="plv-check-run">
      <button
        type="button"
        className="btn sm"
        {...blocked(reason)}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => {
          if (prep.kind === "ok") onRun(prep.line);
        }}
      >
        <SquareTerminal size={13} aria-hidden="true" />
        {t("plan.check.run")}
      </button>
      {reason ? (
        <span id={reasonId} className="plv-meta">
          {reason}
        </span>
      ) : null}
    </div>
  );
}

function JudgeCard({ detail, onRunCheck }: { detail: PlanDetail; onRunCheck: (line: string) => void }) {
  const { t } = useT();
  const v = detail.plan.last_verdict;
  const state = verdictStateOf(detail.plan);
  // 한 칸에 한 상태 (화면 검사 {#plan-verdict}) — 명령이 없는데 결과가 있으면(명령 줄을 나중에 지운
  // 계획) 결과만 말하고, 명령도 결과도 없으면 「없어요」 한 번만 말한다. 「확인 명령이 없어요」 옆에
  // 「✗ 실패」 가, 또는 「아직 안 돌렸어요」 가 같이 서던 것을 걷는다.
  const showCheck = detail.check != null || v == null;
  const showLast = v != null || detail.check != null;
  // 아래 줄은 오늘 행과 같은 문장이다(RC-17) — 바뀐 파일은 첫 파일(기계 글씨) + 「외 N」, 전부는 툴팁.
  const extra = verdictSub(state, detail.plan);
  const who = v ? agentLabel(v.agent_id) : "";
  return (
    <section className="plv-judge" aria-label={t("plan.judge.aria")}>
      <div>
        <h3 className="plv-sec-h">{t("plan.judge.doneWhen")}</h3>
        <p className={detail.done_when ? "plv-judge-text" : "plv-meta"}>{detail.done_when ?? t("plan.judge.noDoneWhen")}</p>
      </div>
      {showCheck ? (
        <div>
          <h3 className="plv-sec-h">{t("plan.judge.check")}</h3>
          {detail.check ? (
            <>
              {/* 보일 때만 && · ; 뒤에서 줄을 나눈다 — 복사하면 한 줄 원문으로 돌아간다. */}
              <code
                className="plv-code mono"
                onCopy={(e) => {
                  const text = window.getSelection()?.toString() ?? "";
                  if (!text.includes("\n")) return;
                  e.preventDefault();
                  e.clipboardData.setData("text/plain", text.replace(/\s*\n\s*/g, " "));
                }}
              >
                {checkLines(revealHidden(detail.check)).join("\n")}
              </code>
              <CheckRunRow check={detail.check} onRun={onRunCheck} />
            </>
          ) : (
            <p className="plv-meta">{t("plan.judge.noCheck")}</p>
          )}
        </div>
      ) : null}
      {showLast ? (
        <div className="plv-judge-last">
          <h3 className="plv-sec-h">{t("plan.judge.last")}</h3>
          {v && state ? (
            <VerdictLine
              state={state}
              summary={v.summary}
              when={whenLabel(v.ts)}
              sub={
                <>
                  {who}
                  {extra ? (
                    <>
                      {who ? " · " : null}
                      <SubText text={extra.text} mono={extra.mono} />
                    </>
                  ) : null}
                </>
              }
              subTitle={extra ? [who, extra.full].filter(Boolean).join(" · ") : undefined}
            />
          ) : (
            <p className="plv-meta">{t("plan.judge.notRun")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 항목이 다 닫혔을 때의 한 문장 (11-15 RC-02) — 바로 위 판정 카드가 말하는 상태와 같은 말이다. 「아직 통과하지
 * 않았어요」 는 실패 · 안 돌림에만: 통과 뒤 바뀜(호박 ✓) · 다른 기기 통과 · 명령 없는 계획에도 그 문장이 섰고,
 * 명령 없는 계획에는 없는 명령을 돌려 보라고 했다. 기록된 판정이 먼저다 — 확인 명령 줄을 나중에 지운 계획도 카드는
 * 「마지막 결과 ✗」 · 호박 ✓ 를 보이는데 「확인 명령이 없으니 닫아도 돼요」 가 섰다. 명령 없음은 판정도 없을 때만.
 */
function closedLine(detail: PlanDetail, t: ReturnType<typeof useT>["t"]): string {
  const state = verdictStateOf(detail.plan);
  if (state === "pass") return t("plan.nextRow.allClosedPassed");
  if (state === "stale") return t("plan.nextRow.allClosedStale");
  if (state === "away" && detail.plan.verdict_from) return t("plan.nextRow.allClosedAway", { os: osLabel(detail.plan.verdict_from) });
  if (state == null && !detail.check) return t("plan.nextRow.allClosedNoCheck");
  return t("plan.nextRow.allClosed");
}

function NextRow({
  items,
  closed,
  busy,
  onRun,
  onRunUntilDone,
  onClose,
}: {
  items: PlanItemDto[];
  /** 항목이 다 닫혔을 때의 문장 — 판정 카드와 같은 상태를 말한다(`closedLine`). */
  closed: string;
  /** 다른 계획을 읽는 중 — 옛 문서의 항목을 새 계획으로 보내지 않게 단추를 막는다. */
  busy: boolean;
  onRun: (item: PlanItemDto) => void;
  onRunUntilDone: (item: PlanItemDto) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const next = nextLeaf(items);
  const open = hasOpenLeaves(items);
  return (
    <div className="plv-next">
      <b className="plv-next-label">{next || open ? t("plan.nextRow.label") : t("plan.nextRow.doneLabel")}</b>
      {next ? (
        <>
          {/* 제목은 줄을 바꿔 끝까지 — 항목 id 는 내부 이름이라 툴팁으로만 (화면 검사 #plan-head). */}
          <span className="plv-next-title" title={`#${next.item_id}`}>
            {next.title}
          </span>
          <span className="plv-grow" />
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => onRun(next)}>
            <SquareTerminal size={13} aria-hidden="true" />
            {t("plan.nextRow.run")}
          </button>
          <button type="button" className="btn sm" disabled={busy} title={t("plan.nextRow.untilDoneTitle")} onClick={() => onRunUntilDone(next)}>
            {t("plan.nextRow.untilDone")}
          </button>
        </>
      ) : open ? (
        <span className="plv-meta">{t("plan.nextRow.none")}</span>
      ) : (
        <>
          {/* 통과 전에도 닫을 수 있다(백엔드는 남은 항목만 본다) — 문장은 없는 관문을 약속하지 않고, 돌려 보라고만 한다. */}
          <span className="plv-meta">{closed}</span>
          {/* 닫기는 사람의 결정이다 — 남은 항목이 0 일 때만 선다. 닫지 않으면 「진행 중」 으로 쌓인다(11-14). */}
          {items.length > 0 ? (
            <>
              <span className="plv-grow" />
              <button type="button" className="btn sm" disabled={busy} title={t("plan.closeTitle")} onClick={onClose}>
                {t("plan.close")}
              </button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

export function PlanDoc({
  projectId,
  detail,
  locked,
  busy,
  onSetStatus,
  onRun,
  onRunUntilDone,
  onClose,
  onOpenJournal,
  onRunCheck,
}: {
  projectId: number;
  detail: PlanDetail;
  locked: boolean;
  /** 고른 계획과 이 문서가 다르다(다른 계획을 읽는 중) — 동작 단추를 막는다. */
  busy: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onRun: (item: PlanItemDto) => void;
  onRunUntilDone: (item: PlanItemDto) => void;
  /** 이 계획을 닫는다 — 남은 항목이 0 일 때만 단추가 선다. */
  onClose: () => void;
  onOpenJournal: (ref: string) => void;
  /** 확인 명령의 「셸에서 돌리기」 — 거른 한 줄. 묻는 창은 부른 쪽이 띄운다. */
  onRunCheck: (line: string) => void;
}) {
  const { t } = useT();
  const p = detail.plan;
  const last = lastLogAt(detail.items);
  // 메타 — 만든 날과 마지막 기록을 따로 말한다. 날짜 하나만 서 있으면(만든 날) 최근 활동처럼 읽혔다.
  // 날짜는 frontmatter `updated` 다: 만들 때 쓰이고 닫기 · 되돌리기가 그날로 다시 쓴다(planner/lifecycle.rs) —
  // 닫힌 계획에서는 닫은 날이라 그렇게 부른다.
  const meta = [
    t(locked ? "plan.doc.closedOn" : "plan.doc.created", { date: dateOf(p.updated_at) }),
    last ? t("plan.doc.lastLog", { ago: relativeTime(last, Date.now()) }) : null,
    agentLabel(p.owner_agent),
    locked ? t("plan.doc.locked") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="plv-doc">
      <header className="plv-head">
        <div className="plv-meta">{meta}</div>
        <h2 className="plv-title">{p.title}</h2>
      </header>
      {detail.warnings.length > 0 ? <WarnLines warnings={detail.warnings} filePath={p.file_path} /> : null}
      <JudgeCard detail={detail} onRunCheck={onRunCheck} />
      {locked ? null : (
        <NextRow
          items={detail.items}
          closed={closedLine(detail, t)}
          busy={busy}
          onRun={onRun}
          onRunUntilDone={onRunUntilDone}
          onClose={onClose}
        />
      )}
      <PlanItems
        key={p.plan_id}
        items={detail.items}
        locked={locked || busy}
        onSetStatus={onSetStatus}
        onOpenJournal={onOpenJournal}
        onSend={(item) =>
          requestSendToClaude({
            kind: "plan",
            label: stripUserTag(item.title),
            ref: `.oculpm/planner/${p.plan_id}.md #${item.item_id}`,
            note: item.status === "blocked" ? t("plan.status.blocked") : undefined,
          })
        }
      />
      <PlanLog
        key={`log-${p.plan_id}`}
        projectId={projectId}
        planId={p.plan_id}
        revision={detail.items.map((i) => i.status).join("")}
        decisions={detail.decisions}
        items={detail.items}
      />
    </article>
  );
}
