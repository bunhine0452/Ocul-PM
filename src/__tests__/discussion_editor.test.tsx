/**
 * 편집기 배선 — 순수 모듈(`mdEdit`)이 계산한 교체가 실제로 편집기 문서에
 * 반영되고 저장까지 흘러가는지. 순수 함수 단위 테스트는 `discussion_edit`
 * 쪽이고, 여기서 보는 건 **툴바 → 편집 → onSave** 의 연결이다.
 *
 * Monaco 이관에서 이 스위트가 **판정자**였다. `mdEdit` 의 `EditOp` 는 문서
 * 오프셋으로 말하고 Monaco 는 (줄, 열)이라, 그 환산이 어긋나면 삽입이 엉뚱한
 * 자리로 간다 — 여기서 잡힌다. 테스트 본문은 한 줄도 안 고쳤다.
 *
 * jsdom 에는 레이아웃이 없어 그리기(가상 스크롤·좌표)는 검증 대상이 아니다.
 * 문서 상태와 콜백만 본다.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { DiscussionEditor } from "@/features/discussion/DiscussionEditor";

beforeAll(() => {
  // 편집기는 마운트 직후 글자 폭을 재는데 jsdom 의 Range 에는 그 좌표 API 가
  // 없어 테스트가 끝난 뒤 unhandled error 로 튄다. 레이아웃은 이 스위트의
  // 검사 대상이 아니므로 빈 값으로 채워 둔다.
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const DOC = [
  "## 문제 정의",
  "",
  "캐시 경로를 어디에 둘지.",
  "",
  "## 후보 해결 방안",
  "",
  "### 방안 A — 절대경로 {#opt-a}",
  "",
  "## 다음 단계",
  "",
].join("\n");

function mount(over: Partial<React.ComponentProps<typeof DiscussionEditor>> = {}) {
  const onSave = vi.fn();
  const text = over.initialText ?? DOC;
  const view = render(
    <DiscussionEditor
      initialText={text}
      baseText={text}
      filePath=".oculpm/discussion/cache-path/discussion.md"
      mode="write"
      onModeChange={vi.fn()}
      onSave={onSave}
      onCancel={vi.fn()}
      busy={false}
      author="user"
      {...over}
    />,
  );
  return { ...view, onSave };
}

afterEach(cleanup);

describe("DiscussionEditor", () => {
  it("저장 버튼은 편집이 없으면 잠겨 있다 (빈 저장으로 updated 를 흔들지 않는다)", () => {
    const { getByRole } = mount();
    expect(getByRole("button", { name: /저장/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("‘후보 방안’ 삽입은 다음 id 를 붙여 그 섹션에 넣고, 저장까지 흘러간다", async () => {
    const { getByRole, getByText, onSave } = mount();

    fireEvent.click(getByRole("button", { name: /삽입/ }));
    fireEvent.click(getByText("후보 방안 (id 자동)"));

    const save = getByRole("button", { name: /저장/ });
    await waitFor(() => expect(save).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(save);

    expect(onSave).toHaveBeenCalledTimes(1);
    const text = onSave.mock.calls[0][0] as string;
    expect(text).toContain("{#opt-b}");
    // 문서 끝이 아니라 후보안 섹션 안에 들어가야 한다.
    expect(text.indexOf("{#opt-b}")).toBeLessThan(text.indexOf("## 다음 단계"));
  });

  it("파서가 모르는 `## ` 제목이 있으면 경고 띠를 띄운다", async () => {
    const { findByText } = mount({ initialText: "## 리스크\n\n무언가\n" });
    await findByText(/인식하지 않는 제목/);
  });

  // ── 2026-10-08 개편 ──────────────────────────────────────────────────────

  it("붙들어 둔 초안으로 열면 처음부터 「저장 안 됨」 이고 저장할 수 있다", () => {
    const { getByRole, getByText } = mount({ initialText: `${DOC}덧붙인 문단\n`, baseText: DOC });
    expect(getByText("저장 안 됨")).toBeTruthy();
    expect(getByRole("button", { name: /저장/ })).not.toHaveAttribute("aria-disabled");
  });

  it("글이 바뀌면 화면에 알린다 — 화면을 옮겨도 초안을 붙들 수 있게", async () => {
    const onTextChange = vi.fn();
    const { getByRole, getByText } = mount({ onTextChange });
    fireEvent.click(getByRole("button", { name: /삽입/ }));
    fireEvent.click(getByText("후보 방안 (id 자동)"));
    await waitFor(() => expect(onTextChange).toHaveBeenCalled());
    const calls = onTextChange.mock.calls;
    expect(calls[calls.length - 1][0]).toContain("{#opt-b}");
  });

  it("개요는 `##`·`###` 제목을 id 없이 보이고, 누르면 상태줄의 현재 섹션이 그리로 간다", async () => {
    const { getByRole, container } = mount();
    const nav = getByRole("navigation", { name: "개요" });
    const titles = [...nav.querySelectorAll("button")].map((b) => b.textContent);
    expect(titles).toEqual(["문제 정의", "후보 해결 방안", "방안 A — 절대경로", "다음 단계"]);
    const section = () => container.querySelector(".disc-edit-status-section")?.textContent;
    expect(section()).toBe("문제 정의");
    fireEvent.click(getByRole("button", { name: "다음 단계" }));
    await waitFor(() => expect(section()).toBe("다음 단계"));
  });

  // ── 2026-10-25 리치 모드 (나란히·미리보기를 대신한다) ─────────────────────

  it("리치 모드는 문서를 편집기로 그리고, 열기만 해서는 글이 바뀌지 않는다", () => {
    const onTextChange = vi.fn();
    const { container, getByRole } = mount({ mode: "rich", onTextChange });
    const heads = [...container.querySelectorAll(".rich-md-doc h2")].map((h) => h.textContent);
    expect(heads).toEqual(["문제 정의", "후보 해결 방안", "다음 단계"]);
    expect(onTextChange).not.toHaveBeenCalled();
    expect(getByRole("button", { name: /저장/ })).toHaveAttribute("aria-disabled", "true");
    // 개요는 리치에서도 왼쪽에 선다.
    expect(getByRole("navigation", { name: "개요" })).toBeTruthy();
  });

  it("리치에서 ‘후보 방안’ 을 넣으면 글에 바로 들어가고 판이 그 글로 다시 열린다", async () => {
    const { getByRole, getByText, container, onSave } = mount({ mode: "rich" });
    fireEvent.click(getByRole("button", { name: /삽입/ }));
    fireEvent.click(getByText("후보 방안 (id 자동)"));
    await waitFor(() => expect(container.querySelectorAll(".rich-md-doc h3")).toHaveLength(2));
    fireEvent.click(getByRole("button", { name: /저장/ }));
    const text = onSave.mock.calls[0][0] as string;
    expect(text.indexOf("{#opt-b}")).toBeGreaterThan(0);
    expect(text.indexOf("{#opt-b}")).toBeLessThan(text.indexOf("## 다음 단계"));
  });

  it("리치에서 토의 메모를 넣으면 원문 모드의 그 칸으로 넘어간다 — 로그는 리치에서 못 고친다", () => {
    const onModeChange = vi.fn();
    const { getByRole, getByText } = mount({ mode: "rich", onModeChange });
    fireEvent.click(getByRole("button", { name: /삽입/ }));
    fireEvent.click(getByText(/토의 메모/));
    expect(onModeChange).toHaveBeenCalledWith("write");
  });
});
