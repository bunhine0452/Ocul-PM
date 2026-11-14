// 부트 스플래시 — 앱 콜드 스타트의 첫 창이 **늦을 때만**.
//
// 레퍼런스는 앱 아이콘(public/icon.svg)의 동심 아크 마크다. 다만 아이콘 이미지를
// 얹고 흔드는 게 아니라, **같은 지오메트리를 라이브 SVG 로 그린다**: 세 아크가
// 바깥에서 안으로 차례로 호를 그리며(각자 반대 방향으로 쓸며) 제자리 각도에
// 정착하고, 마지막에 초점(중앙 점)이 맞는다 — 조리개가 열려 초점을 잡는 동작.
// 반복하지 않는다. 스피너가 아니라 한 번 해결되고 끝나는 문장이다.
//
// 좌표·대시·회전값은 icon.svg 의 <circle> 에서 그대로 옮겨 왔다(1024 뷰박스).
// 색만 테마 토큰으로 갈아끼운다 — 아이콘은 어두운 타일 위라 안쪽이 흰색이지만,
// 여기선 앱 캔버스 위이므로 "안으로 갈수록 대비가 세진다" 는 위계만 보존한다.
//
// **언제 뜨는가** (11-15). 예전엔 새 창마다 1.06초 고정 타이머로 내용을 가렸다 — ⇧⌘N · ⌥⌘숫자 ·
// ⌘K 의 프로젝트 · 창 정리가 모두 1초씩 늦었다. 이제:
//   · 창 라벨이 `main`(앱이 처음 만드는 창)일 때만 — 나중에 여는 창은 이미 데운 앱이다.
//   · 첫 내용(윗줄 · 시작 창 · 오류 카드)이 300ms 안에 서면 **아예 그리지 않는다**.
//   · 끝은 타이머가 아니라 첫 내용이다 — rAF 로 그 요소가 DOM 에 서는지 본다(AppWindow 는 손대지 않는다).
//   · 모션 최소화면 움직이지 않는 마크로 선다(bootsplash.css 끝).
// 항상 pointer-events 없음 — 입력을 단 한 순간도 막지 않는다.
import { useEffect, useState } from "react";
import { FIRST_WINDOW, parseWindowRoute } from "@/lib/windowRoute";
import "./bootsplash.css";

/** 첫 내용이 이 안에 서면 스플래시를 그리지 않는다. */
export const BOOT_SHOW_AFTER_MS = 300;
/** 첫 내용 — 프로젝트 창의 윗줄, 시작 창, 창이 통째로 깨졌을 때의 오류 카드. */
export const BOOT_FIRST_CONTENT = ".topbar, .start, .err-card";
/** 아무것도 서지 않아도 이만큼 지나면 걷는다 — 스플래시가 창을 영영 덮지 않게, rAF 도 멈추게. */
const BOOT_GIVE_UP_MS = 10_000;

/**
 * 동심 아크 3개 — icon.svg 의 <circle> 3개와 같은 값.
 * `spin` 은 최종 각도에서 얼마나 앞선 지점에서 쓸어 들어올지(부호가 회전 방향).
 */
const ARCS = [
  { r: 190, dash: 970, gap: 224, rot: 125, spin: -58, d: 0.05 },
  { r: 132, dash: 640, gap: 190, rot: -40, spin: 58, d: 0.13 },
  { r: 74, dash: 330, gap: 135, rot: 70, spin: -58, d: 0.21 },
] as const;

type Phase = "waiting" | "shown" | "done";

export function BootSplash({ label = parseWindowRoute(window.location.search).label }: { label?: string }) {
  const first = label === FIRST_WINDOW;
  const [phase, setPhase] = useState<Phase>(first ? "waiting" : "done");

  useEffect(() => {
    if (!first) return;
    let raf = 0;
    const settle = () => {
      window.clearTimeout(show);
      window.clearTimeout(giveUp);
      window.cancelAnimationFrame(raf);
      setPhase("done");
    };
    const show = window.setTimeout(() => setPhase((p) => (p === "waiting" ? "shown" : p)), BOOT_SHOW_AFTER_MS);
    const giveUp = window.setTimeout(settle, BOOT_GIVE_UP_MS);
    const look = () => {
      if (document.querySelector(BOOT_FIRST_CONTENT)) settle();
      else raf = window.requestAnimationFrame(look);
    };
    look();
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(giveUp);
      window.cancelAnimationFrame(raf);
    };
  }, [first]);

  if (phase !== "shown") return null;

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
        <div className="boot-name">Ocul</div>
      </div>
    </div>
  );
}
