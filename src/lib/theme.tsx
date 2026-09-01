// Thin compatibility shim — the canonical theme state now lives in
// SettingsContext. This file is kept so that existing `useTheme()` call sites
// keep working.
//
// Osaurus 라운드 Phase 4: 가족(light/dark)을 **설정에서 다시 유도하지 않는다.**
// 이제 창의 가족은 전역 설정만이 아니라 프로젝트 바인딩·편집 중 초안·사용자
// 테마 파일까지 함께 정한다 — 여기서 한 벌 더 계산하면 반드시 어긋난다
// (코드 하이라이트가 다크 커스텀 테마에서 라이트로 그려지는 식으로).
// `SettingsContext` 가 `<html data-theme>` 에 **이미 답을 써 두었으므로**
// 그것을 읽는다. 소유자는 하나다.

import { useEffect, useState } from "react";
import { useSettings } from "@/contexts/SettingsContext";

export type Theme = "light" | "dark" | "system";

function familyNow(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function useTheme() {
  const { settings, set } = useSettings();
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(familyNow);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setResolvedTheme(familyNow());
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return {
    theme: settings.theme,
    setTheme: (t: Theme) => {
      void set("theme", t);
    },
    resolvedTheme,
  };
}
