/**
 * 단계들을 2열 격자로 — 항목은 상태 상자 · 문구 · 사람 몫/막힘 칩 (시안 Plan).
 *
 * **끝난 단계는 한 줄로 접는다**(「engine · 4/4」, 누르면 그 자리에서 펼침) — 25항목 중 23개가 끝난
 * 계획이 체크 표시 23줄로 남은 둘을 묻었다. 남은 단계가 먼저, 끝난 단계는 그 뒤에 세로로 한 줄씩
 * (11-15: 가로로 흐르던 줄을 걷었다 — 격자에 안 맞았다). 접기 손잡이는 일지 화면과 같은 `Disclosure` 다.
 *
 * 상자를 누르면(또는 키보드로 Enter) 상태 메뉴(`StatusMenu`)가 열린다. 부모 항목은 하위의 롤업이라 메뉴가
 * 없고(이유를 말한다), 끝난(잠긴) 계획은 아무것도 바꾸지 않는다. 진행 중 항목은 누가 언제 잡았는지를 줄
 * 끝에 적는다 — 버려진 `[~]` 가 계획을 멈춰 세우는데 그것이 보이지 않았다.
 */

import { useRef, useState, type CSSProperties } from "react";

import { Disclosure } from "@/components/Disclosure";
import { agentLabel } from "@/features/today/agentColor";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { relativeTime } from "@/lib/format";
import type { PlanItemDto } from "@/lib/bindings";
import { doneOfTotal, heldTooLong, isUserItem, NO_PHASE, phasesOf, STATUS_META, stripUserTag } from "./planMeta";
import { StatusMark } from "./StatusMark";
import { StatusMenu, useCloseOnOutside } from "./StatusMenu";

/** 보이는 상태 상자, 문서 순서 — j/k 가 걷는 것과 같다(접힌 끝난 단계 안은 없다). */
export function itemBoxes(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(".plv-doc .plv-box-btn:not(:disabled)"));
}

const boxOf = (boxes: HTMLButtonElement[], itemId: string) =>
  boxes.find((b) => b.closest<HTMLElement>(".plv-item")?.dataset.item === itemId);

/**
 * 항목 상태를 바꾼 뒤 포커스가 갈 곳 (11-15) — 상태를 바꾸기 **전에** 부른다(그 상자의 자리를 지금 잰다).
 *
 * 다음 프레임에, 포커스가 body 로 떨어졌을 때만 움직인다: 확인 상자 · 팔레트처럼 그새 뜬 것이 포커스를
 * 가졌으면 건드리지 않는다(예전엔 무조건 상자로 돌려 확인 상자의 포커스를 스크림 뒤로 빼앗았다). 그 항목의
 * 상자가 있으면 그 상자, 고른 상태로 단계가 끝나 접혀 상자가 사라졌으면 같은 자리(끝이었으면 바로 위)의
 * 상자 — 일지 목록에서 줄이 빠질 때와 같은 규칙이다. 상자가 하나도 없으면 화면 본문(키는 거기서 듣는다).
 */
export function refocusItem(root: HTMLElement | null, itemId: string) {
  if (!root) return;
  const before = itemBoxes(root);
  const own = boxOf(before, itemId);
  const at = own ? before.indexOf(own) : 0;
  requestAnimationFrame(() => {
    const now = document.activeElement;
    if (!root.isConnected || (now && now !== document.body)) return;
    const boxes = itemBoxes(root);
    (boxOf(boxes, itemId) ?? boxes[Math.min(at, boxes.length - 1)] ?? root).focus();
  });
}

interface ItemProps {
  item: PlanItemDto;
  depth: number;
  parent: boolean;
  locked: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onOpenJournal: (ref: string) => void;
  /** 「Claude 에게 보내기」 — 줄을 가리킬 때만 보인다. */
  onSend?: (item: PlanItemDto) => void;
}

function PlanItemLine({ item, depth, parent, locked, onSetStatus, onOpenJournal, onSend }: ItemProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  // 바깥을 눌러 닫으면 포커스는 사람이 누른 곳에 둔다(상자로 되돌리지 않는다).
  useCloseOnOutside(anchor, open, () => setOpen(false));
  // 고르거나 Esc · Tab 으로 닫으면 포커스는 상자로 — **지금 바로**. 확인 상자(검증 없이 완료)가 뜨면 그 상자는
  // 열릴 때 포커스가 있던 곳(이 상자)을 기억해 닫힐 때 돌려준다. 고른 상태로 단계가 접혀 상자가 사라지면
  // 같은 자리의 상자로(`refocusItem`). 고른 뒤 body 로 떨어지면 다음 키가 갈 곳이 없다.
  const closeToTrigger = () => {
    refocusItem(anchor.current?.closest<HTMLElement>(".plv-body") ?? null, item.item_id);
    setOpen(false);
    trigger.current?.focus();
  };
  const title = stripUserTag(item.title);
  const statusLabel = t(STATUS_META[item.status]?.labelKey ?? "plan.status.todo");
  const showNote = item.note && (item.status === "in_progress" || item.status === "blocked");
  const lastRef = item.journal_refs[item.journal_refs.length - 1];
  const held = item.status === "in_progress" && (item.last_agent || item.last_update);
  const stale = heldTooLong(item);
  return (
    <div
      className={"plv-item is-" + item.status + (parent ? " is-parent" : "")}
      data-item={item.item_id}
      style={depth > 0 ? ({ "--plv-depth": depth } as CSSProperties) : undefined}
    >
      <span className="plv-anchor" ref={anchor}>
        <button
          ref={trigger}
          type="button"
          className="plv-box-btn"
          aria-label={t("plan.item.statusAria", { title, status: statusLabel })}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={locked}
          // 부모의 상태는 하위가 정한다 — 회색 상자 앞에서 왜 못 누르는지를 말한다(포커스는 남는다).
          {...(parent && !locked ? blocked(t("plan.item.parentReason")) : {})}
          onClick={() => setOpen((v) => !v)}
        >
          <StatusMark status={item.status} />
        </button>
        {open ? (
          <StatusMenu
            item={item}
            onPick={(s) => {
              closeToTrigger();
              if (s !== item.status) onSetStatus(item, s);
            }}
            onDismiss={closeToTrigger}
          />
        ) : null}
      </span>
      {/* 칩은 제목 글줄 안에서 흐른다 — 제목이 두 줄로 꺾여도 끝말 바로 뒤에 붙는다(따로 서면 첫 줄 오른쪽에 떴다). */}
      <span className="plv-item-t">
        {title}
        {isUserItem(item.title) ? <span className="chip sm hairline">{t("plan.item.user")}</span> : null}
        {item.status === "blocked" ? <span className="chip sm danger">{t("plan.status.blocked")}</span> : null}
        {stale ? <span className="chip sm warn">{t("plan.item.heldLong")}</span> : null}
      </span>
      {showNote ? <span className="plv-meta plv-item-note">· {item.note}</span> : null}
      {onSend && !parent && item.status !== "done" ? (
        <button
          type="button"
          className="btn ghost sm plv-item-send"
          aria-label={t("plan.item.sendAria", { title })}
          onClick={() => onSend(item)}
        >
          {t("send.submit")}
        </button>
      ) : null}
      {held ? (
        <span className="plv-held" title={item.last_update ?? undefined}>
          {item.last_agent ? agentLabel(item.last_agent) : null}
          {item.last_agent && item.last_update ? " · " : null}
          {item.last_update ? <span className="plv-time">{relativeTime(item.last_update, Date.now())}</span> : null}
        </span>
      ) : null}
      {lastRef ? (
        <button
          type="button"
          className="btn ghost sm plv-item-j"
          aria-label={t("plan.item.journalAria", { title })}
          onClick={() => onOpenJournal(lastRef)}
        >
          {t("plan.item.journalN", { n: item.journal_refs.length })}
        </button>
      ) : null}
    </div>
  );
}

export function PlanItems({
  items,
  locked,
  onSetStatus,
  onOpenJournal,
  onSend,
}: {
  items: PlanItemDto[];
  locked: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onOpenJournal: (ref: string) => void;
  onSend?: (item: PlanItemDto) => void;
}) {
  const { t } = useT();
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const groups = phasesOf(items).map((g) => ({ ...g, ...doneOfTotal(g.items.map((r) => r.item)) }));
  const finished = (g: (typeof groups)[number]) => g.total > 0 && g.done === g.total;
  const nameOf = (phase: string) => (phase === NO_PHASE ? t("plan.noPhase") : phase);
  const shown = groups.filter((g) => !finished(g));
  const done = groups.filter(finished);
  const line = (r: (typeof groups)[number]["items"][number]) => (
    <PlanItemLine
      key={r.item.item_id}
      item={r.item}
      depth={r.depth}
      parent={r.parent}
      locked={locked}
      onSetStatus={onSetStatus}
      onOpenJournal={onOpenJournal}
      onSend={onSend}
    />
  );
  return (
    <div className="plv-phases">
      {shown.map((g) => {
        const name = nameOf(g.phase);
        return (
          <section key={g.phase} className="plv-phase" aria-label={name}>
            {/* 단계 = 상자 한 장(10-30): 머리 띠에 이름 · 수. 진행 막대는 걷었다 — 접힌 것은 숫자로
                말한다(영수증 규칙 5, 11-04). */}
            <h3 className="plv-sec-h">
              <span className="plv-sec-name">{name}</span>
              <span className="plv-sec-n">
                {g.done}/{g.total}
              </span>
            </h3>
            {g.items.map(line)}
          </section>
        );
      })}
      {done.length > 0 ? (
        <div className="plv-done-row">
          {done.map((g) => (
            // 펼친 뒤에도 포커스는 그 머리(손잡이)에 남는다 — 단추가 사라지며 포커스를 잃던 것.
            <Disclosure
              key={g.phase}
              className="plv-phase-done"
              label={nameOf(g.phase)}
              count={`${g.done}/${g.total}`}
              open={opened.has(g.phase)}
              onToggle={(open) =>
                setOpened((prev) => {
                  const next = new Set(prev);
                  if (open) next.add(g.phase);
                  else next.delete(g.phase);
                  return next;
                })
              }
            >
              <div className="plv-done-items">{g.items.map(line)}</div>
            </Disclosure>
          ))}
        </div>
      ) : null}
    </div>
  );
}
