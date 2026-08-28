import { BellRing, Bot, NotebookPen, Plus, SquareTerminal, X } from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";
import type { TerminalTab } from "@/contexts/WorkspaceContext";
import { collectSids } from "@/lib/termPanes";
import { focusOfTab, panesOfTab } from "./activePane";
import { buildRailItem, formatElapsed, waitingItems, type RailTone } from "./railModel";
import { deriveAgentState, emptyPaneSignal, type PaneSignal } from "./agentMode";
import { useSecondTick } from "./useSecondTick";
import type { ShellState } from "./oscShell";

// 세로 세션 레일 (2026-08-28) — 가로 탭 줄을 대신한다.
//
// 왜 세로인가: 에이전트를 여러 개 띄우면 탭이 순식간에 5~8 개가 된다. 가로
// 탭은 그 지점에서 이름이 `cla…` 로 뭉개지고, 상태를 넣을 자리가 아예 없다.
// 세로 카드는 이름·상태·경과 시간·마지막 명령을 **한 장에 함께** 실을 수 있고,
// 개수가 늘어도 아래로 흐를 뿐 각 카드의 폭이 줄지 않는다.
//
// 여기 그리는 값은 전부 셸 통합(OSC 133)이 이미 알려준 것이다 (→ railModel).
// 통합이 꺼진 세션은 이름만 남고 상태 줄이 비는데, 그게 정직한 표시다.

const TONE_LABEL: Record<RailTone, I18nKey> = {
  running: "term.tone.running",
  waiting: "term.tone.waiting",
  ok: "term.tone.ok",
  fail: "term.tone.fail",
  idle: "term.tone.idle",
  off: "term.tone.off",
};

export interface TerminalRailProps {
  tabs: TerminalTab[];
  /** sid → 셸 상태. 통합이 없는 세션은 여기 없다. */
  shellStates: Record<string, ShellState>;
  /** sid → 페인 신호(alt-screen·BEL·마지막 출력). 에이전트 기다림 판정 재료. */
  paneSignals: Record<string, PaneSignal>;
  /**
   * 방금 끝난 에이전트 실행 — 탭 id → 표시할 것. 카드 안에 인라인으로 뜬다
   * (토스트는 화면을 떠나면 사라지지만 이건 남는다).
   */
  finished?: Record<string, { agentLabel: string; duration: string } | undefined>;
  onJournalFromRun?: (id: string) => void;
  onDismissFinished?: (id: string) => void;
  activeId: string | null;
  /** 아이콘만 남긴 좁은 모드. */
  collapsed: boolean;
  renaming: { id: string; draft: string } | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onRenameStart: (id: string, label: string) => void;
  onRenameChange: (draft: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  /**
   * 세션 옮기기 드래그 배선 (2026-08-28). 없으면 드래그가 그냥 꺼진다 —
   * 레일은 카드를 그리고 포인터를 넘길 뿐, 어디에 놓이는지는 모른다
   * (그 판정은 페인 기하까지 아는 `TerminalSurface` 몫이다).
   */
  drag?: RailDrag;
}

export interface RailDrag {
  /** 지금 끌려 나가는 카드 — 손에 들린 것처럼 그린다. */
  movingId: string | null;
  /** 카드 사이에 세울 캐럿의 y (레일 기준 px). null 이면 안 그린다. */
  caretTop: number | null;
  registerRail: (el: HTMLElement | null) => void;
  registerCard: (id: string, el: HTMLElement | null) => void;
  onPointerDown: (id: string, e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

export function TerminalRail({
  tabs,
  shellStates,
  paneSignals,
  finished,
  onJournalFromRun,
  onDismissFinished,
  activeId,
  collapsed,
  renaming,
  onSelect,
  onClose,
  onAdd,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  drag,
}: TerminalRailProps) {
  const { t } = useT();

  // 시계를 켤지는 셸 상태만 보고 정한다 — 카드 재료가 시계에 의존하므로
  // 카드에서 되물으면 순환이 된다.
  //
  // 예전엔 카드 재료를 memo 로 묶었는데, 기다림 판정이 **시간이 흐르는
  // 것만으로** 바뀌게 되면서(출력이 멎은 지 얼마나 됐나) 고정된 now 로는
  // 계산할 수 없다. 탭 수는 한 자리라 매초 다시 만드는 비용은 무시할 만하다.
  const live = tabs.some((tab) => shellStates[focusOfTab(tab)]?.running != null);
  const now = useSecondTick(live);
  const base = tabs.map((tab) => {
    const sid = focusOfTab(tab);
    const shell = shellStates[sid];
    return buildRailItem(
      {
        id: tab.id,
        label: tab.label,
        shell,
        agentState: deriveAgentState(shell, paneSignals[sid] ?? emptyPaneSignal, now),
        paneCount: collectSids(panesOfTab(tab)).length,
      },
      now,
    );
  });
  const waiting = waitingItems(base);

  /**
   * 다음 대기 세션으로. **정렬하지 않는 이유**: 카드가 스스로 순서를 바꾸면
   * 누르려던 자리에 다른 세션이 와 있게 된다. 목록은 그대로 두고 "가는 길"만
   * 준다 — 여러 개가 기다리면 누를 때마다 다음 것으로 돈다.
   */
  const jumpToWaiting = () => {
    if (waiting.length === 0) return;
    const at = waiting.findIndex((item) => item.id === activeId);
    onSelect(waiting[(at + 1) % waiting.length].id);
  };

  return (
    <div
      // 드롭 판정용 기하 — 레일 상자 안이면 "순서 바꾸기/빼내기", 밖이면 페인
      // 가장자리를 본다. 상태로 들고 있으면 드래그가 자기 재렌더를 다시 잰다.
      ref={(el) => drag?.registerRail(el)}
      className={"term-rail" + (drag?.caretTop != null ? " receiving" : "")}
      role="tablist"
      aria-orientation="vertical"
      aria-label={t("term.rail.region")}
      data-collapsed={collapsed || undefined}
    >
      {waiting.length > 0 ? (
        <button
          type="button"
          className="term-rail-alert"
          onClick={jumpToWaiting}
          title={t("term.wait.jump", { n: waiting.length })}
          aria-label={t("term.wait.jump", { n: waiting.length })}
        >
          <BellRing size={13} aria-hidden="true" />
          {collapsed ? (
            <span className="tra-n">{waiting.length}</span>
          ) : (
            <span>{t("term.wait.badge", { n: waiting.length })}</span>
          )}
        </button>
      ) : null}
      <div className="term-rail-list">
        {base.map((item, index) => {
          const tab = tabs[index];
          const elapsed = item.elapsedMs;
          const active = item.id === activeId;
          const done = finished?.[item.id];
          const toneText = t(TONE_LABEL[item.tone]);
          return (
            <div
              key={item.id}
              ref={(el) => drag?.registerCard(item.id, el)}
              className={
                "term-sess" +
                (active ? " active" : "") +
                (item.waiting ? " waiting" : "") +
                (drag?.movingId === item.id ? " dragging" : "")
              }
              data-tone={item.tone}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              // 드래그는 눈에 안 보이는 조작이라 카드가 스스로 알려야 한다 —
              // 툴팁 둘째 줄에 넣으면 평소엔 조용하고 필요할 때 읽힌다.
              title={
                `${item.label} — ${toneText}` +
                (drag ? `\n${t("term.dragSessionHint")}` : "")
              }
              // 포인터 캡처로 끌면 커서가 페인(xterm 캔버스) 위로 지나가도
              // move/up 을 계속 받는다. 클릭(선택)은 그대로 살아 있고, 드래그로
              // 끝난 포인터의 뒤따르는 click 은 소비처가 걸러낸다.
              onPointerDown={(e) => drag?.onPointerDown(item.id, e)}
              onPointerMove={(e) => drag?.onPointerMove(e)}
              onPointerUp={(e) => drag?.onPointerUp(e)}
              onPointerCancel={() => drag?.onPointerCancel()}
              onClick={() => onSelect(item.id)}
              onDoubleClick={() => onRenameStart(item.id, tab.label)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(item.id);
                }
              }}
            >
              <span className="ts-dot" aria-hidden="true" />
              <span className="ts-icon" aria-hidden="true">
                {item.agent ? <Bot size={14} /> : <SquareTerminal size={14} />}
              </span>
              <span className="ts-main">
                <span className="ts-line">
                  {renaming?.id === item.id ? (
                    <input
                      className="ts-rename"
                      autoFocus
                      value={renaming.draft}
                      onChange={(e) => onRenameChange(e.target.value)}
                      onBlur={onRenameCommit}
                      // 같은 이유 — 이름을 고치려고 누른 포인터가 드래그가
                      // 되면 캐럿 위치를 잡을 수 없다.
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onRenameCommit();
                        else if (e.key === "Escape") onRenameCancel();
                        e.stopPropagation();
                      }}
                      aria-label={t("term.renameLabel")}
                    />
                  ) : (
                    <span className="ts-name">{item.label}</span>
                  )}
                  {elapsed === null ? null : (
                    <span className="ts-elapsed" aria-live="off">
                      {formatElapsed(elapsed)}
                    </span>
                  )}
                </span>
                {item.detail || item.paneCount > 1 ? (
                  <span className="ts-detail">
                    {item.paneCount > 1 ? (
                      <span className="ts-panes">{t("term.paneCount", { n: item.paneCount })}</span>
                    ) : null}
                    {item.detail}
                  </span>
                ) : null}
                {/* 방금 끝난 에이전트 실행 — 여기서 바로 일지로 잇는다.
                    터미널 실행은 요약할 transcript 가 없으므로 **쓰지 않고
                    묻기만** 한다 (작성기를 열 뿐이다). */}
                {done && !collapsed ? (
                  <span className="ts-done">
                    <span className="tsd-text">
                      {t("term.agentFinishedCard", {
                        agent: done.agentLabel,
                        duration: done.duration,
                      })}
                    </span>
                    <span className="tsd-row">
                      <button
                        type="button"
                        className="tsd-go"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onJournalFromRun?.(item.id);
                        }}
                      >
                        <NotebookPen size={11} aria-hidden="true" />
                        {t("term.agentJournalAction")}
                      </button>
                      <button
                        type="button"
                        className="tsd-x"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDismissFinished?.(item.id);
                        }}
                        aria-label={t("term.agentDismiss")}
                        title={t("term.agentDismiss")}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="ts-x"
                // 닫기에서 시작한 포인터가 카드 드래그로 번지면 안 된다 —
                // 카드가 포인터를 캡처해 버리면 `click` 이 카드로 재조준되어
                // × 를 눌러도 세션이 안 닫히고 선택만 된다.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(item.id);
                }}
                aria-label={t("term.closeTab", { label: item.label })}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {/* 끌려온 세션이 꽂힐 자리. 카드 **사이**에 끼우면 tablist 의 자식 구조가
          어긋나므로 절대 위치로 띄운다 (접힌 모드에서도 카드 테두리에 그대로
          걸린다 — 카드 안쪽 요소가 그때 숨겨지기 때문). */}
      {drag?.caretTop != null ? (
        <span className="term-rail-caret" aria-hidden="true" style={{ top: drag.caretTop }} />
      ) : null}
      <button
        type="button"
        className="term-rail-add"
        onClick={onAdd}
        title={t("term.newSessionHint")}
        aria-label={t("term.newSessionHint")}
      >
        <Plus size={14} />
        {collapsed ? null : <span>{t("term.newSession")}</span>}
      </button>
    </div>
  );
}
