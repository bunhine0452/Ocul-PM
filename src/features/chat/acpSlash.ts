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
 * **앱이 직접 처리하는** 명령들.
 *
 * 어댑터가 광고하는 목록에는 없다 — `/clear` 는 어댑터가 대놓고 걸러 내고
 * (그쪽 UX 가 CLI 터미널에 있다), `/continue` 와 `/remote-control` 은 애초에
 * ACP 요청이 없다. 그래도 사용자는 CLI 에서 쓰던 이름을 그대로 친다.
 *
 * 목록에 넣지 않으면 `/` 를 눌러도 안 보이고, 쳐 봐야 아무 일도 안 일어난 것처럼
 * 보인다. 그래서 **여기 한 곳**에 적고 메뉴와 처리기가 같은 목록을 본다.
 */
export const LOCAL_COMMANDS = [
  { name: "usage", descriptionKey: "acp.cmd.usage" },
  { name: "clear", descriptionKey: "acp.cmd.clear" },
  { name: "continue", descriptionKey: "acp.cmd.continue" },
  { name: "remote-control", descriptionKey: "acp.cmd.remoteControl" },
] as const;

/**
 * 어댑터 목록에 앱 명령을 얹는다. **어댑터가 이긴다** — 언젠가 같은 이름을
 * 광고하기 시작하면 그쪽이 진짜이므로, 우리 설명이 남아 거짓말을 하면 안 된다.
 *
 * 설명 문구는 부르는 쪽이 번역해 넘긴다 (이 모듈은 순수하게 둔다).
 */
export function withLocalCommands(
  commands: readonly AcpCommand[],
  describe: (key: string) => string,
): AcpCommand[] {
  const known = new Set(commands.map((command) => command.name));
  return [
    ...commands,
    ...LOCAL_COMMANDS.filter((command) => !known.has(command.name)).map((command) => ({
      name: command.name,
      description: describe(command.descriptionKey),
      hint: null,
    })),
  ];
}

/**
 * 목록 맨 위에 고정할 명령들.
 *
 * 어댑터가 주는 순서는 알파벳순이라 자주 쓰는 것이 백 개 아래 묻힌다.
 * `/` 만 쳤을 때 바로 보여야 하는 것들을 앞으로 끌어올린다.
 */
const PINNED = ["usage", "continue", "clear", "compact", "plugin"] as const;

/**
 * 이름·설명으로 거른 뒤 **이름이 앞에서 일치**하는 것을 위로 올린다.
 * `/plugin` 을 치는데 설명에 "plugin" 이 들어간 다른 명령이 먼저 오면
 * 엔터가 엉뚱한 것을 고른다.
 *
 * 질의가 비어 있을 때(= 방금 `/` 를 쳤을 때)는 자주 쓰는 것부터 보여 준다.
 */
export function filterCommands(commands: readonly AcpCommand[], query: string): AcpCommand[] {
  const needle = query.toLowerCase();
  if (!needle) {
    const pinRank = (name: string) => {
      const at = PINNED.indexOf(name as (typeof PINNED)[number]);
      return at === -1 ? PINNED.length : at;
    };
    return [...commands].sort((a, b) => {
      const byPin = pinRank(a.name) - pinRank(b.name);
      return byPin !== 0 ? byPin : 0;
    });
  }

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
