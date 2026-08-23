/**
 * 편집기 배선 — 순수 모듈(`mdEdit`)이 계산한 교체가 실제로 CodeMirror 문서에
 * 반영되고 저장까지 흘러가는지. 순수 함수 단위 테스트는 `discussion_edit`
 * 쪽이고, 여기서 보는 건 **툴바 → 트랜잭션 → onSave** 의 연결이다.
 *
 * jsdom 에는 레이아웃이 없어 CodeMirror 의 그리기(가상 스크롤·좌표)는 검증
 * 대상이 아니다. 문서 상태와 콜백만 본다.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { DiscussionEditor } from "@/features/discussion/DiscussionEditor";

beforeAll(() => {
  // CM6 은 마운트 직후 rAF 에서 글자 폭을 재는데, jsdom 의 Range 에는 그
  // 좌표 API 가 없어 테스트가 끝난 뒤 unhandled error 로 튄다. 레이아웃은
  // 이 스위트의 검사 대상이 아니므로 빈 값으로 채워 둔다.
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
  const view = render(
    <DiscussionEditor
      initialText={DOC}
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
    expect(getByRole("button", { name: /저장/ })).toBeDisabled();
  });

  it("‘후보 방안’ 삽입은 다음 id 를 붙여 그 섹션에 넣고, 저장까지 흘러간다", async () => {
    const { getByRole, getByText, onSave } = mount();

    fireEvent.click(getByRole("button", { name: /삽입/ }));
    fireEvent.click(getByText("후보 방안 (id 자동)"));

    const save = getByRole("button", { name: /저장/ });
    await waitFor(() => expect(save).not.toBeDisabled());
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
});
