/**
 * 세로 세션 레일에 그릴 카드 하나를 만드는 **순수 함수** (2026-08-28).
 *
 * 렌더에서 분리한 이유는 `shellStatus.ts` 와 같다 — 경과 시간 표기와 "지금
 * 무엇이 돌고 있는가"의 판정은 눈으로 확인하기 어렵고 조용히 틀리기 쉽다.
 *
 * 이 모듈은 새 신호를 만들지 않는다. 셸 통합(OSC 133)이 이미 알려준 것과
 * `detectAgent` 가 명령줄에서 읽어낸 것을 **카드 한 장 분량으로 재배치**할
 * 뿐이다. 통합이 꺼진 세션은 알 수 있는 게 없으므로 `tone: "off"` 로 두고
 * 아무것도 지어내지 않는다.
 */
import { detectAgent, type AgentRun } from "./agentDetect";
import { summarizeShell } from "./shellStatus";
import type { ShellState } from "./oscShell";
import type { AgentState } from "./agentMode";
import { canAutoRename } from "./tabTitle";
import { t } from "@/i18n";

/**
 * 카드 좌측 점·테두리 색을 고르는 값. `off` = 셸 통합이 없는 세션.
 * `waiting` = 에이전트가 **나를 기다린다** — 다른 무엇보다 먼저 눈에 띄어야
 * 하는 유일한 상태다 (→ `agentMode`).
 */
export type RailTone = "running" | "waiting" | "ok" | "fail" | "idle" | "off";

export interface RailItem {
  id: string;
  /** 카드 첫 줄 이름. 사용자가 직접 지은 이름은 언제나 이긴다. */
  label: string;
  tone: RailTone;
  /** 지금 돌고 있는 코딩 에이전트. 아이콘과 이름에 쓴다. */
  agent: AgentRun | null;
  /** 카드 둘째 줄. 알 수 있는 게 없으면 빈 문자열. */
  detail: string;
  /** 실행 중일 때의 경과 ms. 아니면 `null` (타이머를 그리지 않는다). */
  elapsedMs: number | null;
  /** 이 탭의 분할 페인 수. 1 이면 표시하지 않는다. */
  paneCount: number;
  /**
   * 지금 명령이 돌고 있는 페인 수.
   *
   * 카드의 머리글(상태·경과·마지막 명령)은 **포커스된 페인** 것이다. 그것만
   * 그리면 4분할해 에이전트를 넷 띄운 탭이 "하나 돌고 있음"으로 보인다 —
   * 나머지 셋은 카드 어디에도 없었다. 이 수는 탭 전체를 센다.
   */
  runningCount: number;
  /** 내 입력을 기다리는 페인 수. 같은 이유로 탭 전체를 센다. */
  waitingCount: number;
  /** 에이전트가 내 입력을 기다리는가 (**어느 페인이든**). */
  waiting: boolean;
  /** 그 판단이 추정인가 (출력이 멎었다 = 추정, 벨 = 확실). */
  waitingGuess: boolean;
}

/** 페인 하나의 상태 — 개수를 세는 데 필요한 것만. */
export interface RailPane {
  shell: ShellState | undefined;
  agentState: AgentState | null;
}

export interface RailInput {
  id: string;
  label: string;
  /** 이 탭의 **포커스된 페인**의 셸 상태. 통합이 없으면 `undefined`. */
  shell: ShellState | undefined;
  /**
   * 같은 페인에서 파생한 에이전트 상태 (→ `agentMode.deriveAgentState`).
   * 넘기지 않으면 기다림을 판정하지 않는다 — 아이콘용 에이전트 식별은 이
   * 값 없이도 명령줄만으로 된다.
   */
  agentState?: AgentState | null;
  /**
   * 이 탭의 **모든** 페인 (포커스된 것 포함). 개수와 "몇 개가 돌고 있나"가
   * 여기서 나온다. 비우면 페인 하나짜리 탭으로 본다.
   */
  panes: readonly RailPane[];
}

/**
 * 경과 시간을 시계 표기로 — `4:12`, `1:02:03`.
 *
 * `shellStatus.formatDuration` 과 일부러 다르다. 저쪽은 "12초 · 3분 20초" 처럼
 * 문장에 들어가는 완료 보고이고, 이쪽은 **1초마다 갱신되며 좁은 자리에서 폭이
 * 흔들리면 안 되는** 라이브 타이머다 (그래서 언어 중립 · 고정폭).
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** 경로에서 마지막 조각만 — 카드 둘째 줄의 자리는 한 단어가 한계다. */
function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * 카드 한 장을 만든다. `now` 는 주입받는다 (경과 시간 테스트 결정성).
 *
 * 이름 규칙: 에이전트가 돌고 있고 **탭 이름이 아직 자동 이름일 때만** 에이전트
 * 이름으로 바꿔 보여준다. 사용자가 손으로 지은 이름을 프로세스가 덮으면 방금
 * 붙인 이름이 사라지는 것처럼 보인다 (`canAutoRename` 은 셸 제목 자동 이름
 * 규칙과 같은 판정이다 — 두 곳이 갈라지면 이름이 오락가락한다).
 */
export function buildRailItem(input: RailInput, now: number): RailItem {
  const { id, label, shell, panes, agentState = null } = input;
  const summary = shell ? summarizeShell(shell) : null;
  const agent = shell?.running ? detectAgent(shell.running.command) : null;

  // 개수는 **탭 전체**를 센다 — 카드의 머리글이 포커스된 페인 하나만 말하는
  // 것과 일부러 다르다. 넷을 띄워 놓고 하나만 보이던 것이 이 카드의 구멍이었다.
  const paneCount = Math.max(1, panes.length);
  const runningCount = panes.filter((pane) => pane.shell?.running != null).length;
  const waitingPanes = panes.filter((pane) => pane.agentState?.waiting === true);
  const waitingCount = waitingPanes.length;

  if (!summary) {
    // 셸 통합이 없는 세션 — cwd 조차 모른다. 이름만 그린다.
    // 개수는 그래도 안다(레이아웃이 알려준다) — 통합과 무관한 사실이다.
    return {
      id,
      label,
      tone: "off",
      agent: null,
      detail: "",
      elapsedMs: null,
      paneCount,
      runningCount,
      waitingCount,
      waiting: false,
      waitingGuess: false,
    };
  }

  // 기다림도 탭 전체다. 포커스된 페인만 보면, 옆 페인의 에이전트가 나를
  // 부르는데 다른 탭을 보고 있는 동안에는 아무도 알려주지 않는다.
  //
  // 포커스된 페인을 따로 한 번 더 보는 이유: `panes` 는 호출부가 채우는
  // 목록이라 비어 있을 수 있고(테스트·페인 하나짜리 옛 호출), 그때 이미 알고
  // 있는 기다림을 잃으면 안 된다. 아는 것을 버리지 않는 쪽으로 합친다.
  const focusedWaiting = agentState?.waiting === true;
  const waiting = focusedWaiting || waitingCount > 0;
  // 문구의 근거는 **포커스된 페인**이 우선이다. 그쪽이 기다리는 게 아니면
  // 옆 페인들이 근거이고, 하나라도 확실한 신호(벨)면 추정이 아니다.
  const waitingGuess = focusedWaiting
    ? agentState?.guess === true
    : waiting && waitingPanes.every((pane) => pane.agentState?.guess === true);
  return {
    id,
    label: agent && canAutoRename(label) ? agent.label : label,
    // 기다림은 실행 중을 **덮는다**. 둘 다 참일 때 "실행 중"을 보여주면 정작
    // 사람이 필요한 순간이 다른 초록 점들 사이에 묻힌다.
    tone: waiting ? "waiting" : summary.tone,
    agent,
    detail: waiting
      ? // 문구는 포커스된 페인이 기다릴 때만 그 페인의 근거를 쓴다. 다른
        // 페인이 부르는 것이면 어느 쪽인지부터 말해야 한다.
        focusedWaiting
        ? agentState?.guess
          ? t("term.wait.guess")
          : t("term.wait.bell")
        : t("term.wait.otherPane", { n: waitingCount })
      : summary.text,
    elapsedMs: shell?.running ? Math.max(0, now - shell.running.startedAt) : null,
    paneCount,
    runningCount,
    waitingCount,
    waiting,
    waitingGuess,
  };
}

/** 지금 기다리는 카드들 — 레일 배지와 "다음 대기로" 이동에 쓴다. */
export function waitingItems(items: readonly RailItem[]): RailItem[] {
  return items.filter((item) => item.waiting);
}

/**
 * 상태바 좌측의 작업 디렉터리 표시. 프로젝트 루트 안쪽이면 루트 **밖**을
 * 잘라내고 상대 경로만 남긴다 — `/Users/me/Desktop/git/ai-pm/src/features` 는
 * 좁은 줄에서 앞부분이 전부 잘려 아무 정보도 주지 못한다.
 *
 * 루트 밖(에이전트가 `cd /tmp` 한 경우)이면 마지막 두 조각만 보여준다.
 */
export function formatCwdCrumb(cwd: string | null, projectRoot: string | null): string {
  if (!cwd) return "";
  if (projectRoot && (cwd === projectRoot || cwd.startsWith(projectRoot + "/"))) {
    const rel = cwd.slice(projectRoot.length).replace(/^\//, "");
    return rel ? `${basename(projectRoot)}/${rel}` : basename(projectRoot);
  }
  const parts = cwd.split("/").filter(Boolean);
  return parts.length <= 2 ? cwd : `…/${parts.slice(-2).join("/")}`;
}
