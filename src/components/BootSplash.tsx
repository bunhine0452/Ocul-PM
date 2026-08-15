// 부트 스플래시 — 앱 콜드 스타트의 첫 1초.
//
// 레퍼런스는 앱 아이콘(public/icon.svg)의 동심 아크 마크다. 다만 아이콘 이미지를
// 얹고 흔드는 게 아니라, **같은 지오메트리를 라이브 SVG 로 그린다**: 세 아크가
// 바깥에서 안으로 차례로 호를 그리며(각자 반대 방향으로 쓸며) 제자리 각도에
// 정착하고, 마지막에 초점(중앙 점)이 맞는다 — 조리개가 열려 초점을 잡는 동작.
// 반복하지 않는다. 스피너가 아니라 한 번 해결되고 끝나는 문장이다.
//
// 좌표·대시·회전값은 icon.svg 의 <circle> 에서 그대로 옮겨 왔다(1024 뷰박스).
// icon.svg 는 여기에 더해 타일 여백을 메우려고 그룹 변환 scale(1.4) 를 얹는데,
// 균일 확대라 아크 간 비례가 같으므로 여기서는 재현하지 않는다 — 스플래시의
// 마크 크기는 타일이 아니라 CSS 의 .boot-mark 폭이 정한다.
// 색만 테마 토큰으로 갈아끼운다 — 아이콘은 어두운 타일 위라 안쪽이 흰색이지만,
// 여기선 앱 캔버스 위이므로 "안으로 갈수록 대비가 세진다" 는 위계만 보존한다.
//
// App 이 창당 1회 마운트하므로 화면 전환에는 다시 뜨지 않는다.
// 항상 pointer-events 없음 — 입력을 단 한 순간도 막지 않는다.
import { useEffect, useState } from "react";
import "./bootsplash.css";

/** 오버레이 수명 (ms) — bootsplash.css 의 bootOut(0.78s 시작 + 0.26s) 뒤 여유. */
const BOOT_MS = 1060;

/**
 * 동심 아크 3개 — icon.svg 의 <circle> 3개와 같은 값.
 * `spin` 은 최종 각도에서 얼마나 앞선 지점에서 쓸어 들어올지(부호가 회전 방향).
 */
const ARCS = [
  { r: 190, dash: 970, gap: 224, rot: 125, spin: -58, d: 0.05 },
  { r: 132, dash: 640, gap: 190, rot: -40, spin: 58, d: 0.13 },
  { r: 74, dash: 330, gap: 135, rot: 70, spin: -58, d: 0.21 },
] as const;

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
        <svg className="boot-mark" viewBox="0 0 1024 1024" fill="none">
          {/* 초점이 맞는 순간의 파문 — 딱 한 번. */}
          <circle className="boot-ripple" cx="512" cy="512" r="190" strokeWidth={14} />
          <g fill="none" strokeWidth={40} strokeLinecap="round">
            {ARCS.map((a, i) => (
              <circle
                key={a.r}
                className={`boot-arc boot-a${i + 1}`}
                cx="512"
                cy="512"
                r={a.r}
                style={
                  {
                    "--dash": a.dash,
                    "--gap": a.gap,
                    "--len": a.dash + a.gap,
                    "--rot": `${a.rot}deg`,
                    "--from": `${a.rot + a.spin}deg`,
                    "--d": `${a.d}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </g>
          <circle className="boot-pupil" cx="512" cy="512" r="22" />
        </svg>
        <div className="boot-name">Ocul-PM</div>
      </div>
    </div>
  );
}
