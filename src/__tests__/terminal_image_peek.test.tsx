/**
 * 터미널 이미지 링크 미리보기 (2026-10-09).
 *
 * Claude Code 가 그림을 만든 뒤 찍는 `› [image] /private/tmp/…/x.png (1.9MB)`
 * 에 마우스를 올리면 그 자리에서 그림이 떠야 한다.
 *
 * 여기서 무는 것:
 *  - 올리면 (잠깐 머문 뒤) 카드가 뜨고, 떼면 사라진다 — 지나가기만 하면 안 뜬다
 *  - 누르면 크게 고정되고, 다른 링크를 스쳐도 바뀌지 않으며 Esc 로 닫힌다
 *  - 그림이 아닌 파일은 프로젝트 안이면 파일 메뉴, 밖이면 안내 토스트
 *  - 거절 사유(그림 아님·너무 큼)를 삼키지 않는다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { relativeToRoot, useTerminalFileLinks } from "@/features/terminal/useTerminalFileLinks";
import type { FileRefHit } from "@/features/terminal/fileRefLinks";
import type { FileLinkEvent } from "@/features/terminal/urlLinks";

const reads: string[] = [];
let rejectWith: string | null = null;
vi.mock("@/api/terminal", () => ({
  ptyApi: {
    imagePreview: (path: string) => {
      reads.push(path);
      return rejectWith
        ? Promise.reject(new Error(rejectWith))
        : Promise.resolve({ mime: "image/png", base64: "iVBORw0KGgo=", bytes: 1_992_294 });
    },
  },
}));

const toasts: string[] = [];
vi.mock("@/lib/toast", () => ({ toast: { info: (m: string) => toasts.push(m) } }));

const SHOT = "/private/tmp/claude-501/scratchpad/flat/ref/people_lineup_spring.png";
let emit: (e: FileLinkEvent) => void = () => {};
const menus: FileRefHit[] = [];

function Harness({ root }: { root: string | null }) {
  const { onFileLink, peek } = useTerminalFileLinks(root, (hit) => menus.push(hit));
  emit = onFileLink;
  return <>{peek}</>;
}

const at = { x: 120, y: 80 };
const hover = (path: string, image = true): FileLinkEvent => ({ kind: "hover", path, image, ...at });
const open = (path: string, image = true): FileLinkEvent => ({ kind: "open", path, image, ...at });

/** 대기 중인 타이머와 프라미스를 함께 흘려 보낸다. */
async function settle(ms = 200) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reads.length = 0;
  toasts.length = 0;
  menus.length = 0;
  rejectWith = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useTerminalFileLinks — 이미지", () => {
  it("올리면 잠깐 뒤 카드가 뜨고, 떼면 사라진다", async () => {
    render(<Harness root="/proj" />);
    act(() => emit(hover(SHOT)));
    expect(screen.queryByRole("tooltip")).toBeNull(); // 지나가는 마우스에는 안 뜬다
    await settle();
    const card = screen.getByRole("tooltip");
    expect(reads).toEqual([SHOT]);
    expect(card.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(card.textContent).toContain("people_lineup_spring.png");
    expect(card.textContent).toContain("1.9 MB");
    act(() => emit({ kind: "leave" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("스치기만 하면 읽지도 않는다", async () => {
    render(<Harness root="/proj" />);
    act(() => emit(hover(SHOT)));
    act(() => emit({ kind: "leave" }));
    await settle();
    expect(reads).toEqual([]);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("누르면 크게 고정 — 떼도, 다른 링크를 스쳐도 남고, Esc 로 닫힌다", async () => {
    render(<Harness root="/proj" />);
    act(() => emit(open(SHOT)));
    await settle();
    expect(screen.getByRole("dialog", { name: "people_lineup_spring.png" })).toBeTruthy();
    act(() => emit({ kind: "leave" }));
    act(() => emit(hover("/tmp/other.png")));
    await settle();
    expect(screen.getByRole("dialog", { name: "people_lineup_spring.png" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("거절 사유를 보여 준다", async () => {
    rejectWith = "Not an image file";
    render(<Harness root="/proj" />);
    act(() => emit(hover(SHOT)));
    await settle();
    expect(screen.getByRole("tooltip").textContent).toContain("Not an image file");
  });
});

describe("useTerminalFileLinks — 그림이 아닌 파일", () => {
  it("프로젝트 안이면 파일 메뉴로 (상대경로)", () => {
    render(<Harness root="/proj" />);
    act(() => emit(open("/proj/src/main.rs", false)));
    expect(menus).toEqual([
      { path: "src/main.rs", line: null, rect: { top: 80, bottom: 80, left: 120, right: 120 } },
    ]);
    expect(toasts).toEqual([]);
  });

  it("프로젝트 밖이면 열지 않고 이유를 말한다", () => {
    render(<Harness root="/proj" />);
    act(() => emit(open("/Users/me/.claude/settings.json", false)));
    expect(menus).toEqual([]);
    expect(toasts).toHaveLength(1);
  });

  it("올리기만 해서는 아무 일도 없다", async () => {
    render(<Harness root="/proj" />);
    act(() => emit(hover("/proj/src/main.rs", false)));
    await settle();
    expect(menus).toEqual([]);
    expect(reads).toEqual([]);
  });
});

describe("relativeToRoot", () => {
  it("루트 안쪽만 자른다", () => {
    expect(relativeToRoot("/proj/src/a.ts", "/proj")).toBe("src/a.ts");
    expect(relativeToRoot("/proj/src/a.ts", "/proj/")).toBe("src/a.ts");
    expect(relativeToRoot("C:\\proj\\src\\a.ts", "C:\\proj")).toBe("src/a.ts");
  });

  it("밖·이름만 같은 형제·루트 자신은 null", () => {
    expect(relativeToRoot("/project-b/a.ts", "/proj")).toBeNull();
    expect(relativeToRoot("/proj", "/proj")).toBeNull();
    expect(relativeToRoot("/tmp/a.png", "/proj")).toBeNull();
    expect(relativeToRoot("/proj/a.ts", "")).toBeNull();
  });
});
