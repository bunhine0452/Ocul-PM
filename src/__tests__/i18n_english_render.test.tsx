import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// 영어 모드 렌더 계약 (docs/20260811_three-features/03-i18n.md §8).
//
// 정적 스캐너(`pnpm lint`)는 **소스에 한글 리터럴이 있는가**만 본다. 그래서
// 구조적으로 못 잡는 것들이 남는다:
//
//  - 상수 테이블에 남은 한글이 `t()` 를 안 거치고 렌더까지 흘러가는 경우
//  - `memo` 컴포넌트가 모듈 `t()` 를 써서 언어 전환에 안 따라오는 경우
//  - 사전 키는 있는데 소비처가 옛 문자열을 계속 쓰는 경우
//
// 그래서 **실제로 그려서** 한글이 남는지 본다. 이 스위트만 언어를 `en` 으로
// 뒤집는다 — 나머지 스위트는 `setup.ts` 가 `ko` 로 고정한 채로 둔다.

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "listProjects") return () => ok([]);
          // 언어를 **설정 경로로** 넘긴다. `setLangSetting("en")` 만으로는
          // 부족하다 — SettingsProvider 의 effect 가 저장된 값을 스토어로
          // 밀어넣으며 덮어쓴다 (setup.ts 가 같은 함정을 기록해 뒀다).
          // 이렇게 해야 배선 전체(DB → 컨텍스트 → 스토어 → t())가 검증된다.
          if (prop === "settingsGetAll")
            return () => ok([["language", "en"]] as Array<[string, string]>);
          if (prop === "conversationList") return () => ok([]);
          if (prop === "planList") return () => ok([]);
          if (prop === "oculpmListJournalEntries") return () => ok([]);
          if (prop === "oculpmListSessions") return () => ok([]);
          if (prop === "claudePluginStatus") return () => Promise.resolve({ installed: false, path: null });
          if (prop === "appInfo") return () => ok({ name: "ocul-pm", version: "0.0.0" });
          if (prop === "secretHas") return () => ok(false);
          if (prop === "dbHealth")
            return () => ok({ db_path: "", schema_version: 0, page_count: 0, integrity_ok: true });
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

vi.mock("@/api/oculpm", () => ({
  oculpmApi: new Proxy({}, { get: () => async () => ({ entries: [], sessions: [] }) }),
  OculpmApiError: class extends Error {},
}));

import { __resetLangForTests, setLangSetting } from "@/i18n";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { StartWindow } from "@/features/start/StartWindow";
import { SettingsPage } from "@/features/settings/SettingsPage";

// i18n-ignore-next-line -- 한글 **검출**용 정규식 (표시 문자열이 아니다)
const HANGUL = /[가-힣]/;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{children}</WorkspaceProvider>
    </SettingsProvider>
  );
}

/**
 * 렌더된 DOM 에서 한글을 찾는다. 텍스트뿐 아니라 `aria-label` / `title` /
 * `placeholder` 도 훑는다 — 번역 누락의 상당수가 거기 숨는다(스캐너 실측
 * 기준 aria-label 만 275곳).
 */
/**
 * 자기 언어 표기는 예외 — OS 언어 선택 UI 의 관례이고 `i18n.test.ts` 도 같은
 * 예외를 둔다. 영어 화면에서도 "한국어" 라고 적혀야 고를 수 있다.
 */
const SELF_NAMES = new Set(["한국어"]);

function hangulIn(root: HTMLElement): string[] {
  const found: string[] = [];
  // `textContent` 를 통째로 쪼개면 페이지 전체가 한 덩어리가 돼 어느 요소가
  // 범인인지 못 짚는다 — 텍스트 노드를 하나씩 걷는다.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = (n.textContent ?? "").trim();
    if (v && HANGUL.test(v) && !SELF_NAMES.has(v)) found.push(v);
  }
  for (const el of root.querySelectorAll("[aria-label],[title],[placeholder]")) {
    for (const attr of ["aria-label", "title", "placeholder"]) {
      const v = el.getAttribute(attr);
      if (v && HANGUL.test(v) && !SELF_NAMES.has(v)) found.push(`${attr}="${v}"`);
    }
  }
  return [...new Set(found)];
}

beforeEach(() => {
  localStorage.clear();
  setLangSetting("en");
});

afterEach(() => {
  cleanup();
  __resetLangForTests();
});

describe("영어 모드에서 한글이 남지 않는다", () => {

  it("시작 창", async () => {
    const { container, findByText } = render(
      <SettingsProvider>
        <StartWindow />
      </SettingsProvider>,
    );
    await findByText("Recent projects");
    await findByText("First time? Three steps");
    expect(hangulIn(container)).toEqual([]);
  });

  it("설정 한 쪽", async () => {
    const { container, findAllByText } = render(
      <Wrap>
        <SettingsPage />
      </Wrap>,
    );
    expect((await findAllByText("Display")).length).toBeGreaterThan(0);
    expect(hangulIn(container)).toEqual([]);
  });


});
