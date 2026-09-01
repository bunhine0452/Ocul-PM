import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

// 테스트가 렌더 직전에 갈아끼우는 설정 행 — 목 팩토리는 hoist 되므로
// 참조만 담고 값은 실행 시점에 읽는다.
const settingsRows: Array<[string, string]> = [];

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "listProjects") return () => ok([]);
        if (prop === "goalList") return () => ok([]);
        if (prop === "subtaskList") return () => ok([]);
        // 언어를 **설정 경로로** 넘긴다 — SettingsProvider 의 effect 가 저장된
        // 값을 i18n 스토어로 밀어넣으므로 `setLangSetting` 직접 호출은 덮인다.
        if (prop === "settingsGetAll")
          return () => ok(settingsRows as Array<[string, string]>);
        if (prop === "dbHealth")
          return () => ok({ db_path: "", schema_version: 0, page_count: 0, integrity_ok: true });
        if (prop === "appInfo") return () => ok({ name: "ocul-pm", version: "0.0.0" });
        if (prop === "secretHas") return () => ok(false);
        // 테마 갤러리 — 사용자 테마 없음 (내장 5종은 정적이라 IPC 를 안 탄다).
        if (prop === "themeList") return () => ok([]);
        return () => ok(null);
      },
    }),
    events: new Proxy({}, {
      get: () => ({ listen: () => Promise.resolve(() => {}) }),
    }),
  };
});

vi.mock("@/api/oculpm", () => ({
  oculpmApi: new Proxy({}, {
    get: () => async () => ({ entries: [], sessions: [] }),
  }),
  OculpmApiError: class extends Error {},
}));

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { __resetLangForTests, setLangSetting } from "@/i18n";
// PR-UI 8a — TodayScreen/PlannerPanel moved to src/legacy/ (dead in ui_v2).
// Their a11y is now covered by the V2 equivalents (today_v2 / tools_v2). The
// still-live SettingsPanel (dashboard SettingsOverlay) keeps its check here.

const AXE_OPTIONS = {
  rules: {
    // jsdom does not implement computed-style cascading reliably; axe-core's
    // color-contrast check needs a real layout engine. Re-enable in CI/Playwright.
    "color-contrast": { enabled: false },
    // The 3 screens render as inner panes inside <Workspace> in production —
    // their root is not a landmark on its own.
    region: { enabled: false },
  },
} as const;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{children}</WorkspaceProvider>
    </SettingsProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  __resetLangForTests();
});

// i18n Phase 2 (03-i18n.md §8) — **양 언어로** 돌린다.
//
// `aria-label` 275곳이 번역 대상이었다. 번역 과정에서 라벨이 비거나
// (`aria-label={t("없는.키")}` → 키 문자열), 중괄호가 빠져 리터럴 `t("…")` 이
// 들어가거나, 아이콘 버튼의 라벨이 통째로 날아가는 실수가 실제로 나왔다
// (JSX 속성 중괄호 함정은 이 라운드에서 두 번 밟았다). axe 의 "버튼에
// 접근 가능한 이름이 있는가" 검사가 그걸 잡는다 — 한 언어만 돌리면
// 나머지 언어의 회귀를 못 본다.
describe.each([
  ["ko", [], "설정"],
  ["en", [["language", "en"]], "Settings"],
] as const)("a11y — SettingsPanel (%s)", (lang, rows, marker) => {
  beforeEach(() => {
    settingsRows.length = 0;
    for (const r of rows) settingsRows.push([...r] as [string, string]);
    setLangSetting(lang);
  });

  it("axe 위반이 없다", async () => {
    const { container, findAllByText } = render(
      <Wrap>
        <SettingsPanel />
      </Wrap>,
    );
    // **이 단언이 없으면 스위트가 공허해진다** — 언어 배선이 깨져 두 행이
    // 모두 한 언어로 렌더돼도 axe 는 통과하므로 나머지 언어의 회귀를 못 본다.
    // 실제로 이 단언이 하드코딩 영어 `<h2>Settings</h2>` 를 잡아냈다.
    expect((await findAllByText(marker)).length).toBeGreaterThan(0);
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("접근 가능한 이름이 빈 인터랙티브 요소가 없다", async () => {
    // axe 가 못 보는 각도 — 사전 키가 그대로 새어 나온 경우
    // (`t("없는.키")` 는 키 문자열을 돌려주므로 "비어 있지 않음" 은 통과한다).
    const { container } = render(
      <Wrap>
        <SettingsPanel />
      </Wrap>,
    );
    const leaked: string[] = [];
    for (const el of container.querySelectorAll("[aria-label],[title],[placeholder]")) {
      for (const attr of ["aria-label", "title", "placeholder"]) {
        const v = el.getAttribute(attr);
        if (v === null) continue;
        if (v.trim() === "") leaked.push(`${attr} 가 비어 있다: <${el.tagName.toLowerCase()}>`);
        // 사전 키가 그대로 렌더된 흔적 (`settings.foo.bar` 모양).
        if (/^[a-z][\w]*(\.[a-z][\w]*){2,}$/i.test(v.trim())) leaked.push(`${attr}="${v}"`);
      }
    }
    expect(leaked, `언어=${lang}`).toEqual([]);
  });
});
