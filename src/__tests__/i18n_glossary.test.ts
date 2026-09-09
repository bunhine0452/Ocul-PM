/**
 * 한국어 사전의 **용어집 계약** (2026-09-09 일관성 라운드).
 *
 * 배경: 같은 것을 두 가지로 부르면 사용자는 서로 다른 것이라고 읽는다. 라운드
 * 직전 실측 — "작업 일지" 18 / "작업일지" 7(**같은 화면**에서 갈렸다) ·
 * "폴더" 54 / "디렉토리" 3 / "디렉터리" 2 · 복사 확인 13종에 말투 셋.
 *
 * 이건 눈으로 못 잡는다(한 화면에 둘이 같이 뜨는 일이 드물다). 그래서 사전
 * 파일 자체에 못박는다 — `lint:i18n` 이 "번역되지 않은 한글" 을 보는 것과 같은
 * 자리에서, 이 스위트는 "**어떻게** 번역했는가" 를 본다.
 *
 * 정정 — 감사가 지적했지만 규칙이 아닌 것:
 *  · `Ocul-PM`(7) vs `ocul-pm`(37) 은 드리프트가 아니다. CLAUDE.md 가 적어 둔
 *    구분이다 — 산문의 제품명은 `Ocul-PM`, 식별자(설정 탭·인스턴스·플러그인
 *    슬러그·경로)는 `ocul-pm`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ko = readFileSync(join(__dirname, "..", "i18n", "ko.ts"), "utf8");
/**
 * 주석 줄은 뺀다 — 왜 그 표기를 버렸는지는 주석으로 남을 수 있어야 한다.
 *
 * **줄 단위로** 거른다. `/* … *\/` 를 정규식으로 지우면 사전 **값** 안의
 * `**\/*.tsx` 같은 글롭이 주석 시작으로 읽혀 그 뒤 수백 줄이 통째로 사라진다
 * (실제로 이 스위트를 처음 쓸 때 그렇게 세 키를 못 찾았다).
 */
const bare = ko
  .split("\n")
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join("\n");

describe("용어집 — 같은 것은 한 이름으로 부른다", () => {
  it.each([
    ["작업일지", "작업 일지"],
    ["디렉토리", "폴더"],
    ["디렉터리", "폴더"],
    ["기록없음", "기록 없음"],
  ])("%s → %s", (forbidden, preferred) => {
    const hits = bare.split("\n").filter((l) => l.includes(forbidden));
    expect(hits, `"${forbidden}" 대신 "${preferred}" — ${hits.length}곳`).toEqual([]);
  });

  it("화면 이름은 「플래너」다 — 영문 Planner 를 값에 쓰지 않는다", () => {
    // 키 이름(ai.chipPlanner)은 상관없다. **값** 안의 Planner 만 본다.
    const hits = bare
      .split("\n")
      .filter((l) => /:\s*"[^"]*\bPlanner\b/.test(l));
    expect(hits).toEqual([]);
  });
});

describe("영문 뒤 조사는 띄어 쓴다", () => {
  // 관례가 183곳이고 위반이 17곳이었다 — 다수가 규칙이다.
  // (`Codex를` → `Codex 를`. 한글 조사는 영문 단어에 붙지 않는다.)
  const VIOLATION = /[A-Za-z][A-Za-z0-9.+_-]*(은|는|이|가|을|를|의|에서|에|으로|로|와|과|도|만)(?=[ ,.…)"\\])/g;

  it("붙여 쓴 곳이 없다", () => {
    const hits: string[] = [];
    for (const line of bare.split("\n")) {
      for (const m of line.matchAll(VIOLATION)) hits.push(`${m[0]} — ${line.trim().slice(0, 70)}`);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

describe("복사 확인은 한 형태다", () => {
  /**
   * 순수 확인(무엇을 복사했는지만 말하는 것)은 「(무엇) 복사됨」이다.
   * 뒤에 할 일을 덧붙이는 것(`disc.promptCopied` 처럼 "붙여넣으세요")은
   * 종류가 다른 메시지라 여기 대상이 아니다 — 말투 통일은 {#copy-voice} 몫.
   */
  const PURE = [
    "common.copied",
    "ctx.manifest.copied",
    "disc.pathCopied",
    "term.block.copiedCommand",
    "term.block.copiedOutput",
    "today.honesty.copied",
    "today.standup.copiedAi",
    "today.standup.copiedPlain",
  ];

  it.each(PURE)("%s 가 「복사됨」으로 끝난다", (key) => {
    const m = bare.match(new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`));
    expect(m, `${key} 가 사전에 없다`).toBeTruthy();
    expect(m![1], `${key} = "${m![1]}"`).toMatch(/복사됨( \(.*\))?$/);
  });

  it("느낌표·체크글리프로 튀는 확인이 없다", () => {
    const hits = bare
      .split("\n")
      .filter((l) => /"[^"]*복사[^"]*(!|✓)"/.test(l));
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

describe("한 문자열 안에서 화자가 바뀌지 않는다", () => {
  /**
   * **평서 종결만** 본다. 「확인하세요」(명령형 해요체)와 「실행합니다」(평서
   * 합쇼체)가 한 문장에 있는 건 한국어 UI 의 정상 조합이다 — 서법이 다르다.
   * 문제는 평서문끼리 갈리는 것이다:
   *
   *   "이 컴퓨터에만 **남습니다** — 원장에는 쓰지 **않아요**"
   *
   * 라운드 직전 실측 24건. 전부 그 네임스페이스의 우세한 말투로 맞췄다.
   *
   * 사전 전체의 합쇼 532 / 해요 396 은 아직 갈려 있다 — 그건 제품 목소리를
   * 하나로 정하는 결정이라 {#copy-voice} 에 남아 있다. 이 스위트가 막는 것은
   * "**한 문자열 안**에서 화자가 바뀌는 것" 뿐이다.
   */
  const END = "(?=[\\s.,)\\]\"—·…]|\\\\n|$)";
  const HAP = new RegExp(`(습니다|입니다|됩니다)${END}`);
  const HAE = new RegExp(`(었어요|았어요|해요|예요|이에요|네요|돼요|어요|아요)${END}`);

  it("평서 종결이 한 문자열 안에서 섞이지 않는다", () => {
    const mixed: string[] = [];
    for (const line of bare.split("\n")) {
      const m = /"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"/.exec(line);
      if (!m) continue;
      if (HAP.test(m[2]) && HAE.test(m[2])) mixed.push(`${m[1]} — ${m[2].slice(0, 70)}`);
    }
    expect(mixed, mixed.join("\n")).toEqual([]);
  });
});

describe("에러는 로그가 아니라 메시지다", () => {
  /**
   * 「명사 실패: <영문 원문>」 은 로그를 UI 에 붙여넣은 것이다. 라운드 직전
   * 41건이었고, `tError()` 가 못 번역한 IO 오류가 그대로 뒤에 붙어
   * "압축 실패: Could not open database … (os error 2)" 가 한국어 UI 에 떴다.
   *
   * 원문을 지울 수는 없다(진단 정보다). 대신 **무엇이 안 됐는지를 한국어 문장으로
   * 먼저** 말하고 원문을 뒤로 민다 — "데이터베이스를 압축하지 못했습니다 — {error}".
   */
  it("「… 실패: {error}」 꼴이 없다", () => {
    const hits: string[] = [];
    for (const line of bare.split("\n")) {
      const m = /"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"/.exec(line);
      if (!m) continue;
      if (/실패\s*[:—]\s*\{(error|detail|message)\}/.test(m[2])) hits.push(`${m[1]} — ${m[2]}`);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
