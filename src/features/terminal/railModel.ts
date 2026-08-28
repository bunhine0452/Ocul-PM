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
import { canAutoRename } from "./tabTitle";

/** 카드 좌측 점·테두리 색을 고르는 값. `off` = 셸 통합이 없는 세션. */
export type RailTone = "running" | "ok" | "fail" | "idle" | "off";

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
}

export interface RailInput {
  id: string;
  label: string;
  /** 이 탭의 **포커스된 페인**의 셸 상태. 통합이 없으면 `undefined`. */
  shell: ShellState | undefined;
  paneCount: number;
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
  const { id, label, shell, paneCount } = input;
  const summary = shell ? summarizeShell(shell) : null;
  const agent = shell?.running ? detectAgent(shell.running.command) : null;

  if (!summary) {
    // 셸 통합이 없는 세션 — cwd 조차 모른다. 이름만 그린다.
    return { id, label, tone: "off", agent: null, detail: "", elapsedMs: null, paneCount };
  }

  return {
    id,
    label: agent && canAutoRename(label) ? agent.label : label,
    tone: summary.tone,
    agent,
    detail: summary.text,
    elapsedMs: shell?.running ? Math.max(0, now - shell.running.startedAt) : null,
    paneCount,
  };
}

/** 하나라도 돌고 있으면 레일이 1초 타이머를 켠다 — 아니면 끈다. */
export function anyRunning(items: readonly RailItem[]): boolean {
  return items.some((item) => item.elapsedMs !== null);
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
