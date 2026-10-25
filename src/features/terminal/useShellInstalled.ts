import { useEffect, useState } from "react";
import { shellIntegrationApi } from "@/api/shellIntegration";

/**
 * 셸 통합이 rc 에 설치돼 있는가 — `null` 은 아직 모름 (`deriveIntegrationStatus`).
 *
 * 읽기 전용이다 — 파일을 만들거나 고치지 않는다. 실패도 「모름」으로 남긴다.
 * 2026-10-25 에 터미널 화면에서 여기로 왔다: 셸 통합 상태를 말하는 곳이 화면
 * 툴바 부제에서 상태바로 옮겨, 도크·분리 창도 같은 세 갈래로 말한다.
 */
export function useShellInstalled(): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void shellIntegrationApi
      .status()
      .then((st) => {
        if (alive) setInstalled(st.installed);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return installed;
}
