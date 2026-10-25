// 코드 화면의 마크다운 보기 — 리치(노션식)와 원문(Monaco) 사이 (2026-10-25, Orca 벤치마크).
//
// .md 는 리치로 연다. 고른 쪽은 이 세션 동안 파일마다 기억한다 — 앱을 다시 켜면 다시
// 리치다. 저장소(localStorage)에 두지 않는 이유는 둘: WorkspaceContext 만 저장소를
// 만지는 규칙이 있고, 파일마다 쌓이는 기록은 지울 때를 정하기 어렵다.
//
// 편집면 자리(`RichOrCode`)도 여기 산다 — 리치로 볼 때는 리치 편집기, 아니면 받은
// Monaco 편집기 그대로. 리치 편집기(TipTap)는 따로 내려받는 청크라 리치로 열 때만 온다.
import { lazy, Suspense, useCallback, useState } from "react";
import type React from "react";

const chosen = new Map<string, boolean>();
let richByDefault = true;

/** 테스트 전용 — 기본 보기를 바꾸고 기억을 비운다 (Monaco 경로를 보는 스위트가 원문으로 연다). */
export function __setRichByDefaultForTests(rich: boolean): void {
  richByDefault = rich;
  chosen.clear();
}

/** 리치로 열 수 있는 파일 — MDX 는 JSX 가 섞여 원문만이다. */
export function isRichMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export interface MarkdownView {
  isMarkdown: boolean;
  rich: boolean;
  setRich: (rich: boolean) => void;
}

export function useMarkdownView(projectId: number, path: string | null): MarkdownView {
  const [, bump] = useState(0);
  const key = path ? `${projectId}:${path}` : "";
  const isMarkdown = path ? isRichMarkdownPath(path) : false;
  const setRich = useCallback(
    (rich: boolean) => {
      chosen.set(key, rich);
      bump((n) => n + 1);
    },
    [key],
  );
  return { isMarkdown, rich: isMarkdown && (chosen.get(key) ?? richByDefault), setRich };
}

const RichMarkdownEditor = lazy(() =>
  import("../richMarkdown/RichMarkdownEditor").then((m) => ({ default: m.RichMarkdownEditor })),
);

interface Props {
  rich: boolean;
  /** 리치 편집기를 바꿔 끼우는 열쇠 — 경로·바깥 변경 판이 바뀌면 다시 연다. */
  editorKey: string;
  text: string;
  onChange: (text: string) => void;
  children: React.ReactNode;
}

export function RichOrCode({ rich, editorKey, text, onChange, children }: Props) {
  if (!rich) return <>{children}</>;
  return (
    <Suspense fallback={null}>
      <RichMarkdownEditor key={editorKey} initialText={text} onChange={onChange} />
    </Suspense>
  );
}
