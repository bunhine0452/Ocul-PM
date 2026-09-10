import { AgentMark } from "@/components/AgentMark";
import { GripVertical, Maximize2, Minimize2, X } from "@/components/Icons";
import { useT } from "@/i18n";
import { deriveAgentState, emptyPaneSignal, type PaneSignal } from "./agentMode";
import { formatCwdCrumb, formatElapsed } from "./railModel";
import { summarizeShell } from "./shellStatus";
import { useSecondTick } from "./useSecondTick";
import type { ShellState } from "./oscShell";
import type { BlockTone } from "./commandBlocks";

// 페인 머리띠 (2026-09-11 터미널 리디자인).
//
// # 무엇이 바뀌었나
//
// 예전 페인은 맨 캔버스였다. 그 위에 에이전트 알약(왼쪽 위)·손잡이·닫기(오른쪽
// 위)가 **떠 있었고**, 셸 프롬프트의 오른쪽 끝(RPROMPT 의 `base py` 같은 것)을
// 그 칩들이 덮었다. 어느 페인이 어느 폴더에 있는지는 상태바가 포커스된 페인
// 하나만 말해 줬다.
//
// 이제 페인마다 고정 높이의 띠 한 줄이 있다: 왼쪽에 상태 점 + 작업 폴더, 가운데에
// 지금 무슨 일이 일어나는지(에이전트 이름·단계·경과, 또는 마지막 명령·종료코드),
// 오른쪽에 손잡이·확대·닫기. 출력 위에 아무것도 떠 있지 않다.
//
// # 왜 높이가 고정인가
//
// 2026-08-28 에 헤더 줄을 피해 알약으로 간 이유는 "헤더가 생기고 사라지면 페인
// 높이가 바뀌어 xterm 이 refit 하고 PTY 가 resize 된다" 였다. 그 걱정은 **가변**
// 헤더의 것이다. 이 띠는 내용이 있든 없든 항상 같은 높이라, 에이전트가 뜨고 져도
// 캔버스는 한 픽셀도 움직이지 않는다.
//
// # 시계를 여기 가두는 이유
//
// "기다린다" 의 근거는 *출력이 멎은 지 얼마나 됐나* 라서 시간이 흐르는 것만으로
// 상태가 바뀐다. 이 판정을 `TerminalSurface` 에서 하면 1초마다 페인 트리 전체가
// 재렌더된다. 판정과 시계를 이 작은 컴포넌트에 가둔다 — 페인마다 하나씩이다.

export type PaneHeadTone = "running" | "waiting" | "ok" | "fail" | "idle" | "off";

/** 머리띠 오른쪽의 이력 핍 하나 — 최근 명령 하나의 결과. */
export interface PanePip {
  id: number;
  tone: BlockTone;
  command: string;
}

/** 핍 개수 — 한눈에 세지 않고도 "요즘 어땠나" 가 읽히는 만큼만. */
export const PIP_COUNT = 8;

export interface TerminalPaneHeadProps {
  /** 세션(탭) 이름 — cwd 를 모르면 이걸 보여준다. */
  label: string;
  projectRoot: string | null;
  shell: ShellState | undefined;
  signal: PaneSignal | undefined;
  /** 분할이 둘 이상인가 — 손잡이·확대·닫기는 그때만 뜻이 있다. */
  multi: boolean;
  zoomed: boolean;
  onZoom: () => void;
  onClose: () => void;
  /**
   * 최근 명령 결과의 이력 (오래된 것 → 최신). 셸 통합이 있어야 생긴다 — 없으면
   * 빈 배열이라 아무것도 그리지 않는다. 누르면 그 명령의 출력으로 스크롤한다.
   */
  pips?: readonly PanePip[];
  onPip?: (id: number) => void;
  /** 페인 집기 — 캔버스에 직접 걸면 셸의 텍스트 선택과 싸운다 (TerminalSurface). */
  grip: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  };
}

/** `a/b/c` → 부모 `a/b/` 와 잎 `c`. 잎만 진하게 — 눈이 먼저 찾는 것은 잎이다. */
export function splitCrumb(crumb: string): { parent: string; leaf: string } {
  const i = crumb.lastIndexOf("/");
  if (i < 0) return { parent: "", leaf: crumb };
  return { parent: crumb.slice(0, i + 1), leaf: crumb.slice(i + 1) };
}

export function TerminalPaneHead({
  label,
  projectRoot,
  shell,
  signal,
  multi,
  zoomed,
  onZoom,
  onClose,
  pips = [],
  onPip,
  grip,
}: TerminalPaneHeadProps) {
  const { t } = useT();
  const running = shell?.running ?? null;
  const now = useSecondTick(running !== null);
  const agent = deriveAgentState(shell, signal ?? emptyPaneSignal, now);
  const summary = shell ? summarizeShell(shell) : null;
  const tone: PaneHeadTone = agent?.waiting ? "waiting" : (summary?.tone ?? "off");

  const crumb = formatCwdCrumb(shell?.cwd ?? null, projectRoot);
  const { parent, leaf } = splitCrumb(crumb || label);

  const phase = agent
    ? agent.waiting
      ? agent.guess
        ? t("term.wait.guess")
        : t("term.wait.bell")
      : t("term.tone.running")
    : null;

  return (
    <div className="term-pane-head" data-tone={tone}>
      <span className="tph-dot" aria-hidden="true" />
      <span className="tph-crumb" title={shell?.cwd ?? label}>
        {parent ? <span className="tph-parent">{parent}</span> : null}
        <span className="tph-leaf">{leaf}</span>
      </span>
      {/* 가운데 — 지금 무슨 일이 일어나는가. 통합이 꺼진 세션은 빈 자리다:
          꺼진 기능을 켜진 것처럼 보이게 하느니 아무것도 없는 편이 낫다. */}
      <span className="tph-live" role="status" aria-live="polite">
        {agent ? (
          <>
            <AgentMark agentId={agent.agent.id} size={13} aria-hidden="true" />
            <span className="tph-agent">{agent.agent.label}</span>
            <span className="tph-phase">{phase}</span>
          </>
        ) : summary ? (
          <span className="tph-text">{summary.text}</span>
        ) : null}
      </span>
      {/* 이력 핍 — 최근 명령 여덟 개의 결과가 왼→오 순으로 선다. 곁눈질로
          "이 페인은 요즘 잘 돌았나" 를 읽는 자리다; 빨간 핍은 누르면 그
          출력으로 데려간다. 통합이 없는 세션은 핍이 없다 (모르는 것을 초록으로
          칠하지 않는다). */}
      {pips.length > 0 ? (
        <span className="tph-pips" title={t("term.pips.hint")}>
          {pips.map((pip) => (
            <button
              key={pip.id}
              type="button"
              className="tph-pip"
              data-tone={pip.tone}
              onClick={() => onPip?.(pip.id)}
              aria-label={pip.command || t("term.pips.running")}
              title={pip.command || t("term.pips.running")}
            />
          ))}
        </span>
      ) : null}
      {/* 경과 시간은 라이브 칸 **밖**이다 — 칸이 좁아져 문구가 잘려도 시계는
          잘리지 않는다 (좁은 도크에서 남는 정보는 이것뿐일 때가 많다). */}
      {running ? (
        <span className="tph-elapsed">{formatElapsed(Math.max(0, now - running.startedAt))}</span>
      ) : null}
      {multi ? (
        <span className="tph-tools">
          {/* 마우스 전용 어포던스라 보조기술에는 감춘다 — 키보드 등가물은
              ⌘D/⇧⌘D(분할)와 ⌘W(닫기)가 이미 있다. */}
          <span
            className="pane-grip"
            role="presentation"
            aria-hidden="true"
            title={t("term.dragPaneHint")}
            onPointerDown={grip.onPointerDown}
            onPointerMove={grip.onPointerMove}
            onPointerUp={grip.onPointerUp}
            onPointerCancel={grip.onPointerCancel}
          >
            <GripVertical size={11} />
          </span>
          <button
            type="button"
            className="pane-zoom"
            onClick={onZoom}
            aria-pressed={zoomed}
            aria-label={t(zoomed ? "term.pane.unzoom" : "term.pane.zoom")}
            title={t(zoomed ? "term.pane.unzoomHint" : "term.pane.zoomHint")}
          >
            {zoomed ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
          <button
            type="button"
            className="pane-close"
            onClick={onClose}
            aria-label={t("term.closePane")}
            title={t("term.closePaneHint")}
          >
            <X size={11} />
          </button>
        </span>
      ) : null}
    </div>
  );
}
