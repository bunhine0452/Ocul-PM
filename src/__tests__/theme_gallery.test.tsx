import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ThemeFile, ThemeImportOutcome } from "@/lib/bindings";

// 테마 갤러리·편집기 (Osaurus 라운드 Phase 4).
//
// 이 파일이 지키는 계약:
//  1. 내장 5종은 **읽기 전용**이다 — 편집·삭제가 없고 복제만 있다.
//  2. 편집은 **라이브 프리뷰**다 — 입력 즉시 초안이 스토어에 실린다
//     (앱 자체가 미리보기라는 설계 §4 의 유일한 배선점).
//  3. 토큰마다 「가족 기본값으로 되돌리기」가 있고, 되돌리면 키가 사라진다.
//  4. 이름 충돌은 **조용히 덮어쓰지 않는다** — 세 갈래를 묻는다.

const themes = vi.hoisted(() => ({ current: [] as ThemeFile[] }));
const importOutcome = vi.hoisted(() => ({
  current: {
    status: "imported",
    theme: null,
    conflict_name: null,
    source_path: null,
  } as ThemeImportOutcome,
}));
const calls = vi.hoisted(() => ({ current: [] as string[] }));
const settingValue = vi.hoisted(() => ({ current: "system" }));

vi.mock("@/api/themes", () => ({
  themesApi: {
    list: () => Promise.resolve(themes.current),
    save: (theme: ThemeFile) => {
      calls.current.push(`save:${theme.metadata.name}`);
      return Promise.resolve({ ...theme, metadata: { ...theme.metadata, id: "saved-id" } });
    },
    remove: (id: string) => {
      calls.current.push(`remove:${id}`);
      return Promise.resolve(true);
    },
    import: (path: string | null, mode: string | null) => {
      calls.current.push(`import:${path ?? "dialog"}:${mode ?? "-"}`);
      return Promise.resolve(importOutcome.current);
    },
    export: (theme: ThemeFile) => {
      calls.current.push(`export:${theme.metadata.name}`);
      return Promise.resolve("/tmp/theme.json");
    },
    systemAccent: () => Promise.resolve("#007aff"),
    setProjectTheme: () => Promise.resolve(null),
    onChanged: () => () => {},
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { info: () => {}, warning: () => {}, destructive: () => {} },
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: { theme: settingValue.current } as never,
    set: (field: string, value: string) => {
      calls.current.push(`set:${field}:${value}`);
      settingValue.current = value;
      return Promise.resolve();
    },
  }),
}));

import { ThemeGallery } from "@/features/theme/ThemeGallery";
import { getThemeState, refreshThemes, resetThemeStore } from "@/features/theme/store";

const custom = (over: Partial<ThemeFile> = {}): ThemeFile => ({
  oculpm_theme: "v1",
  metadata: {
    id: "mine",
    name: "미드나이트 코랄",
    version: "1.0",
    author: null,
    created_at: "",
    updated_at: "",
  },
  family: "dark",
  is_built_in: false,
  follows_system_accent: false,
  tokens: { "--accent": "#ff7a66" },
  ...over,
});

beforeEach(async () => {
  themes.current = [];
  calls.current = [];
  settingValue.current = "system";
  importOutcome.current = {
    status: "imported",
    theme: custom(),
    conflict_name: null,
    source_path: null,
  };
  resetThemeStore();
  await refreshThemes();
});

afterEach(() => {
  cleanup();
  resetThemeStore();
});

describe("갤러리", () => {
  it("내장 5종을 보여 주고, 카드를 누르면 그 테마가 설정에 적용된다", async () => {
    render(<ThemeGallery />);
    for (const name of ["Solarized", "Sepia", "Nord", "Dracula", "High Contrast"]) {
      expect(screen.getByLabelText(`${name} 테마 적용`)).toBeTruthy();
    }
    fireEvent.click(screen.getByLabelText("Nord 테마 적용"));
    expect(calls.current).toContain("set:theme:nord");
  });

  it("내장은 읽기 전용 — 메뉴에 편집·삭제가 없고 복제와 내보내기만 있다", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByLabelText("Nord 테마 메뉴"));
    expect(screen.getByText("복제해서 편집")).toBeTruthy();
    expect(screen.getByText("내보내기")).toBeTruthy();
    expect(screen.queryByText("편집")).toBeNull();
    expect(screen.queryByText("삭제")).toBeNull();
  });

  it("사용자 테마는 편집·삭제가 열린다", async () => {
    themes.current = [custom()];
    await refreshThemes();
    render(<ThemeGallery />);
    fireEvent.click(screen.getByLabelText("미드나이트 코랄 테마 메뉴"));
    expect(screen.getByText("편집")).toBeTruthy();
    expect(screen.getByText("삭제")).toBeTruthy();
  });
});

describe("편집 — 앱이 곧 미리보기", () => {
  it("입력 즉시 초안이 스토어에 실린다", async () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByText("새 테마"));

    expect(getThemeState().draft?.metadata.name).toBe("새 테마");

    fireEvent.change(screen.getByLabelText("--bg-window 값"), {
      target: { value: "#141416" },
    });
    expect(getThemeState().draft?.tokens?.["--bg-window"]).toBe("#141416");
  });

  it("되돌리면 토큰이 사라진다 (부분 지정으로 복귀)", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByText("새 테마"));
    fireEvent.change(screen.getByLabelText("--accent 값"), { target: { value: "#ff7a66" } });
    expect(getThemeState().draft?.tokens?.["--accent"]).toBe("#ff7a66");

    const reverts = screen.getAllByLabelText("가족 기본값으로 되돌리기");
    const enabled = reverts.filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(1);
    fireEvent.click(enabled[0]);
    expect(getThemeState().draft?.tokens?.["--accent"]).toBeUndefined();
  });

  it("저장하면 초안을 내리고 그 테마를 적용한다", async () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByText("새 테마"));
    fireEvent.click(screen.getByText("저장"));

    await waitFor(() => expect(calls.current).toContain("save:새 테마"));
    expect(getThemeState().draft).toBeNull();
    expect(calls.current).toContain("set:theme:custom:saved-id");
  });

  it("취소하면 초안이 사라져 저장된 색으로 돌아간다", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByText("새 테마"));
    expect(getThemeState().draft).not.toBeNull();
    fireEvent.click(screen.getByText("취소"));
    expect(getThemeState().draft).toBeNull();
  });
});

describe("가져오기", () => {
  it("이름이 겹치면 조용히 덮어쓰지 않고 세 갈래를 묻는다", async () => {
    importOutcome.current = {
      status: "conflict",
      theme: null,
      conflict_name: "미드나이트 코랄",
      source_path: "/tmp/theirs.json",
    };
    render(<ThemeGallery />);
    fireEvent.click(screen.getByText("가져오기"));

    await waitFor(() => expect(screen.getByText("같은 이름의 테마가 있습니다")).toBeTruthy());
    expect(screen.getByText("덮어쓰기")).toBeTruthy();
    expect(screen.getByText("사본으로")).toBeTruthy();

    importOutcome.current = {
      status: "imported",
      theme: custom(),
      conflict_name: null,
      source_path: "/tmp/theirs.json",
    };
    fireEvent.click(screen.getByText("사본으로"));
    // 파일을 두 번 고르게 하지 않는다 — 같은 경로로 다시 부른다.
    await waitFor(() =>
      expect(calls.current).toContain("import:/tmp/theirs.json:copy"),
    );
  });
});
