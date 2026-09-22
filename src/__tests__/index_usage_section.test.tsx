import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { t } from "@/i18n";

// ─── {#index-usage} — .oculpm/index/ 사용량을 설정 진단 탭에 보여준다 ─────────
//
// 핵심 계약 둘: (1) 프로젝트가 열리면 세 갈래(히스토리·diff·그 밖) 사용량을
// 조회해 보여준다. (2) diff 사이드카 정리는 확인 대화상자를 거쳐야만 실행되고,
// 끝나면 사용량을 다시 조회한다(지운 만큼 줄어든 걸 사용자가 봐야 한다).

const usageMock = vi.hoisted(() => vi.fn());
const clearDiffsMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/indexUsage", () => ({
  indexUsageApi: {
    usage: (...args: unknown[]) => usageMock(...args),
    clearDiffs: (...args: unknown[]) => clearDiffsMock(...args),
  },
}));

vi.mock("@/contexts/WorkspaceContext", () => ({
  useOptionalWorkspace: () => ({ state: { currentProjectId: 7 } }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { info: vi.fn(), destructive: vi.fn(), warning: vi.fn() },
}));

import { IndexUsageSection } from "@/features/settings/tabs/IndexUsageSection";

function usage() {
  return {
    history_bytes: 5 * 1024 * 1024,
    history_files: 5,
    diffs_bytes: 1 * 1024 * 1024,
    diffs_files: 3,
    other_bytes: 0,
    total_bytes: 6 * 1024 * 1024,
  };
}

beforeEach(() => {
  usageMock.mockReset();
  clearDiffsMock.mockReset();
  usageMock.mockResolvedValue(usage());
  clearDiffsMock.mockResolvedValue(null);
});
afterEach(() => cleanup());

describe("IndexUsageSection", () => {
  it("프로젝트가 열리면 세 갈래 사용량을 조회해 보여준다", async () => {
    const { getByText } = render(<IndexUsageSection />);
    await waitFor(() => expect(usageMock).toHaveBeenCalledWith(7));
    await waitFor(() => expect(getByText(/1\.0 MB/)).toBeTruthy());
    expect(getByText(/5\.0 MB/)).toBeTruthy();
    expect(getByText(/6\.0 MB/)).toBeTruthy();
  });

  it("diff 정리는 확인 뒤에만 실행하고 끝나면 사용량을 다시 조회한다", async () => {
    const { getByText, findByText } = render(<IndexUsageSection />);
    await waitFor(() => expect(usageMock).toHaveBeenCalledTimes(1));

    fireEvent.click(getByText(t("settings.idxUsage.clearDiffs")));
    // 확인 대화상자의 확인 버튼 — 트리거 버튼과 라벨이 같으므로 danger 클래스로 가른다.
    // 리디자인(2026-09-21) 뒤 라벨은 <span> 안이라 텍스트의 부모가 버튼이 아니다.
    const confirmBtn = await findByText(t("settings.idxUsage.clearDiffs"), {
      selector: "button.danger span",
    });
    expect(clearDiffsMock).not.toHaveBeenCalled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(clearDiffsMock).toHaveBeenCalledWith(7));
    await waitFor(() => expect(usageMock).toHaveBeenCalledTimes(2));
  });
});
