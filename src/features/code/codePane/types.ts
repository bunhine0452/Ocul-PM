// CodePane 이 훅·하위 컴포넌트와 나눠 쓰는 창 상태 타입 — 파일 뷰·줄 점프·비교 모드.
// `CodePane.tsx` 에서 그대로 들어냈다 (순수 이동, 동작 변경 없음).
import type { PreviewKind } from "../previewKind";

export type FileView =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "binary"; bytes: number }
  | { kind: "tooLarge"; bytes: number }
  /** 이미지·PDF — 편집은 못 하지만 볼 수는 있다. 크기는 미리보기가 직접 알린다. */
  | { kind: "preview"; preview: PreviewKind }
  | { kind: "editor"; bytes: number };

/** 에디터에 내릴 줄 점프 — 부모의 `jump` 와 창 안 이동(정의·심볼·비교 복귀)이 같은 자리를 쓴다. */
export interface PendingJump {
  line: number;
  ch?: number;
  len?: number;
  /** false 면 에디터가 포커스를 가져가지 않는다 (파일 안 이동의 미리 점프). */
  focus?: boolean;
}

/** 인라인 비교의 원본이 무엇인가 — HEAD · 특정 일지 · 로컬 히스토리의 한 판. */
export type DiffMode =
  | { kind: "head" }
  | { kind: "entry"; title: string; journalPath: string }
  | { kind: "history"; ts: string; label: string };
