import { useCallback, useEffect } from "react";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { reportRejection } from "@/lib/reportFailure";
import { requestCheatsheet } from "@/lib/projectActions";
import { useT } from "@/i18n";

/**
 * ⌘번호가 재배정됐다는 **1회** 안내 (2026-09-06 IA 재편, v3-surface
 * `{#shortcut-remap}`).
 *
 * 논의·문서가 참고 그룹으로 내려가면서 번호 일곱 개의 뜻이 바뀌었다. 손가락이
 * 기억하는 것을 말없이 바꾸면 사용자는 앱이 고장 났다고 읽는다.
 *
 * 자리를 사이드바로 고른 이유 — 바뀐 것이 **여기** 있고, 릴리스 노트 카드와
 * 달리 GitHub 에 닿지 않아도 뜬다. 카드가 아니라 한 줄짜리 상자다: 안내가
 * 자리를 많이 먹으면 정작 새 번호가 안 보인다.
 *
 * **첫 설치에는 뜨지 않는다.** 옛 번호를 본 적 없는 사람에게 "바뀌었어요" 는
 * 거짓말이다 — What's-new 카드가 세운 규율을 그대로 따른다. 이전 설치인지는
 * `lastSeenVersion` 이 비어 있지 않은지로 판정하고, 비어 있으면 조용히 봤다고
 * 적는다.
 */
export function NavRemapNotice() {
  const { t } = useT();
  const settings = useOptionalSettings();
  const set = settings?.set;
  const loaded = settings?.loaded ?? false;
  const seen = settings?.settings.navRemapSeen ?? true;
  const priorInstall = (settings?.settings.lastSeenVersion ?? "") !== "";

  /**
   * `useSaveSetting` 을 쓰지 않는다 — 그 훅은 `useSettings()` 라 프로바이더가
   * **없으면 throw** 하는데, 사이드바는 설정 컨텍스트 없이도 렌더된다
   * (분리 창·테스트). 계약은 같게 유지한다: 프로미스를 바닥에 떨어뜨리지 않고
   * 실패를 말한다.
   */
  const save = useCallback(() => {
    if (!set) return;
    reportRejection(set("navRemapSeen", true), "settings.saveFailed");
  }, [set]);

  useEffect(() => {
    if (!loaded || seen || priorInstall) return;
    save();
  }, [loaded, seen, priorInstall, save]);

  if (!loaded || seen || !priorInstall) return null;

  return (
    <div className="nav-remap" role="note">
      <div className="nav-remap-title">{t("sidebar.remapTitle")}</div>
      <div className="nav-remap-body">{t("sidebar.remapBody")}</div>
      <div className="nav-remap-acts">
        <button type="button" onClick={() => requestCheatsheet()}>
          {t("sidebar.remapCheatsheet")}
        </button>
        <button type="button" onClick={save}>
          {t("sidebar.remapDismiss")}
        </button>
      </div>
    </div>
  );
}
