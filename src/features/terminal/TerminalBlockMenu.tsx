import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clipboard, NotebookPen, Puzzle, Target, Terminal } from "@/components/Icons";
import { commands, type PlanPhaseDto, type PlanSummary } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { requestManualEntry } from "@/lib/journalCompose";
import { requestAgentContext } from "@/lib/agentContextNav";
import { commandsToCodeBlock, firstSlug } from "@/lib/promoteSeed";
import { useT } from "@/i18n";
import { blockBody, blockTitle } from "./commandBlocks";
import type { BlockActivation } from "./TerminalInstanceImpl";

// 명령 블록 액션 팝오버 (2026-08-28 Phase 3).
//
// Warp 의 블록 액션은 공유·재실행이 목적이다. 여기 마지막 두 줄 — **일지로
// 남기기 · 플래너에 붙이기** — 이 ocul-pm 것이다: 터미널에서 일어난 일이
// 기록의 원재료가 되는 고리다. 이게 없으면 그냥 Warp 흉내다.

const MENU_WIDTH = 232;

type View = "root" | "plans" | "phases";

export interface TerminalBlockMenuProps {
  activation: BlockActivation;
  projectId: number | null;
  onClose: () => void;
  /** 명령을 프롬프트에 채운다 (실행은 하지 않는다 — 아래 주석 참고). */
  onFill: (command: string) => void;
}

export function TerminalBlockMenu({
  activation,
  projectId,
  onClose,
  onFill,
}: TerminalBlockMenuProps) {
  const { t } = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>("root");
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [phases, setPhases] = useState<PlanPhaseDto[] | null>(null);
  const [busy, setBusy] = useState(false);

  const { block, output } = activation;

  // 바깥 클릭·Esc 로 닫는다. 캡처 단계에서 듣는다 — 터미널 캔버스가 mousedown 을
  // 먼저 삼키면 팝오버가 열린 채 남는다.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const copy = (text: string, label: string) => {
    if (!text) {
      toast.info(t("term.block.nothingToCopy"));
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.info(label))
      .catch(() => toast.destructive(t("term.block.copyFailed")));
    onClose();
  };

  const toJournal = () => {
    requestManualEntry({
      title: blockTitle(block.command),
      body: blockBody(block, output, {
        command: t("term.block.seedCommand"),
        exit: t("term.block.seedExit"),
        duration: t("term.block.seedDuration"),
        outputHead: t("term.block.seedOutput"),
        truncated: t("term.block.seedTruncated"),
      }),
    });
    onClose();
  };

  // AD-4 — 같은 명령을 손으로 세 번 치는 순간이 스킬이 태어나는 자리다.
  // 여기서 누르면 스킬·규칙 화면의 "새 스킬" 이 이 명령을 본문 씨앗으로 열린다
  // (실행하지 않는다 — 씨앗은 텍스트일 뿐이고 파일은 승인해야 쓰인다).
  const toSkill = () => {
    requestAgentContext({
      kind: "createSkill",
      seed: {
        name: firstSlug(blockTitle(block.command, 40)),
        body: t("ctx.promote.seedFrom", { source: commandsToCodeBlock([block.command]) }),
      },
    });
    onClose();
  };

  const openPlans = () => {
    if (projectId == null) return;
    setView("plans");
    if (plans) return;
    void commands.planList(projectId).then((res) => {
      if (res.status === "error") {
        toast.destructive(t("term.block.planLoadFailed", { error: res.error }));
        onClose();
        return;
      }
      setPlans(res.data.filter((candidate) => candidate.status === "active"));
    });
  };

  const openPhases = (chosen: PlanSummary) => {
    if (projectId == null) return;
    setPlan(chosen);
    setPhases(null);
    setView("phases");
    void commands.planGet(projectId, chosen.plan_id).then((res) => {
      if (res.status === "error" || !res.data) {
        toast.destructive(t("term.block.planLoadFailed", { error: String(res.status) }));
        onClose();
        return;
      }
      setPhases(res.data.phases);
    });
  };

  const attach = (phase: PlanPhaseDto) => {
    if (projectId == null || !plan || busy) return;
    setBusy(true);
    void commands
      .planApplyEdit(
        projectId,
        plan.plan_id,
        { kind: "add_item", phase: phase.name, title: blockTitle(block.command), item_id: null, status: null },
        "claude-code",
      )
      .then((res) => {
        if (res.status === "error") toast.destructive(t("term.block.attachFailed", { error: res.error }));
        else toast.info(t("term.block.attached", { plan: plan.title, phase: phase.name }));
      })
      .finally(() => {
        setBusy(false);
        onClose();
      });
  };

  // 화면 밖으로 나가지 않게 자른다 — 캡슐이 오른쪽 끝 페인에 있으면 그냥
  // 넘어가서 메뉴의 절반이 안 보인다.
  const left = Math.min(activation.rect.right + 6, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(activation.rect.top, window.innerHeight - 260);

  return (
    <div
      ref={rootRef}
      className="term-block-menu"
      style={{ left, top: Math.max(8, top), width: MENU_WIDTH }}
      role="menu"
      aria-label={t("term.block.menu")}
    >
      {view === "root" ? (
        <>
          <div className="tbm-head" title={block.command}>
            <Terminal size={12} aria-hidden="true" />
            <span className="tbm-cmd">{blockTitle(block.command, 40)}</span>
          </div>
          <button type="button" className="tbm-item" role="menuitem" onClick={() => copy(block.command, t("term.block.copiedCommand"))}>
            <Clipboard size={13} aria-hidden="true" />
            {t("term.block.copyCommand")}
          </button>
          <button type="button" className="tbm-item" role="menuitem" onClick={() => copy(output, t("term.block.copiedOutput"))}>
            <Clipboard size={13} aria-hidden="true" />
            {t("term.block.copyOutput")}
          </button>
          {/* **실행하지 않는다.** 스크롤백에서 고른 명령을 눈으로 확인하지 않고
              바로 돌리는 것이 `rm -rf` 를 두 번 하는 방법이다. 프롬프트에
              채우기만 하고 Enter 는 사람이 친다 (디스패치 프리필과 같은 규약). */}
          <button type="button" className="tbm-item" role="menuitem" onClick={() => { onFill(block.command); onClose(); }}>
            <ChevronRight size={13} aria-hidden="true" />
            {t("term.block.fill")}
          </button>
          <div className="tbm-sep" role="separator" />
          <button type="button" className="tbm-item accent" role="menuitem" onClick={toJournal}>
            <NotebookPen size={13} aria-hidden="true" />
            {t("term.block.toJournal")}
          </button>
          <button type="button" className="tbm-item accent" role="menuitem" onClick={toSkill}>
            <Puzzle size={13} aria-hidden="true" />
            {t("ctx.promote.skill")}
          </button>
          <button
            type="button"
            className="tbm-item accent"
            role="menuitem"
            onClick={openPlans}
            disabled={projectId == null}
          >
            <Target size={13} aria-hidden="true" />
            {t("term.block.toPlan")}
            <ChevronRight size={12} className="tbm-more" aria-hidden="true" />
          </button>
        </>
      ) : null}

      {view === "plans" ? (
        <>
          <button type="button" className="tbm-back" onClick={() => setView("root")}>
            <ChevronLeft size={12} aria-hidden="true" />
            {t("term.block.pickPlan")}
          </button>
          {plans === null ? <div className="tbm-empty">{t("term.block.loading")}</div> : null}
          {plans?.length === 0 ? <div className="tbm-empty">{t("term.block.noPlans")}</div> : null}
          {plans?.map((candidate) => (
            <button
              type="button"
              className="tbm-item"
              role="menuitem"
              key={candidate.plan_id}
              onClick={() => openPhases(candidate)}
            >
              <span className="tbm-label">{candidate.title}</span>
              <ChevronRight size={12} className="tbm-more" aria-hidden="true" />
            </button>
          ))}
        </>
      ) : null}

      {view === "phases" ? (
        <>
          <button type="button" className="tbm-back" onClick={() => setView("plans")}>
            <ChevronLeft size={12} aria-hidden="true" />
            {t("term.block.pickPhase")}
          </button>
          {phases === null ? <div className="tbm-empty">{t("term.block.loading")}</div> : null}
          {phases?.length === 0 ? <div className="tbm-empty">{t("term.block.noPhases")}</div> : null}
          {phases?.map((phase) => (
            <button
              type="button"
              className="tbm-item"
              role="menuitem"
              key={phase.name}
              disabled={busy}
              onClick={() => attach(phase)}
            >
              <span className="tbm-label">{phase.name}</span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
