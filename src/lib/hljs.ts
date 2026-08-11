import { useEffect, useState } from "react";

// highlight.js 공용 지연 로더 (2026-08-11).
//
// 왜 필요한가: PatchView 가 `import hljs from "highlight.js/lib/common"` 을 정적
// 으로 하고 있었고, DiffScreenV2 는 ShellV2 가 eager 로 임포트한다 (core-loop
// 화면). 그래서 문법 37종이 "프로젝트 선택 직후 로드되는" ShellV2 청크에 박히고,
// 같은 코드가 MarkdownImpl 청크에도 중복으로 실렸다 (양쪽 청크에서 확인).
//
// 이제 두 소비자(PatchView, CodeSnippet)가 이 모듈 하나를 거치므로 문법은 자기
// 청크로 분리되고, 프라미스가 모듈 스코프에 메모이즈되어 두 번 내려받지 않는다.
//
// lib/common 은 흔한 37개 언어만 담은 빌드다 (전체 빌드는 800KB 대). 여기 없는
// 언어는 getLanguage() 가 undefined 를 주므로 호출부가 평문으로 폴백하면 된다.

export type Hljs = typeof import("highlight.js/lib/common").default;

let hljsPromise: Promise<Hljs> | null = null;

/** highlight.js/lib/common 을 한 번만 내려받아 공유한다. */
export function loadHljs(): Promise<Hljs> {
  if (!hljsPromise) {
    hljsPromise = import("highlight.js/lib/common").then((m) => m.default);
  }
  return hljsPromise;
}

/**
 * 렌더 중 동기적으로 하이라이터가 필요한 컴포넌트용 훅.
 *
 * 로드 전에는 `null` 을 주고, 준비되면 리렌더를 한 번 일으킨다 — 호출부는 그
 * 사이 평문(escape)으로 그리면 된다. 원문이 먼저 보이고 색이 나중에 입혀지는
 * 것은 CodeSnippet 이 이미 쓰던 "best-effort, raw first" 방식과 같다.
 */
export function useHljs(): Hljs | null {
  const [hljs, setHljs] = useState<Hljs | null>(null);

  useEffect(() => {
    let alive = true;
    loadHljs().then(
      (m) => {
        if (alive) setHljs(m);
      },
      () => {
        // 하이라이팅 실패는 기능을 막지 않는다 — 평문으로 계속 보인다.
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return hljs;
}
