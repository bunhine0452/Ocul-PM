// 어휘 15낱말의 **얼굴과 몸통** (플랜 `v3-surface` `{#activity-presenters}`).
//
// `PRESENTERS` 는 `satisfies Record<ActivityKind, Presenter>` 다. 이 한 줄이
// 이 파일의 존재 이유다: 어휘가 자랄 때 **프레젠터를 빠뜨리는 것이 컴파일
// 에러**가 된다. 낱말만 늘고 그리는 법을 안 정하면, 화면에는 아이콘 없는 빈
// 줄이 조용히 늘어난다 — 늘 그렇게 썩는다.
//
// 얼굴(아이콘·이름)은 15벌, 몸통(Row)은 **6벌**을 나눠 쓴다. 도구 호출은
// 종류가 달라도 그리는 법이 같기 때문이다 — 무엇을 시켰고 무엇이 나왔나
// (`TraceRow`). 다르게 그려야 하는 것만 자기 몸통을 갖는다.

import type { ReactElement } from "react";
import {
  ArrowRight,
  Code2,
  ExternalLink,
  File as FileIcon,
  ListChecks,
  ListTodo,
  MessageSquareDashed,
  NotebookPen,
  Pencil,
  Search,
  ShieldAlert,
  Terminal,
  Trash2,
  TriangleAlert,
  Waypoints,
  type IconComponent,
} from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";
import { AlertTriangle } from "@/components/Icons";
import { TraceRow } from "../conversation/TraceRow";
import { oculpmVerbKey } from "./classify";
import type { ActivityKind } from "./activityTypes";
import { isOculpmKind } from "./activityTypes";
import type { BlockActivity, FailureBlock } from "./fromBlocks";
import { RawRail } from "./RawRail";

export interface ActivityRowProps {
  activity: BlockActivity;
}

export type ActivityRowComponent = (props: ActivityRowProps) => ReactElement | null;

export interface Presenter {
  /** 줄 앞 글리프. de-AI 어휘 — `components/Icons.tsx` 에 이미 있는 것만 쓴다. */
  Icon: IconComponent;
  /** 이 어휘의 이름 한 낱말. 줄 앞머리와 세션 카드가 함께 쓴다. */
  labelKey: I18nKey;
  /** 접힌 묶음의 요약 ("파일 12개 읽음"). 안 접히는 어휘는 일반 문구를 든다. */
  runKey: I18nKey;
  /** 이 어휘를 그리는 몸통. */
  Row: ActivityRowComponent;
}

// ── 몸통 6벌 ────────────────────────────────────────────────────────────────

/**
 * ① 도구 호출 — 기존 `TraceRow` 를 **그대로** 몸통으로 쓴다.
 *
 * 버리는 코드가 없다는 것이 이 라운드의 설계다: 경과 시간·IN/OUT 미리보기·
 * diff 통계·복사는 이미 그 안에서 다듬어져 있고, 여기서 바뀌는 것은 줄 앞머리의
 * **얼굴**뿐이다 (`oculpm journal_write` 가 「명령 실행」이 아니라 「일지 기록」).
 */
export function ToolActivity({ activity }: ActivityRowProps) {
  const { t } = useT();
  const present = PRESENTERS[activity.kind];
  if (!activity.call) return null;
  return (
    <TraceRow
      tool={activity.call}
      // 도구 이름("Bash")이 있으면 그대로 둔다 — 우리 어휘는 **글리프**로
      // 말하고, 이름 자리는 실제로 무엇이 돌았는지가 더 알차다.
      present={{ Icon: present.Icon, name: activity.call.name || t(present.labelKey) }}
      raw={activity.raw}
    />
  );
}

/**
 * ② 우리 원장 셋 — 같은 몸통에 **표식 하나**를 더한다.
 *
 * 이름은 도구 이름(`mcp__oculpm__journal_write`)이 아니라 우리 말이다.
 * 이 세 줄이 이 화면에서 유일하게 "이 제품이 무엇인가"를 말하는 자리라,
 * 훑을 때 눈에 걸려야 한다 (`.trace-item.ledger`).
 */
export function LedgerActivity({ activity }: ActivityRowProps) {
  const { t } = useT();
  const present = PRESENTERS[activity.kind];
  if (!activity.call) return null;
  const verbKey = activity.verb ? oculpmVerbKey(activity.verb) : null;
  return (
    <TraceRow
      tool={activity.call}
      present={{ Icon: present.Icon, name: t(verbKey ?? present.labelKey), tone: "ledger" }}
      raw={activity.raw}
    />
  );
}

/**
 * ③ 생각 — 도구 카드지만 **곁가지**다.
 *
 * 결과가 답이 아니라 과정이라, 같은 몸통을 쓰되 한 톤 물러나게 눌러 둔다
 * (`.trace-item.aside`). 레일 위에서 생각 점이 흐린 것과 같은 판단이다 —
 * 감싸는 상자를 두지 않은 것도 그 때문이다(레일의 점은 `.trace-item` 이 직접
 * 자식일 때만 찍힌다).
 */
export function ThinkActivity({ activity }: ActivityRowProps) {
  const { t } = useT();
  if (!activity.call) return null;
  return (
    <TraceRow
      tool={activity.call}
      present={{
        Icon: MessageSquareDashed,
        name: activity.call.name || t("activity.kind.think"),
        tone: "aside",
      }}
      raw={activity.raw}
    />
  );
}

/** 어휘는 아는데 몸통이 도구가 아닌 것들의 공통 한 줄 (④⑤가 쓴다). */
function NoticeLine({
  activity,
  Icon,
  tone,
}: ActivityRowProps & { Icon: IconComponent; tone: string }) {
  const { t } = useT();
  const present = PRESENTERS[activity.kind];
  return (
    <div className={"activity-notice " + tone}>
      <span className="activity-notice-head">
        <Icon size={13} />
        <span className="activity-notice-name">{t(present.labelKey)}</span>
        <span className="activity-notice-title">{activity.title}</span>
      </span>
      <RawRail raw={activity.raw} />
    </div>
  );
}

/**
 * ④ 할 일 목록. 턴에 하나뿐인 계획은 `TurnRow` 가 위에 따로 그리지만, 도구
 * 호출로 온 할 일 갱신(`TodoWrite`)은 **일어난 자리**에 서야 순서가 읽힌다.
 */
export function TodoActivity(props: ActivityRowProps) {
  if (props.activity.call) return <ToolActivity {...props} />;
  return <NoticeLine {...props} Icon={ListTodo} tone="todo" />;
}

/**
 * ⑤ 승인 대기. 열려 있는 요청 카드는 `PermissionCard` 가 스레드 끝에 그린다 —
 * 여기는 **지나간 요청이 기록으로 흐름에 남을 때**의 자리다.
 */
export function AttentionActivity(props: ActivityRowProps) {
  return <NoticeLine {...props} Icon={ShieldAlert} tone="attention" />;
}

/**
 * 세션에 일어난 일 — 한도 초과·인증 실패·모델 폴백.
 *
 * 어시스턴트가 쓴 글이 아니고 지나가는 배너도 아니다. **대화에 남는 기록**이라
 * (스펙의 표현 그대로) 일어난 자리에 그대로 둔다.
 *
 * (`conversation/TurnRow.tsx` 에서 옮겨 왔다 — 순수 이동. 그쪽에 두면
 * TurnRow ↔ presenters 가 서로를 임포트하는 고리가 된다.)
 */
export function FailureRow({ block }: { block: FailureBlock }) {
  const warning = block.severity === "warning";
  return (
    <div className={"failure" + (warning ? " warning" : "")} role="status">
      <span className="failure-icon">
        {warning ? <AlertTriangle size={13} /> : <TriangleAlert size={13} />}
      </span>
      <span className="failure-body">
        <span className="failure-title">{block.title}</span>
        {block.details ? <span className="failure-details">{block.details}</span> : null}
      </span>
    </div>
  );
}

/** ⑥ 실패 — 대화에 남는 기록이라 **자리가 정보**다. 원본 레일이 아래 붙는다. */
export function FailureActivity({ activity }: ActivityRowProps) {
  if (!activity.failure) return null;
  return (
    <>
      <FailureRow block={activity.failure} />
      <RawRail raw={activity.raw} />
    </>
  );
}

// ── 15낱말의 얼굴 ───────────────────────────────────────────────────────────

export const PRESENTERS = {
  "oculpm-journal": {
    Icon: NotebookPen,
    labelKey: "activity.kind.journal",
    runKey: "activity.run.generic",
    Row: LedgerActivity,
  },
  "oculpm-plan": {
    Icon: ListChecks,
    labelKey: "activity.kind.plan",
    runKey: "activity.run.generic",
    Row: LedgerActivity,
  },
  "oculpm-a2a": {
    Icon: Waypoints,
    labelKey: "activity.kind.a2a",
    runKey: "activity.run.generic",
    Row: LedgerActivity,
  },
  read: { Icon: FileIcon, labelKey: "activity.kind.read", runKey: "activity.run.read", Row: ToolActivity },
  edit: { Icon: Pencil, labelKey: "activity.kind.edit", runKey: "activity.run.edit", Row: ToolActivity },
  delete: { Icon: Trash2, labelKey: "activity.kind.delete", runKey: "activity.run.delete", Row: ToolActivity },
  move: { Icon: ArrowRight, labelKey: "activity.kind.move", runKey: "activity.run.move", Row: ToolActivity },
  search: { Icon: Search, labelKey: "activity.kind.search", runKey: "activity.run.search", Row: ToolActivity },
  shell: { Icon: Terminal, labelKey: "activity.kind.shell", runKey: "activity.run.shell", Row: ToolActivity },
  web: { Icon: ExternalLink, labelKey: "activity.kind.web", runKey: "activity.run.web", Row: ToolActivity },
  think: {
    Icon: MessageSquareDashed,
    labelKey: "activity.kind.think",
    runKey: "activity.run.think",
    Row: ThinkActivity,
  },
  todo: { Icon: ListTodo, labelKey: "activity.kind.todo", runKey: "activity.run.generic", Row: TodoActivity },
  permission: {
    Icon: ShieldAlert,
    labelKey: "activity.kind.permission",
    runKey: "activity.run.generic",
    Row: AttentionActivity,
  },
  error: {
    Icon: TriangleAlert,
    labelKey: "activity.kind.error",
    runKey: "activity.run.generic",
    Row: FailureActivity,
  },
  other: { Icon: Code2, labelKey: "activity.kind.other", runKey: "activity.run.other", Row: ToolActivity },
} satisfies Record<ActivityKind, Presenter>;

/** 세션 화면·활동 줄이 함께 쓰는 얼굴 하나 (`{#activity-vocab-reuse}`). */
export function presenterOf(kind: ActivityKind): Presenter {
  return PRESENTERS[kind];
}

/** 이 어휘가 우리 원장인가 — 얼굴을 강조할지의 근거. */
export { isOculpmKind };
