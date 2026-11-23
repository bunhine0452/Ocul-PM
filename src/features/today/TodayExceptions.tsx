/**
 * 오늘 화면의 예외 칸 둘 (4.0 `{#ui-today}` → 화면 검사 `{#today-split}` → 11-15 한 기둥).
 *
 * 「먼저 볼 것」 은 지금 손댈 것만 심각도 순으로(`todayModel.EXCEPTION_ORDER`) 세우고, 그 목록의 마지막 행이
 * 「다음」 이다(배지에는 안 센다). 모든 행이 같은 칩 칸(subgrid)에서 시작해 제목선이 하나다 — 예전엔 「다음」 이
 * 따로 카드라 왼쪽 기둥에 제목 시작선이 둘이었다. 검증 없이 끝난 일지는 그 아래 한 묶음(`UNREAD_LIMIT` 행 +
 * 「N건 더」).
 *
 * 행은 화면이 가진 한 목록의 순서를 따라 j/k 로 잇고(`RowNav`), 행의 동작은 화면이 준다(`RowAction`) — 첫 동작이
 * 그 행의 기본 동작이고 Enter 가 누르는 것도 그것이다. 비었으면 차분한 한 문단: 무엇을 봤고 무엇이 없었는지를
 * 말하되, 못 본 것(일지 없는 변경을 못 읽음)은 없다고 말하지 않는다.
 *
 * 글자 굵기는 세 단이다(11-15): 카드 머리 600 · 행 제목 550 · 메타 400. 기계 글씨(확인 명령 · 경로 · 시각)만
 * 고정폭이다(영수증 규칙 2).
 */

import { useState, type ReactNode } from "react";

import { Check, SquareTerminal } from "@/components/Icons";
import { StaleNote } from "@/components/StaleNote";
import { SubText, VerdictLine } from "@/components/VerdictLine";
import { SkeletonList } from "@/components/ui/Skeleton";
import { agentLabel } from "@/features/today/agentColor";
import { useT, type I18nKey } from "@/i18n";
import type { DigestItem, DigestPlan, JournalEntrySummary } from "@/lib/bindings";
import { stripUserTag } from "@/features/planner/planMeta";
import { verdictSub } from "@/features/planner/verdictState";
import { sessionWord } from "@/features/terminal/status";
import { CLAUDE_PLUGIN_UPDATE } from "@/lib/agentCommands";
import { blocked } from "@/lib/blocked";
import { whenLabel } from "@/lib/whenLabel";
import { osLabel, type ExceptionKind, type TodayException, type TodaySplit } from "./todayModel";

type ChipKind = Exclude<ExceptionKind, "evidence" | "decision">;

/**
 * 상태 칩 — 상태 이름 한 낱말(공백 빼고 4자 이하). 좁은 창에서 제목 칸이 칩 폭에 가장 먼저 짓눌렸다.
 * 일지 없는 변경과 일지 없이 끝난 대화는 같은 상태(일지 없음)라 같은 칩이다(영수증 규칙 4) — 무엇이 없는지는
 * 행 제목이 말한다. 검증 없는 일지(묶음)와 내 차례(날짜 줄의 수)는 칩을 갖지 않는다.
 */
const PILL: Record<ChipKind, { key: I18nKey; tone: string }> = {
  question: { key: "today.chip.question", tone: "warn" },
  waiting: { key: "today.check.kind.waiting", tone: "warn" },
  hookWaiting: { key: "today.check.kind.waiting", tone: "warn" },
  verdict: { key: "today.check.kind.verdict", tone: "danger" },
  stale: { key: "today.check.kind.stale", tone: "warn" },
  elsewhere: { key: "today.check.kind.elsewhere", tone: "warn" },
  autoBlocked: { key: "today.check.kind.autoBlocked", tone: "warn" },
  unrecorded: { key: "today.chip.noJournal", tone: "warn" },
  silent: { key: "today.chip.noJournal", tone: "warn" },
  blocked: { key: "today.check.kind.blocked", tone: "danger" },
  plugin: { key: "today.check.kind.plugin", tone: "" },
};

/** 행 하나가 키보드 목록에서 차지하는 자리 — 화면(`TodayScreenV2`)이 순서를 쥔다. */
export interface RowNav {
  index: number;
  /** 지금 행 — j/k 가 여기서 이어진다. 옅게 표시한다. */
  active: boolean;
  /** 로빙 탭 — 목록에서 하나만 0 이다. */
  tabIndex: 0 | -1;
  rowRef: (el: HTMLLIElement | null) => void;
}

/** 행의 동작 하나. 첫 동작(막히지 않은 것)이 그 행의 기본 동작이다. */
export interface RowAction {
  id: string;
  label: string;
  run: () => void;
  /** 못 누르는 이유 — 있으면 단추는 살아 있되 누르지 않는다(`blocked`). */
  reason?: string | null;
  /** 진행 중 — 두 번 누르면 두 번 돌지 않게. */
  busy?: boolean;
  /** 진행 중에 단추가 하는 말(「여는 중」). */
  busyLabel?: string;
}

function mono(text: string): ReactNode {
  return <span className="mono">{text}</span>;
}

/** 번역된 문장 안의 기계 글씨 조각(경로 · 시각 · 판 번호)만 고정폭으로, 나온 차례대로 — 사전에는 JSX 를 넣지 않는다. */
function monoPart(full: string, ...parts: string[]): ReactNode {
  const out: ReactNode[] = [];
  let rest = full;
  for (const part of parts) {
    const at = part ? rest.indexOf(part) : -1;
    if (at < 0) continue;
    out.push(
      rest.slice(0, at),
      <span key={out.length} className="mono">
        {part}
      </span>,
    );
    rest = rest.slice(at + part.length);
  }
  if (out.length === 0) return full;
  out.push(rest);
  return <>{out}</>;
}

/** 메타 한 줄 — 빈 조각은 빼고 「 · 」 로 잇는다. */
function metaLine(parts: Array<ReactNode | null | false | "">): ReactNode {
  const kept = parts.filter((p) => p != null && p !== false && p !== "");
  return kept.map((p, i) => (
    <span key={i}>
      {i > 0 ? " · " : null}
      {p}
    </span>
  ));
}

function shortId(id: string): string {
  return id.length > 9 ? `${id.slice(0, 8)}…` : id;
}

interface RowText {
  title: string;
  /** 제목을 그릴 때 — 기계 글씨 조각만 고정폭으로. 없으면 `title` 그대로. */
  titleNode?: ReactNode;
  meta: ReactNode;
  /** 잘린 메타의 전문 — 툴팁. */
  metaTitle?: string;
}

/** 메타 조각들의 글자 — 한 줄로 잘리는 메타의 툴팁(전문). */
function metaText(parts: Array<string | null | false | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}

function useRowText(ex: TodayException): RowText {
  const { t } = useT();
  switch (ex.kind) {
    case "question":
      return { title: ex.item.question, meta: mono(whenLabel(ex.item.asked_at)) };
    case "waiting": {
      // 프로그램이 붙인 한 줄(「approve Write: …」)이 곧 무엇을 기다리는지다 — 없으면 상태 말.
      const s = ex.session;
      const word = sessionWord(t, s);
      const when = s.status ? whenLabel(s.status.since) : "";
      const msgWord = s.status?.msg ? word : "";
      return {
        title: s.status?.msg || word,
        meta: metaLine([s.label, msgWord, when && mono(when)]),
        metaTitle: metaText([s.label, msgWord, when]),
      };
    }
    case "hookWaiting": {
      // 바깥 터미널 — 앱 안에서 갈 곳이 없으니 무엇을 기다리는지와 언제부터인지만.
      const w = ex.item;
      const word = w.kind === "permission" ? t("terminal.state.permission") : t("terminal.state.idle");
      const when = whenLabel(w.since);
      const msgWord = w.message ? word : "";
      return {
        title: w.message || word,
        meta: metaLine([t("today.check.outsideTerminal"), msgWord, mono(when)]),
        metaTitle: metaText([t("today.check.outsideTerminal"), msgWord, when]),
      };
    }
    case "verdict":
      return { title: t("today.check.verdictTitle", { plan: ex.plan.title }), meta: null };
    case "stale":
      return { title: t("today.check.staleTitle", { plan: ex.plan.title }), meta: null };
    case "elsewhere":
      return { title: t("today.check.elsewhereTitle", { plan: ex.plan.title, os: osLabel(ex.os) }), meta: null };
    case "evidence":
      return { title: ex.entry.title, meta: null };
    case "autoBlocked": {
      // 가장 최근에 막힌 것 — 도구 이름은 본문 서체, 그 도구가 하려던 것(명령 첫 줄 · 경로 · 주소)만 고정폭이다
      // (영수증 규칙 2: 기계 글씨만 고정폭). 둘을 붙여 그리면 「Bash git push …」 가 명령 한 줄처럼 읽혔다.
      // 하려던 것을 모르는 도구(MCP)는 이름이 곧 기계 글씨다. 나머지는 수로, 전문은 툴팁으로.
      const [first, ...rest] = ex.items;
      const machine = first.what || first.tool;
      const shown = rest.length > 0 ? t("today.check.autoBlockedMore", { first: machine, n: rest.length }) : machine;
      const when = whenLabel(first.at);
      return {
        title: t("today.check.autoBlockedTitle", { n: ex.items.length }),
        meta: metaLine([first.what ? first.tool : null, monoPart(shown, machine), mono(when)]),
        metaTitle: ex.items.map((b) => metaText([b.tool, b.what, b.reason, whenLabel(b.at)])).join("\n"),
      };
    }
    case "unrecorded": {
      const [first, ...rest] = ex.files;
      const files = rest.length > 0 ? t("today.check.moreFiles", { first, n: rest.length }) : first;
      return { title: t("today.check.unrecordedTitle", { n: ex.files.length }), meta: monoPart(files, first), metaTitle: ex.files.join("\n") };
    }
    case "silent": {
      // 대화 id(해시)는 사람이 읽을 것이 아니다 — 툴팁으로 내리고 줄에는 마지막 시각만.
      const last = ex.signals.reduce((a, b) => (b.ts > a.ts ? b : a));
      const time = whenLabel(last.ts);
      return {
        title: t("today.check.silentTitle", { n: ex.signals.length }),
        meta: monoPart(t("today.check.silentLast", { time }), time),
        metaTitle: t("today.check.silentMeta", { time, id: ex.signals.map((s) => shortId(s.session_id)).join(", ") }),
      };
    }
    case "blocked":
    case "decision": {
      const [first, ...rest] = ex.items;
      const title = stripUserTag(first.title);
      return {
        title: rest.length > 0 ? t("today.check.moreItems", { title, n: rest.length }) : title,
        meta: t("today.check.inPlan", { plan: ex.planTitle }),
        // 항목 id 는 계획 파일의 열쇠지 사람의 말이 아니다 — 툴팁으로.
        metaTitle: ex.items.map((it) => `#${it.item_id}`).join(" "),
      };
    }
    case "plugin": {
      // 판 번호는 기계 글씨다(영수증 규칙 2) — 문장은 본문 서체, 두 번호만 고정폭.
      // 플러그인이 앱보다 새 판이면(11-23 #plugin-ahead-of-app) 올릴 것은 앱이다 — 새 스킬 · 훅이 옛 앱의 기록
      // 도구를 부르고, 옛 도구는 모르는 칸을 조용히 버린다. 붙여 넣는 명령은 터미널에 넣는 셸 명령 한 모양이다.
      if (ex.ahead) {
        const title = t("today.pluginDrift.aheadTitle", { installed: ex.installed, bundled: ex.bundled });
        const meta = t("today.pluginDrift.aheadMeta");
        return { title, titleNode: monoPart(title, ex.bundled, ex.installed), meta, metaTitle: meta };
      }
      const title = t("today.pluginDrift.title", { installed: ex.installed, bundled: ex.bundled });
      const why = t("today.pluginDrift.behindMeta");
      return {
        title,
        titleNode: monoPart(title, ex.installed, ex.bundled),
        meta: metaLine([why, mono(CLAUDE_PLUGIN_UPDATE[0])]),
        metaTitle: `${why}\n${CLAUDE_PLUGIN_UPDATE[0]}`,
      };
    }
  }
}

/**
 * Claude 의 질문에 답하는 칸 (MCP ask_user) — 앱 안에서 Claude 의 말을 읽고 답하는 곳은 여기뿐이라 질문은
 * 잘리지 않고 다 보인다(편지처럼). 고를 답이 있으면 단추로, 직접 쓸 수도 있다. 답하면 기다리던 도구가 그 답을
 * Claude 에게 돌려준다(앱 안 · 바깥 터미널 모두). 「보내기」 는 보통 단추다 — 채운 단추는 화면에 하나(영수증
 * 규칙 3, 「터미널에서 실행」). 비어 있으면 단추 대신 ↩ 표시만 둔다. 쓴 답은 실제로 간 뒤에 비운다 — 못 보냈으면
 * 사람이 쓴 문장을 그대로 둬 처음부터 다시 쓰지 않게.
 */
function QuestionAnswer({
  ex,
  onAnswer,
  sentAt,
  sending,
}: {
  ex: Extract<TodayException, { kind: "question" }>;
  /** 답을 보낸다 — 갔으면 `true`. */
  onAnswer: (id: string, answer: string) => Promise<boolean>;
  /** 보낸 시각(`HH:MM`) — 보냈는데 질문이 아직 서 있으면 그 사실을 말한다. */
  sentAt?: string;
  sending: boolean;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const options = ex.item.options ?? [];
  const send = (answer: string, typedAnswer: boolean) => {
    const a = answer.trim();
    if (!a) return;
    void onAnswer(ex.item.id, a).then((ok) => {
      // 그사이 더 쓴 글은 지우지 않는다 — 보낸 그 글일 때만 비운다.
      if (ok && typedAnswer) setText((cur) => (cur.trim() === a ? "" : cur));
    });
  };
  const typed = text.trim() !== "";
  return (
    <div className="tdy-answer">
      {options.map((o) => (
        <button key={o} type="button" className="btn sm tdy-option" disabled={sending} onClick={() => send(o, false)}>
          {o}
        </button>
      ))}
      <span className="tdy-answer-field">
        <input
          className="tdy-answer-input"
          value={text}
          placeholder={options.length > 0 ? t("today.check.answerOther") : t("today.check.answerPlaceholder")}
          aria-label={t("today.check.answerPlaceholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(text, true);
            }
          }}
        />
        {typed ? null : (
          <span className="kbd tdy-answer-hint" title={t("today.check.sendHint")} aria-hidden="true">
            ↩
          </span>
        )}
      </span>
      {typed ? (
        <button type="button" className="btn sm" disabled={sending} onClick={() => send(text, true)}>
          {t("send.submit")}
        </button>
      ) : null}
      {sentAt ? (
        <span className="tdy-sent">
          {t("today.check.sent")} · {mono(sentAt)}
        </span>
      ) : null}
    </div>
  );
}

/** 판정 실패 · 통과 뒤 바뀜 · 여기선 아직 — 끝 줄을 앞에, 명령 · 계획(· 바뀐 파일 · 돌린 곳)을 아래 한 줄로. */
function VerdictRow({ ex }: { ex: Extract<TodayException, { kind: "verdict" | "stale" | "elsewhere" }> }) {
  const { t } = useT();
  const state = ex.kind === "stale" ? "stale" : ex.kind === "elsewhere" ? "away" : "fail";
  const parts: ReactNode[] = [];
  // 툴팁의 전문 — 바뀐 파일은 「외 N」 으로 줄이지 않고 다 적는다.
  const full: string[] = [];
  if (ex.plan.check) {
    parts.push(<code className="mono">{ex.plan.check}</code>);
    full.push(ex.plan.check);
  }
  const inPlan = t("today.check.inPlan", { plan: ex.plan.title });
  parts.push(inPlan);
  full.push(inPlan);
  // 바뀐 파일 · 돌린 곳은 계획 판정 카드와 같은 문장이다(`verdictSub`, RC-17).
  const sub = verdictSub(state, ex.plan);
  if (sub) {
    parts.push(<SubText text={sub.text} mono={sub.mono} />);
    full.push(sub.full);
  }
  return (
    <VerdictLine
      state={state}
      summary={ex.verdict.summary}
      when={whenLabel(ex.verdict.ts)}
      sub={metaLine(parts)}
      subTitle={full.join(" · ")}
      bare
    />
  );
}

/** 행의 동작 칸 — 동작이 둘이어도 한 칸이라 subgrid 의 셋째 칸이 행마다 같은 선에 선다. */
function RowActions({ actions }: { actions: RowAction[] }) {
  return (
    <div className="tdy-acts">
      {actions.map((a) => (
        <button key={a.id} type="button" className="btn sm" disabled={a.busy} {...blocked(a.reason)} onClick={a.run}>
          {a.busy && a.busyLabel ? a.busyLabel : a.label}
        </button>
      ))}
    </div>
  );
}

/** 행의 키보드 자리. 포커스가 행(또는 그 안의 단추)에 들면 「지금 행」 이 되는 것은 화면 루트가 맡는다. */
function rowProps(nav: RowNav) {
  return {
    ref: nav.rowRef,
    tabIndex: nav.tabIndex,
    "data-row": nav.index,
    "data-active": nav.active ? "" : undefined,
  };
}

function ExceptionRow({
  ex,
  nav,
  actions,
  onAnswer,
  sentAt,
  sending,
}: {
  ex: TodayException;
  nav: RowNav;
  actions: RowAction[];
  onAnswer: (id: string, answer: string) => Promise<boolean>;
  sentAt?: string;
  sending: boolean;
}) {
  const { t } = useT();
  const { title, titleNode, meta, metaTitle } = useRowText(ex);
  const pill = PILL[ex.kind as ChipKind];
  const isVerdict = ex.kind === "verdict" || ex.kind === "stale" || ex.kind === "elsewhere";
  const isQuestion = ex.kind === "question";
  return (
    <li {...rowProps(nav)} className="tdy-row" data-kind={ex.kind} aria-label={`${t(pill.key)}: ${title}`}>
      {/* 모든 행이 같은 첫 칸(상태 칩)에서 시작한다 — 판정 줄도 칩 옆에 선다(영수증 규칙 4, 11-04). */}
      <span className={"chip sm " + pill.tone}>{t(pill.key)}</span>
      <div className="tdy-row-t">
        {isVerdict ? (
          <VerdictRow ex={ex} />
        ) : (
          <>
            {/* 질문은 잘리지 않는다 — 그 밖의 제목은 한 줄로 자르고 전문은 툴팁. */}
            <div className={"tdy-row-title" + (isQuestion ? " tdy-wrap" : "")} title={isQuestion ? undefined : title}>
              {titleNode ?? title}
            </div>
            {meta ? (
              <div className="tdy-meta" title={metaTitle}>
                {meta}
              </div>
            ) : null}
            {ex.kind === "question" ? <QuestionAnswer ex={ex} onAnswer={onAnswer} sentAt={sentAt} sending={sending} /> : null}
          </>
        )}
      </div>
      {actions.length > 0 ? <RowActions actions={actions} /> : null}
    </li>
  );
}

/**
 * 「다음」 — 먼저 볼 것 목록의 마지막 행. 리드 칸은 머리카락 칩 「다음」(상태 이름, 예외가 아니다), 동작 칸은
 * 화면의 채운 단추 하나 「터미널에서 실행」(앱 안 터미널의 새 세션에서 `claude "<프롬프트>"`). 끝까지 맡기는
 * 법(`/oculpm:next until-done`)은 단추의 title 에.
 */
function NextRow({
  next,
  nav,
  onRun,
  running,
}: {
  next: { plan: DigestPlan; item: DigestItem };
  nav: RowNav;
  onRun: () => void;
  running: boolean;
}) {
  const { t } = useT();
  return (
    <li {...rowProps(nav)} className="tdy-row tdy-next" data-kind="next" aria-label={`${t("today.nextUp.title")}: ${next.item.title}`}>
      <span className="chip sm hairline">{t("today.nextUp.title")}</span>
      <div className="tdy-row-t">
        {/* 제목은 두 줄까지 — 한 줄로 자르면 항목이 무슨 일인지가 잘린 쪽에 있었다. */}
        <div className="tdy-row-title" title={next.item.title}>
          {next.item.title}
        </div>
        <div className="tdy-meta" title={next.plan.title}>
          {next.plan.title}
        </div>
      </div>
      <button
        type="button"
        className="btn primary sm"
        disabled={running}
        onClick={onRun}
        title={`${t("today.nextUp.hint")} /oculpm:next until-done`}
      >
        <SquareTerminal size={13} aria-hidden="true" />
        {running ? t("today.busy.opening") : t("today.nextUp.run")}
        <span className="kbd" aria-hidden="true">
          r
        </span>
      </button>
    </li>
  );
}

/**
 * 검증 없이 끝난 일지 한 행 — 시각 · 제목(누르면 그 일지) · 「읽음 표시」. 이유(검증에 명령이 없음 / 검증을 안 적음)는
 * 묶음 머리가 이미 말하니 툴팁으로 내리고, 읽은 뒤 바뀐 일지만 그 이유를 줄에 쓴다 — 다른 행과 이유가 다르다.
 * 「읽음 표시」 는 행이 여럿이면 행에 올라가야 보이고(묶음 머리에 「모두 읽음」 이 있다), 한 건이면 늘 보인다.
 *
 * 단추는 일지 상세의 검증 상자 · 변경 화면 바닥줄과 같은 동작이라 같은 모양 · 같은 이름이다(11-15 V-06) — 테 있는
 * 보통 단추 「읽음 표시」, ✓ 는 누른 뒤의 상태에만. 누르기 전부터 회색 ✓(통과 표지)를 단 테 없는 「✓ 읽음」 이
 * 검증 없는 일지 바로 옆에서 이미 확인된 것처럼 읽혔다. 키 표기 v 는 이 화면에서 v 가 정말 이 단추를 누르니 둔다.
 */
function UnreadRow({
  ex,
  nav,
  onOpen,
  onVerify,
  verifying,
  quiet,
  showAgent,
  teammate,
}: {
  ex: Extract<TodayException, { kind: "evidence" }>;
  nav: RowNav;
  onOpen: (entry: JournalEntrySummary) => void;
  onVerify: (entry: JournalEntrySummary) => void;
  verifying: boolean;
  quiet: boolean;
  showAgent: boolean;
  /** 동료가 더한 일지면 그 사람 — 내 에이전트의 일이 아니다. */
  teammate?: string;
}) {
  const { t } = useT();
  const e = ex.entry;
  const stale = e.verified_by_user && e.verified_stale;
  const why = stale ? t("today.check.evidenceStale") : e.evidence > 0 ? t("today.check.evidenceSection") : t("today.check.evidenceNone");
  const meta = [
    teammate ? t("today.check.teammate", { name: teammate }) : null,
    stale ? why : null,
    showAgent ? agentLabel(e.agent_id) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li {...rowProps(nav)} className="tdy-row tdy-unread" data-kind={ex.kind} aria-label={e.title} title={why}>
      <span className="tdy-time">{whenLabel(e.created_at)}</span>
      <div className="tdy-row-t">
        {/* 제목은 두 줄에서 잘린다 — 그 위에서는 행의 이유가 아니라 제목 전문이 툴팁이다(가까운 title 이 이긴다). */}
        <button type="button" className="tdy-row-title tdy-row-open" title={e.title} onClick={() => onOpen(e)}>
          {e.title}
        </button>
        {meta ? (
          <div className="tdy-meta" title={meta}>
            {meta}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={"btn sm" + (quiet ? " tdy-row-quiet" : "")}
        aria-label={t("today.check.verifyAria", { title: e.title })}
        disabled={verifying}
        onClick={() => onVerify(e)}
      >
        {t("entry.verify")}
        <span className="kbd" aria-hidden="true">
          v
        </span>
      </button>
    </li>
  );
}

interface TodayExceptionsProps {
  /** `null` = 아직 모름(읽는 중). */
  split: TodaySplit | null;
  /** 다음에 잡을 항목 — 있으면 목록의 마지막 행. */
  next: { plan: DigestPlan; item: DigestItem } | null;
  /** 오늘 일지 수 — 빈 문단의 재료. */
  entryCount: number;
  /** 일지 없는 변경을 읽었는가 — 못 읽었으면 「없어요」라고 말하지 않는다. */
  unrecordedKnown: boolean;
  /** 첫 기록 전 — 빈 문단은 세 걸음 카드가 대신 말한다. 행이 있을 때만 선다. */
  firstRun: boolean;
  /** 다시 읽다 실패했다 — 그때(ms) 읽은 값을 보여 주는 중. */
  staleSince: number | null;
  onRetry: () => void;
  navFor: (index: number) => RowNav;
  actionsFor: (ex: TodayException) => RowAction[];
  /** Claude 의 질문에 답한다 (MCP ask_user) — 갔으면 `true`. */
  onAnswer: (id: string, answer: string) => Promise<boolean>;
  /** 질문 id → 보낸 시각. */
  sent: Readonly<Record<string, string>>;
  /** 이 질문에 보낸 답이 아직 가는 중인가 — 그동안 답 단추를 잠근다. */
  isSending: (questionId: string) => boolean;
  isBusy: (id: string) => boolean;
  onRunNext: () => void;
}

/** 「먼저 볼 것」 — 예외 행 + 마지막의 「다음」. */
export function TodayExceptions({
  split,
  next,
  entryCount,
  unrecordedKnown,
  firstRun,
  staleSince,
  onRetry,
  navFor,
  actionsFor,
  onAnswer,
  sent,
  isSending,
  isBusy,
  onRunNext,
}: TodayExceptionsProps) {
  const { t } = useT();
  if (split == null) {
    // 뼈대는 이 프로젝트를 처음 읽을 때만 — 저장소가 앞 값을 들고 있으면 여기 오지 않는다.
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
  const empty = !firstRun && first.length === 0 && unread.length === 0;
  if (first.length === 0 && !next && !empty && staleSince == null) return null;
  return (
    <section className="card tdy-card" aria-labelledby="tdy-check-h">
      <header className="tdy-ch">
        <h2 id="tdy-check-h">{t("today.check.title")}</h2>
        {first.length > 0 ? <span className="tdy-cnt">{first.length}</span> : null}
        <span className="tdy-sp" />
        {staleSince != null ? <StaleNote since={staleSince} onRetry={onRetry} /> : null}
      </header>
      {empty ? (
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
      ) : null}
      {first.length > 0 || next ? (
        <ul className="tdy-rows is-ex" aria-label={t("today.check.title")}>
          {first.map((ex, i) => (
            <ExceptionRow
              key={ex.key}
              ex={ex}
              nav={navFor(i)}
              actions={actionsFor(ex)}
              onAnswer={onAnswer}
              sentAt={ex.kind === "question" ? sent[ex.item.id] : undefined}
              sending={ex.kind === "question" && isSending(ex.item.id)}
            />
          ))}
          {next ? <NextRow next={next} nav={navFor(first.length)} onRun={onRunNext} running={isBusy("next")} /> : null}
        </ul>
      ) : null}
    </section>
  );
}

interface TodayUnreadProps {
  split: TodaySplit | null;
  /** 지금 그리는 행 — 앞의 `UNREAD_LIMIT` 행. */
  shown: TodaySplit["unread"];
  /** 첫 행의 키보드 목록 자리. */
  offset: number;
  navFor: (index: number) => RowNav;
  /** 오늘 일지를 쓴 에이전트가 둘 이상인가 — 하나면 줄마다 이름을 쓰지 않는다. */
  showAgent: boolean;
  /** 동료가 git 으로 더한 일지 — 경로 → 그 사람. 그 줄에 이름을 쓴다. */
  teammates?: ReadonlyMap<string, string>;
  onOpen: (entry: JournalEntrySummary) => void;
  onVerify: (entry: JournalEntrySummary) => void;
  onVerifyAll: (entries: JournalEntrySummary[]) => void;
  /** 「N건 더」 — 일지 화면의 「검증 없는 것만」 으로 간다. */
  onMore: () => void;
  isBusy: (id: string) => boolean;
}

/**
 * 「검증 없이 끝난 일지」 — 먼저 볼 것 아래 한 묶음, `UNREAD_LIMIT` 행 + 「N건 더」. 나머지는 일지 화면의 「검증
 * 없는 것만」 이 보여 준다(이 화면에서 펼치면 오늘이 둘째 일지 목록이 됐다).
 */
export function TodayUnread({
  split,
  shown,
  offset,
  navFor,
  showAgent,
  teammates,
  onOpen,
  onVerify,
  onVerifyAll,
  onMore,
  isBusy,
}: TodayUnreadProps) {
  const { t } = useT();
  if (!split || split.unread.length === 0) return null;
  const { unread } = split;
  const single = unread.length === 1;
  const hidden = unread.length - shown.length;
  const verifying = isBusy("verifyAll");
  return (
    <section className="card tdy-card" aria-labelledby="tdy-unread-h">
      <header className="tdy-ch">
        <h2 id="tdy-unread-h">{t("today.unread.title")}</h2>
        <span className="tdy-cnt">{unread.length}</span>
        <span className="tdy-sp" />
        {/* 한 건이면 「모두 읽음」 은 그 행의 「읽음」 과 같은 말이다 — 행의 것만 늘 보이게 둔다.
            누르면 이 카드가 통째로 빠진다 — `data-land` 는 그때 포커스가 갈 자리(이 묶음의 첫 행 자리, 없으면 앞 행). */}
        {single ? null : (
          <button
            type="button"
            className="btn ghost sm"
            data-land={offset}
            disabled={verifying}
            onClick={() => onVerifyAll(unread.map((u) => u.entry))}
          >
            {t("today.unread.allRead")}
          </button>
        )}
      </header>
      <ul className="tdy-rows is-ex" aria-label={t("today.unread.title")}>
        {shown.map((ex, j) => (
          <UnreadRow
            key={ex.key}
            ex={ex}
            nav={navFor(offset + j)}
            onOpen={onOpen}
            onVerify={onVerify}
            verifying={isBusy(`verify:${ex.entry.relative_path}`)}
            quiet={!single}
            showAgent={showAgent}
            teammate={teammates?.get(ex.entry.relative_path)}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" className="tdy-more" onClick={onMore}>
          {t("today.unread.more", { n: hidden })}
        </button>
      ) : null}
    </section>
  );
}
