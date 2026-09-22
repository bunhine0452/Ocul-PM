// 설정 패널은 **WorkspaceProvider 밖에서도** 그려진다 (2026-09-11 로그).
//
//     ERROR 화면 크래시 [settings]: Error: useWorkspace must be used within a
//     WorkspaceProvider   (SettingsPanel → … , ×3)
//
// 같은 `SettingsPanel` 이 두 자리에서 뜬다: 프로젝트 탭의 화면(`ShellV2`)과
// 시작 탭의 오버레이(`SettingsOverlay`). 시작 탭에는 워크스페이스가 없다 —
// 프로젝트가 탭 하나에 매여 있고 런처 탭은 어떤 프로젝트에도 서 있지 않기
// 때문이다. 그래서 프로젝트에 매인 탭·섹션은 `useSettingsProjectId()` 로
// 읽어야 하고, `useWorkspace()` 를 쓰면 그 자리에서 던진다.
//
// 경계(`ErrorBoundary label="settings"`)가 잡아 주므로 창은 살지만, 사용자가
// 보는 것은 설정이 아니라 크래시 카드다.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
// 커맨드는 전부 빈 성공으로 — 검증 대상은 **렌더가 던지는가**다. 목록을 받는
// 자리(`settings_get_all` 등)는 빈 배열이어야 한다: `null` 을 주면 설정 로딩이
// 던져 테스트가 잡으려던 것과 무관한 실패를 낸다.
const EMPTY_LIST = /^(settingsGetAll|.*(List|Seeds|Top|Overview|Entries)$)/;
vi.mock("@/lib/bindings", () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, name: string) => () =>
        Promise.resolve({ status: "ok", data: EMPTY_LIST.test(name) ? [] : null }),
    },
  ),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));

import { SettingsProvider } from "@/contexts/SettingsContext";
import { ContextTab } from "@/features/settings/tabs/ContextTab";
import { AutomationTab } from "@/features/settings/automation/AutomationTab";
import { DeclarativeConfigSection } from "@/features/settings/config/DeclarativeConfigSection";
import { ConversationImportSection } from "@/features/settings/import/ConversationImportSection";
import { OculpmSettings } from "@/features/settings/OculpmSettings";

afterEach(() => {
  cleanup();
});

/** 프로젝트에 매인 설정 면 — 시작 탭에서도 이 목록 전부가 렌더된다. */
const PROJECT_BOUND = [
  ["컨텍스트 탭", ContextTab],
  ["자동화 탭", AutomationTab],
  // 「데이터」 탭 안의 두 섹션 — 탭 자체는 워크스페이스를 안 읽지만 이 둘이 읽는다.
  ["선언적 설정 섹션", DeclarativeConfigSection],
  ["대화 가져오기 섹션", ConversationImportSection],
  ["ocul-pm 탭", OculpmSettings],
] as const;

describe("WorkspaceProvider 밖의 설정 (시작 탭 오버레이)", () => {
  for (const [name, Tab] of PROJECT_BOUND) {
    it(`${name} 은 프로바이더 없이도 던지지 않는다`, async () => {
      const r = render(
        <SettingsProvider>
          <Tab />
        </SettingsProvider>,
      );
      // 무언가는 그려야 한다 — 빈 상태든 비활성 필드든, 크래시가 아니어야 한다.
      await waitFor(() => expect(r.container.firstChild).not.toBeNull());
    });
  }

  /** 접근자를 한 군데로 모아 두었으므로, 그 규율이 깨지는 것도 한 군데서 잡는다. */
  it("설정 아래에서 useWorkspace() 를 직접 부르는 곳이 없다", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const root = resolve(__dirname, "../features/settings");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        const src = readFileSync(path, "utf8");
        // 주석이 아닌 **호출**만 본다.
        if (/(?<!Optional)\buseWorkspace\(\)/.test(src.replace(/^\s*(\/\/|\*).*$/gm, ""))) {
          offenders.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
