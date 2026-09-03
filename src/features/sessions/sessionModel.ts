import type { A2aOverview, AgentCard, Group, Lease, Liveness, Task } from "@/lib/bindings";
import { agentLabel } from "@/features/today/agentColor";
import { t, type I18nKey } from "@/i18n";

// 세션 보드의 **순수한 부분** (docs/a2a/00-master-plan.md D8).
//
// 이 화면의 진짜 과제는 묶기가 아니라 **구별**이다. 한 프로젝트에 Claude Code
// 터미널 세션이 넷 붙으면 원장이 주는 이름은 전부 `claude-code-term-<pid>` 라,
// 화면이 provider 만 그리면 사용자는 네 줄 중 무엇을 고르는지 모른 채 고른다.
//
// 그래서 한 세션을 세울 때 **다섯 가지 사실을 겹쳐서** 그린다. 각각은 약하지만
// 겹치면 사람이 알아본다:
//
//   ① 별명        — 사용자가 붙인 것. 가장 강하지만 처음엔 없다.
//   ② 등록 이름    — `agent_register` 가 받은 `name`. 준 세션만 있다.
//   ③ 표면·pid    — 앱 안인가 터미널인가, 어느 프로세스인가.
//   ④ 잡은 구역    — **무엇을 하고 있는가.** 이름이 없을 때 가장 잘 듣는다.
//   ⑤ 마지막 활동  — 방금 친 세션이 어느 것인지 사용자는 안다.
//
// 화면(React)에서 떼어 둔 이유는 이 겹침 규칙이 회귀가 잦은 자리이기 때문이다.

/** 한 세션이 화면에 설 때의 모습 — 원장 사실 + 사용자가 붙인 것. */
export interface SessionSeat {
  id: string;
  card: AgentCard;
  liveness: Liveness;
  /** 사용자가 붙인 별명 (없으면 null). */
  alias: string | null;
  /** 제목 줄에 설 이름 — 별명 > 쓸모 있는 등록 이름 > provider 라벨. */
  label: string;
  /**
   * 등록 이름을 부제로 또 보일 것인가.
   *
   * 어댑터가 준 `name` 은 npm 패키지 이름(`@agentclientprotocol/…`)이라 사람이
   * 읽을 것이 못 되는 경우가 많다. 쓸모 있을 때만 한 줄 더 준다.
   */
  registeredName: string | null;
  /** 이 세션이 쥐고 있는 구역. */
  leases: Lease[];
  /** 이 세션이 끼어 있는 안 끝난 태스크. */
  openTasks: Task[];
}

/** 팀 하나 — 그룹 원장 + 그 자리에 설 세션들. */
export interface TeamLane {
  group: Group;
  members: SessionSeat[];
  /**
   * 원장에는 있는데 참여자 목록에 없는 멤버 id.
   *
   * 죽은 세션이 남은 그룹은 백엔드가 걷지만(`groups::sweep`), 살아 있는 멤버가
   * 둘 이상이면 그룹은 살아 있고 죽은 하나만 빠진다. 그 사실을 감추면 "셋인 줄
   * 알았는데 둘"이 되므로 세어서 말한다.
   */
  goneCount: number;
}

export interface BoardModel {
  teams: TeamLane[];
  unbound: SessionSeat[];
  /** 승인을 기다리며 멈춰 있는 태스크. */
  waiting: Task[];
}

/** 등록 이름이 사람에게 쓸모가 있는가 — 패키지 이름은 이름이 아니다. */
export function isUsefulName(name: string, provider: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("@") || trimmed.includes("/")) return false;
  // provider 를 그대로 되돌려준 것은 새 정보가 아니다 (`agent_register` 기본값).
  return trimmed.toLowerCase() !== provider.toLowerCase();
}

/** 이 세션을 뭐라고 부를 것인가 (위 ①②③ 순서). */
export function seatLabel(card: AgentCard, alias: string | null): string {
  const nick = alias?.trim();
  if (nick) return nick;
  if (isUsefulName(card.name, card.provider)) return card.name.trim();
  return agentLabel(card.provider);
}

/** 마지막 활동을 사람의 시간으로 — 사전 키와 보간값을 함께 준다. */
export function agoKey(iso: string, now: number): { key: I18nKey; n: number } | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return { key: "sessions.ago.now", n: 0 };
  if (mins < 60) return { key: "sessions.ago.minutes", n: mins };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { key: "sessions.ago.hours", n: hours };
  return { key: "sessions.ago.days", n: Math.floor(hours / 24) };
}

/** 위 결과를 문장으로 (없으면 null — 시각을 모르는 것은 죽은 것이 아니다). */
export function agoText(iso: string, now: number): string | null {
  const ago = agoKey(iso, now);
  if (!ago) return null;
  return ago.key === "sessions.ago.now" ? t(ago.key) : t(ago.key, { n: ago.n });
}

function seatOf(
  card: AgentCard,
  liveness: Liveness,
  aliases: Record<string, string>,
  leases: Lease[],
  tasks: Task[],
): SessionSeat {
  const alias = aliases[card.agent_id]?.trim() || null;
  return {
    id: card.agent_id,
    card,
    liveness,
    alias,
    label: seatLabel(card, alias),
    registeredName: isUsefulName(card.name, card.provider) && alias ? card.name.trim() : null,
    leases: leases.filter((l) => l.holder === card.agent_id),
    openTasks: tasks.filter((tk) => tk.from === card.agent_id || tk.to === card.agent_id),
  };
}

/**
 * 원장 한 벌 + 사용자의 이름표 → 보드.
 *
 * 팀 차례는 원장 순서(사용자가 묶은 순서)를 그대로 따르고, 묶이지 않은 세션은
 * **마지막 활동이 새로운 것부터** 세운다 — 방금 친 세션이 맨 위에 있는 것이
 * 넷 중 하나를 고를 때 제일 빠른 길이다.
 */
export function buildBoard(
  overview: A2aOverview,
  aliases: Record<string, string>,
): BoardModel {
  const seats = new Map<string, SessionSeat>();
  for (const p of overview.participants) {
    seats.set(
      p.card.agent_id,
      seatOf(p.card, p.liveness, aliases, overview.leases, overview.open_tasks),
    );
  }

  const teams: TeamLane[] = overview.groups.map((group) => {
    const members = group.members.map((id) => seats.get(id)).filter((s): s is SessionSeat => !!s);
    return { group, members, goneCount: group.members.length - members.length };
  });

  const bound = new Set(overview.groups.flatMap((g) => g.members));
  const unbound = [...seats.values()]
    .filter((s) => !bound.has(s.id))
    .sort((a, b) => Date.parse(b.card.heartbeat_at) - Date.parse(a.card.heartbeat_at));

  return { teams, unbound, waiting: overview.open_tasks.filter((tk) => tk.state === "submitted") };
}

/**
 * 이 세션들을 저 팀에 넣었을 때의 멤버 목록.
 *
 * 백엔드가 "한 세션은 그룹 하나에만" 을 이미 지키지만(`groups::set_members` 가
 * 옛 자리에서 뺀다), 중복은 여기서 걸러야 한다 — 같은 id 가 둘이면 백엔드가
 * 통째로 거절하고 사용자는 이유를 모른 채 실패를 본다.
 */
export function withMembers(current: string[], added: string[]): string[] {
  const seen = new Set(current);
  return [...current, ...added.filter((id) => !seen.has(id))];
}
