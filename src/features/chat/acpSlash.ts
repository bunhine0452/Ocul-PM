import type { AcpCommand } from "@/lib/bindings";

// PR-ACP9 — `/` 슬래시 커맨드 파싱 (순수 함수).
//
// 멘션(`@`)과 나란한 자리지만 규칙이 다르다. 슬래시는 **줄 맨 앞**에서만
// 명령이다 — 문장 중간의 `and/or`, 경로의 `src/lib` 까지 명령으로 잡으면
// 목록이 시도 때도 없이 튀어나온다.

export interface SlashQuery {
  /** `/` 뒤에 친 글자 (빈 문자열이면 방금 `/` 를 친 상태). */
  query: string;
}

/**
 * 입력이 슬래시 커맨드를 타이핑하는 중인지.
 *
 * 조건은 둘: 입력 **전체**가 `/` 로 시작하고, 아직 공백이 없다. 인자를 치기
 * 시작하면(`/plugin foo`) 명령은 이미 정해진 것이므로 목록을 닫는다.
 */
export function findSlashQuery(text: string): SlashQuery | null {
  if (!text.startsWith("/")) return null;
  const body = text.slice(1);
  if (/\s/.test(body)) return null;
  return { query: body };
}

/**
 * 이름·설명으로 거른 뒤 **이름이 앞에서 일치**하는 것을 위로 올린다.
 * `/plugin` 을 치는데 설명에 "plugin" 이 들어간 다른 명령이 먼저 오면
 * 엔터가 엉뚱한 것을 고른다.
 */
export function filterCommands(commands: readonly AcpCommand[], query: string): AcpCommand[] {
  const needle = query.toLowerCase();
  if (!needle) return [...commands];

  const matched = commands.filter(
    (command) =>
      command.name.toLowerCase().includes(needle) ||
      command.description.toLowerCase().includes(needle),
  );

  return matched.sort((a, b) => {
    const rank = (name: string) => (name.toLowerCase().startsWith(needle) ? 0 : 1);
    const byRank = rank(a.name) - rank(b.name);
    return byRank !== 0 ? byRank : a.name.localeCompare(b.name);
  });
}

/** 명령을 고른 결과 입력값. 인자를 받는 명령은 뒤에 공백을 남겨 이어 치게 한다. */
export function applyCommand(command: AcpCommand): string {
  return command.hint ? `/${command.name} ` : `/${command.name}`;
}
