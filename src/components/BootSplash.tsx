// 부트 스플래시 — 앱 콜드 스타트의 첫 1초를 브랜드 모션으로 덮는다:
// 마크가 스프링으로 떠오르고(아이콘의 동심원 모티프를 링 에코로 반향),
// 워드마크가 따라붙은 뒤 오버레이가 들리며 UI(시트 상승·내비 캐스케이드)를
// 드러낸다. App 이 프로세스당 1회 마운트되므로 화면 전환에는 다시 뜨지 않는다.
// 항상 pointer-events 없음 — 입력을 단 한 순간도 막지 않는다.
import { useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import "./bootsplash.css";

/** 오버레이 수명 (ms) — bootsplash.css 의 bootOut(0.55s 시작 + 0.3s) 뒤 여유. */
const BOOT_MS = 900;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
  );
}

export function BootSplash() {
  // 모션 최소화 설정이면 처음부터 그리지 않는다.
  const [gone, setGone] = useState(prefersReducedMotion);

  useEffect(() => {
    if (gone) return;
    const t = window.setTimeout(() => setGone(true), BOOT_MS);
    return () => window.clearTimeout(t);
  }, [gone]);

  if (gone) return null;

  return (
    <div className="boot-splash" aria-hidden="true">
      <div className="boot-inner">
        <div className="boot-center">
          <span className="boot-ring boot-r1" />
          <span className="boot-ring boot-r2" />
          <BrandMark size={56} className="boot-mark" />
        </div>
        <div className="boot-name">Ocul-PM</div>
      </div>
    </div>
  );
}
