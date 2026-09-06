import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SETTINGS_INDEX, entryLabel, searchSettings } from "@/features/settings/settingsIndex";
import { ko } from "@/i18n/ko";
import { en } from "@/i18n/en";

// ─── 3.0 {#settings-search} — 색인이 낡지 않게 붙잡는다 ────────────────────
//
// `settingsIndex.ts` 는 손으로 적힌 표다. 손으로 적힌 표는 반드시 낡는다 —
// 낡지 않게 하는 유일한 방법은 **원본을 다시 훑어 비교하는 것**이다. 이
// 스위트가 설정 파일들에서 라벨 키를 뽑아, 색인에 없는 항목이 있으면 이름을
// 대며 실패한다. 새 설정을 넣은 사람이 여기서 걸리고, 고치는 방법은
// settingsIndex.ts 에 한 줄 넣는 것이다.

const SETTINGS = join(__dirname, "../features/settings");

/** 설정 파일 → 그 파일이 그려지는 탭. settingsIndex 를 만든 표와 같다. */
const FILE_TAB: Array<[string, string]> = [
  ["tabs/AppearanceTab.tsx", "appearance"],
  ["tabs/LlmTab.tsx", "llm"],
  ["CodeSettings.tsx", "code"],
  ["tabs/IndexingTab.tsx", "indexing"],
  ["tabs/GraphTab.tsx", "graph"],
  ["tabs/DataTab.tsx", "data"],
  ["config/DeclarativeConfigSection.tsx", "data"],
  ["import/ConversationImportSection.tsx", "data"],
  ["OculpmSettings.tsx", "oculpm"],
  ["ClaudePluginBlock.tsx", "oculpm"],
  ["CodexPluginBlock.tsx", "oculpm"],
  ["CodexMcpServerBlock.tsx", "oculpm"],
  ["A2aEndpointBlock.tsx", "oculpm"],
  ["plugins/PluginBundlesBlock.tsx", "oculpm"],
  ["plugins/NotHonoredNotice.tsx", "oculpm"],
  ["tabs/ContextTab.tsx", "context"],
  ["automation/AutomationTab.tsx", "automation"],
  ["automation/AutomationEditor.tsx", "automation"],
  ["automation/AutomationHistory.tsx", "automation"],
  ["automation/AutomationTroubleshooting.tsx", "automation"],
  ["MobileSettings.tsx", "mobile"],
  ["tabs/DiagnosticsTab.tsx", "diagnostics"],
  ["tabs/DoctorSection.tsx", "diagnostics"],
  ["tabs/FiringInsights.tsx", "diagnostics"],
  ["tabs/UpdateTab.tsx", "update"],
];

/**
 * 색인에 넣지 않는 키 — 사유는 셋뿐이다.
 *  · aria/tooltip 라벨: 사람이 찾는 **이름**이 아니다.
 *  · 동작 버튼(삭제·메뉴): 설정 항목이 아니라 행동이다.
 *  · 같은 것을 가리키는 중복 라벨(세그먼트 vs 섹션 제목).
 * 늘리지 말고 줄이는 방향으로만.
 */
const NOT_INDEXED = new Set([
  "settings.accent.aria",
  "op.tabsAria",
  "plugins.source.aria",
  "plugins.remove",
  "op.delete",
  "automation.card.menu",
  "automation.cond.remove",
  "op.scope.project",
  "op.scope.machine",
  "ctx.recall.forgetShort",
  "settings.termFont.input",
  "settings.termFont.range",
]);

/** 설명문은 항목이 아니다 — 결과 줄로 읽히지 않는 문장이다. */
const isProse = (key: string) => /(\.desc|Desc|Hint|Note|\.aria|Aria)$/.test(key);

const LABEL_RE = /(?:title|label|description)=\{t\("([a-zA-Z0-9_.:-]+)"/g;

function labelKeysOf(file: string): string[] {
  const src = readFileSync(join(SETTINGS, file), "utf8");
  return [...src.matchAll(LABEL_RE)].map((m) => m[1]);
}

describe("설정 색인은 원본을 따라간다", () => {
  it("탭이 그리는 라벨이 전부 색인에 있다", () => {
    const indexed = new Set(SETTINGS_INDEX.map((e) => `${e.tab}:${e.key}`));
    const missing: string[] = [];
    for (const [file, tab] of FILE_TAB) {
      for (const key of labelKeysOf(file)) {
        if (NOT_INDEXED.has(key) || isProse(key)) continue;
        if (!indexed.has(`${tab}:${key}`)) missing.push(`${tab}:${key}  (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("색인의 키는 전부 실재한다 — 양 언어 모두", () => {
    for (const entry of SETTINGS_INDEX) {
      expect(ko[entry.key], entry.key).toBeTruthy();
      expect(en[entry.key], entry.key).toBeTruthy();
      if (entry.section) expect(ko[entry.section], entry.section).toBeTruthy();
    }
  });

  it("12탭이 하나도 빠지지 않는다 — 검색이 못 닿는 탭이 생기면 검색이 거짓말이 된다", () => {
    const tabs = new Set(SETTINGS_INDEX.map((e) => e.tab));
    expect([...tabs].sort()).toEqual(
      [
        "appearance",
        "automation",
        "code",
        "context",
        "data",
        "diagnostics",
        "graph",
        "indexing",
        "llm",
        "mobile",
        "oculpm",
        "update",
      ].sort(),
    );
    expect(SETTINGS_INDEX.length).toBeGreaterThan(100);
  });
});

describe("검색", () => {
  it("빈 질의는 아무것도 안 준다 — 목록이 통째로 쏟아지지 않게", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("한국어 이름으로 찾는다", () => {
    const hits = searchSettings(ko["settings.code.autoSave"].slice(0, 4));
    expect(hits.some((h) => h.key === "settings.code.autoSave" && h.tab === "code")).toBe(true);
  });

  it("영어로도 찾는다 — UI 가 한국어여도 키/영문 이름이 손에 붙은 사람이 있다", () => {
    const hits = searchSettings("autoSave");
    expect(hits.some((h) => h.key === "settings.code.autoSave")).toBe(true);
  });

  it("이름이 질의로 시작하는 항목이 먼저 온다", () => {
    const label = ko["settings.chunk.size"];
    const hits = searchSettings(label);
    expect(hits[0]?.key).toBe("settings.chunk.size");
  });

  it("없는 것은 없다고 한다", () => {
    expect(searchSettings("zzzznotasetting")).toEqual([]);
  });

  it("표시 이름에서 자리표시자를 지운다", () => {
    // 슬라이더 라벨은 값을 품는다 — 목록엔 값이 없으므로 이름만 남아야 한다.
    for (const entry of SETTINGS_INDEX) expect(entryLabel(entry.key)).not.toMatch(/[{}]/);
  });
});
