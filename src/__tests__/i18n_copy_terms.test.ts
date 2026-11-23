/**
 * 사전 용어표 계약 (사랑받는 앱 라운드 love-round-20261123 G3).
 *
 * 영어 사전은 한국어에 있던 「용어집」 게이트(`i18n_glossary.test.ts`)가 없어서 같은 것을 entry · journal ·
 * record 로 섞어 불렀다. 표는 `en.ts` 머리 주석(GLOSSARY)이 SSOT 이고, 이 스위트는 왼쪽 열(버린 말)이 값에
 * 돌아오지 못하게 막는다. 한국어에는 「새 판」 · 「리프」 같은 안 풀린 말을 막는 줄만 더한다.
 *
 * 오류 문구는 **다음 걸음**을 말해야 한다 — 원인만 말하면 사용자는 멈춘다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";
import { lowerFirst } from "@/features/settings/SettingsPage";

const enSrc = readFileSync(join(__dirname, "..", "i18n", "en.ts"), "utf8");

/** 값만 (주석 줄 제외) — 키가 같은 줄이든 다음 줄이든 정규식이 줄바꿈을 넘어 잡는다. */
const values = (dict: Record<string, string>) => Object.entries(dict);

describe("영어 용어표 — 버린 말이 돌아오지 않는다", () => {
  const FORBIDDEN: Array<[RegExp, string]> = [
    [/\bWork [Jj]ournal\b/, "화면은 Journal"],
    [/\bNo journal\b(?! entr)/, "칩은 No entry"],
    [/\bwithout a journal\b(?! entry)/, "without a journal entry · not in the journal"],
    [/\bin (a|any) journal\b(?! entry)/i, "in a journal entry"],
    [/\bIn journal\b/, "In an entry"],
    [/\brecord tools?\b/i, "journal tools"],
    [/\b(journal|your|the|its|these|those|existing|project) records\b/i, "entry · 파일 (record 는 .oculpm 폴더 이름에만)"],
    [/\bleaf\b|\bleaves\b(?! the)/i, "plan item · open item"],
    [/\bverdicts?\b/i, "check result · Passed / Failed"],
    [/\bDeferred\b/, "Carried over"],
    [/\bElsewhere\b/, "Other OS"],
    [/\bGot it\b/, "Dismiss"],
    [/\bRang the bell\b/, "Terminal bell"],
    [/\bOnly here\b/, "Not on other machines"],
    [/\bArrived\b/, "From other machines"],
    [/\bNo news lately\b/, "Quiet"],
    [/\bManual entry\b/, "Write an entry"],
  ];

  it.each(FORBIDDEN)("%s → %s", (re, preferred) => {
    const hits = values(en)
      .filter(([, v]) => re.test(v))
      .map(([k, v]) => `${k} — ${v.slice(0, 70)}`);
    expect(hits, `「${preferred}」 로 — ${hits.length}곳`).toEqual([]);
  });

  it("머리 주석에 용어표가 있다 — 표가 SSOT", () => {
    expect(enSrc).toMatch(/GLOSSARY/);
    for (const term of ["Journal", "journal entry", "journal tools", "record folder", "check command", "Carried over"]) {
      expect(enSrc, term).toContain(term);
    }
  });

  it("화면 이름은 Journal 하나 — 탭 · 팔레트 묶음 · 단축키 묶음이 같다", () => {
    expect(en["nav.journal"]).toBe("Journal");
    expect(en["palette.group.journal"]).toBe(en["nav.journal"]);
    expect(en["keys.g.journal"]).toBe(en["nav.journal"]);
  });

  it("「일지 없음」 칩 넷은 한 낱말로 — Today · 변경 · 나란히 돌리기 · 터미널", () => {
    const chips = [
      en["today.chip.noJournal"],
      en["today.check.kind.unrecorded"],
      en["diff.unrecorded.label"],
      en["race.noJournal"],
    ];
    expect(new Set(chips)).toEqual(new Set(["No entry"]));
    expect(en["terminal.noRecord"].toLowerCase()).toBe("no entry");
  });

  it("오늘의 칩은 한두 낱말 — 칩 칸이 고정 폭이다", () => {
    const chips = Object.entries(en).filter(([k]) => k.startsWith("today.check.kind."));
    expect(chips.length).toBeGreaterThan(8);
    for (const [k, v] of chips) expect(v.split(/\s+/).length, `${k} = ${v}`).toBeLessThanOrEqual(2);
  });
});

describe("한국어 — 안 풀린 말을 쓰지 않는다", () => {
  const FORBIDDEN: Array<[RegExp, string]> = [
    [/새 판|옛 판|깐 판/, "새 버전 · 오래된 · 업데이트"],
    [/리프/, "미완 항목 · 항목"],
    [/받아 온/, "내려받은 · 다른 기기에서 온"],
    [/이 기기에만/, "다른 기기에 없는"],
    [/닫힌 계획의 미완/, "닫힌 계획에 남은 항목"],
  ];
  it.each(FORBIDDEN)("%s → %s", (re, preferred) => {
    const hits = values(ko)
      // 프롬프트(Claude 에게 보내는 글)는 사람 말 그대로 쓴다 — 칩 · 숫자 줄의 이름만 본다.
      .filter(([k, v]) => !k.endsWith("Prompt") && re.test(v))
      .map(([k, v]) => `${k} — ${v.slice(0, 70)}`);
    expect(hits, `「${preferred}」 로 — ${hits.length}곳`).toEqual([]);
  });
});

describe("오류 · 빈 상태는 다음 걸음을 말한다", () => {
  it("캐시 · 데이터베이스 오류는 설정의 「다시 만들기」 로 안내한다 (두 언어, 단추 이름 그대로)", () => {
    for (const dict of [ko, en]) {
      for (const key of ["err.code.sqlite", "err.code.db"] as const) {
        expect(dict[key], `${key} 에 진단 원문 자리`).toContain("{detail}");
        expect(dict[key], `${key} 가 단추 이름을 말한다`).toContain(dict["prefs.data.rebuild"]);
        expect(dict[key], `${key} 가 설정의 칸 이름을 말한다`).toContain(dict["prefs.data.title"]);
      }
    }
  });

  it("앱 안 작업 중단은 다시 켜라고 말하고, 내부 이름(처리기 · worker)을 쓰지 않는다", () => {
    expect(ko["err.code.actor_closed"]).toContain("다시 켜");
    expect(ko["err.code.actor_closed"]).not.toMatch(/처리기|세션/);
    expect(en["err.code.actor_closed"]).toMatch(/relaunch/i);
    expect(en["err.code.actor_closed"]).not.toMatch(/worker|session/i);
  });

  it("확인 명령이 없다는 말은 적을 줄(`확인 명령:` · `Check:`)을 알려 준다", () => {
    expect(ko["plan.judge.noCheck"]).toContain("확인 명령:");
    expect(en["plan.judge.noCheck"]).toContain("Check:");
  });

  it("고아가 된 마켓플레이스 칩은 다음 걸음(다시 설치)을 말한다", () => {
    expect(ko["prefs.agents.orphan"]).toContain("다시 설치");
    expect(en["prefs.agents.orphan"]).toMatch(/reinstall/i);
  });

  it("파일 작업 오류는 권한을 보라고 말한다", () => {
    expect(ko["err.code.io"]).toContain("권한");
    expect(en["err.code.io"]).toMatch(/permission/i);
  });
});

describe("걷은 기능의 오류 문구는 사전에 없다 (호출자 0)", () => {
  const DEAD = [
    "err.code.acp_not_running",
    "err.noApiKey",
    "err.previewTooLarge",
    "err.enterTitle",
    "err.enterToken",
    "err.noWorkInPeriod",
    "err.retroEmpty",
    "err.resultEmpty",
    "err.fileExists",
    "err.accessDenied",
    "err.nothingToImport",
    "err.browserOpenFailed",
    "err.keyringUnavailable",
    "err.linuxPasteFiles",
  ];
  it.each(DEAD)("%s", (key) => {
    expect(key in ko).toBe(false);
    expect(key in en).toBe(false);
  });

  it("사전 머리말에 걷은 화면(ACP · 편집기 · 닥터) 주석이 남지 않는다", () => {
    const comments = enSrc
      .split("\n")
      .filter((l) => /^\s*\/\//.test(l))
      .join("\n");
    expect(comments).not.toMatch(/ACP|ide-completion|vscode-borrows|Doctor|First-record card/);
  });
});

describe("설정 요약 줄 — 칩 문구를 문장 가운데 쓸 때 첫 글자를 낮춘다", () => {
  it.each([
    ["Not installed", "not installed"],
    ["Marketplace missing · reinstall", "marketplace missing · reinstall"],
    ["Couldn't write", "couldn't write"],
    ["MCP binary missing", "MCP binary missing"],
    ["4.3.0 → 4.4.0", "4.3.0 → 4.4.0"],
    ["설치 안 됨", "설치 안 됨"],
  ])("%s → %s", (input, out) => {
    expect(lowerFirst(input)).toBe(out);
  });
});
