/**
 * 화면 언어를 바꾼 직후의 「AI 작성 언어도 바꿀까요?」 제안은 **새 언어로** 말한다
 * (크로스플랫폼 라운드 {#ui-e2e-minor}, E2E 발견 — 모든 OS 의 결함).
 *
 * 언어 저장은 설정 채널(SettingsContext 의 effect)을 한 바퀴 돌아 i18n 스토어에 닿는다.
 * 제안 토스트를 그 전에 `t()` 로 지으면 옛 언어(한국어)가 된다 — 영어로 바꾼 사람에게
 * 한국어 토스트가 15초 떠 있었다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

const save = vi.fn();
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { language: "ko", contentLanguage: "ko" } }),
}));
vi.mock("@/features/settings/saveSetting", () => ({ useSaveSetting: () => save }));

import { LanguageSection } from "@/features/settings/tabs/AppearanceTab";
import { toast } from "@/lib/toast";
import { __resetLangForTests, setLangSetting } from "@/i18n";
import { en } from "@/i18n/en";

afterEach(() => {
  cleanup();
  save.mockReset();
  __resetLangForTests();
});

describe("LanguageSection — content-language suggestion", () => {
  it("switching the UI to English suggests in English, not in the old language", async () => {
    setLangSetting("ko");
    const warn = vi.spyOn(toast, "warning");
    const r = render(<LanguageSection />);
    // 두 줄(화면 언어 · AI 작성 언어) 중 첫 줄의 English.
    fireEvent.click(r.getAllByRole("button", { name: en["settings.language.en"] })[0]);
    await act(async () => {});

    expect(save).toHaveBeenCalledWith("language", "en");
    expect(warn).toHaveBeenCalledTimes(1);
    const [body, opts] = warn.mock.calls[0] as unknown as [string, { title: string; actions: Array<{ label: string }> }];
    expect(body).toBe(en["settings.language.syncToastBody"].replace("{target}", en["settings.language.en"]));
    expect(opts.title).toBe(en["settings.language.syncToast"].replace("{current}", "한국어")); // i18n-ignore -- 언어 이름은 자기 언어로 적는다
    expect(opts.actions[0].label).toBe(en["settings.language.syncAction"].replace("{target}", en["settings.language.en"]));
    warn.mockRestore();
  });
});
