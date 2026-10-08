// 저장하지 않은 논의 초안 — 화면을 옮겨도 잃지 않게 창 안에 붙들어 둔다.
//
// 셸은 지금 화면만 그린다. 편집 중에 ⌘1 로 오늘 화면에 다녀오면 논의 화면이 통째로
// 내려가고, 그 안의 초안이 **말없이** 사라졌다 (2026-10-08). 디스크에 쓰지 않는 이유:
// 초안은 아직 사용자가 「저장」 이라고 말하지 않은 글이고, 디스크의 `.md` 는 외부
// 에이전트와 함께 쓰는 SSOT 다. 그래서 창의 메모리에만 두고, 저장·취소가 지운다.
// 앱을 끄면 사라진다 — 그때는 기존의 「저장 안 한 편집」 확인이 마지막 문이다.

export interface KeptDraft {
  /** 사용자의 작업본. */
  text: string;
  /** 편집기를 열 때 디스크에 있던 본문 — 「저장 안 됨」 판정의 기준. */
  baseText: string;
  /** 그 본문의 해시 — 저장의 `base_hash`(CAS). 그 사이 디스크가 바뀌면 저장이 충돌로 돌아온다. */
  baseHash: string;
}

const drafts = new Map<string, KeptDraft>();

const key = (projectId: number, discussionId: string) => `${projectId}:${discussionId}`;

/** 작업본을 붙든다. 디스크와 같아지면(되돌렸으면) 놓는다. */
export function keepDraft(projectId: number, discussionId: string, draft: KeptDraft): void {
  if (draft.text === draft.baseText) drafts.delete(key(projectId, discussionId));
  else drafts.set(key(projectId, discussionId), draft);
}

export function peekDraft(projectId: number, discussionId: string): KeptDraft | undefined {
  return drafts.get(key(projectId, discussionId));
}

/** 저장했거나 버렸다. */
export function dropDraft(projectId: number, discussionId: string): void {
  drafts.delete(key(projectId, discussionId));
}
