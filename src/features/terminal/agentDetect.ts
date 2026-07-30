/**
 * 터미널에서 실행된 명령줄이 **코딩 에이전트**인지 판정한다 (순수 함수).
 *
 * 입력은 OSC 133;C 가 실어 온 명령줄이다. 판정은 **명령 위치의 토큰만** 본다 —
 * `echo claude` 나 `git commit -m "ask claude"` 는 에이전트 실행이 아니고,
 * 이걸 부분 문자열 매칭으로 잡으면 유령 세션이 생긴다.
 *
 * 반환하는 `id` 는 가능한 한 `oculpm::agents` 어댑터 id 와 맞춘다(`claude-code`,
 * `cursor`, `gemini-cli`, …). 훅 브리지의 `HOOK_AGENT_LABEL` 과 같은 값이라야
 * 한 세션에 서로 다른 라벨이 붙지 않는다.
 */

export interface AgentRun {
  /** `oculpm::agents` 어댑터 id (어댑터가 없는 도구는 CLI 이름 그대로). */
  id: string;
  /** 사람에게 보여줄 이름. */
  label: string;
}

/** 명령 앞에 흔히 붙는, 실제 실행 대상이 아닌 래퍼들. */
const WRAPPERS = new Set(["sudo", "command", "nohup", "time", "exec", "env", "nice", "caffeinate"]);

/** 패키지 러너 — 실제 대상은 그 다음 인자다. */
const RUNNERS = new Set(["npx", "bunx", "pnpx"]);

/** CLI 이름(basename 소문자) → 에이전트. */
const AGENTS: Readonly<Record<string, AgentRun>> = {
  claude: { id: "claude-code", label: "Claude Code" },
  "claude-code": { id: "claude-code", label: "Claude Code" },
  "cursor-agent": { id: "cursor", label: "Cursor" },
  gemini: { id: "gemini-cli", label: "Gemini CLI" },
  codex: { id: "codex", label: "Codex" },
  aider: { id: "aider", label: "Aider" },
  windsurf: { id: "windsurf", label: "Windsurf" },
  cline: { id: "cline", label: "Cline" },
  opencode: { id: "opencode", label: "opencode" },
};

/** 파이프라인·체인 분리 — 각 세그먼트의 첫 토큰만 명령 위치다. */
const SEGMENT_SPLIT = /\s*(?:\|\||&&|[;|&])\s*/;

/** `FOO=bar` 형태의 선행 환경변수 할당. */
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * 명령줄에서 에이전트를 찾는다. 없으면 `null`.
 *
 * 파이프라인·`&&` 체인은 세그먼트별로 보고 **처음 발견된** 것을 쓴다
 * (`git pull && claude` → Claude Code).
 */
export function detectAgent(command: string): AgentRun | null {
  for (const segment of command.split(SEGMENT_SPLIT)) {
    const agent = detectInSegment(segment);
    if (agent) return agent;
  }
  return null;
}

function detectInSegment(segment: string): AgentRun | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  // 선행 env 할당과 래퍼(sudo/time/…)를 걷어낸다.
  while (i < tokens.length && (ENV_ASSIGN.test(tokens[i]) || WRAPPERS.has(basename(tokens[i])))) {
    i += 1;
  }
  if (i >= tokens.length) return null;

  let name = basename(tokens[i]);
  const isDlx = (name === "pnpm" || name === "yarn") && tokens[i + 1] === "dlx";
  if (RUNNERS.has(name) || isDlx) {
    // 패키지 러너 — 플래그를 건너뛰고 첫 패키지 인자를 대상으로 삼는다.
    let j = isDlx ? i + 2 : i + 1;
    while (j < tokens.length && tokens[j].startsWith("-")) j += 1;
    if (j >= tokens.length) return null;
    name = packageBinName(tokens[j]);
  }
  return AGENTS[name] ?? null;
}

/** 경로에서 파일명만. `.exe`/`.cmd` 는 떼어 Windows 표기를 흡수한다. */
function basename(token: string): string {
  const tail = token.split(/[/\\]/).pop() ?? token;
  return tail.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/** `@anthropic-ai/claude-code@latest` → `claude-code`. */
function packageBinName(spec: string): string {
  const withoutVersion = spec.replace(/(?<=.)@[^@/]*$/, "");
  const tail = (withoutVersion || spec).split("/").pop() ?? spec;
  return tail.toLowerCase();
}
