// 활동 줄 묶기 — 2패스 (플랜 `v3-surface` `{#activity-group}`).
//
// 스무 번 파일을 읽은 턴은 **똑같이 생긴 스무 줄**이 된다. 그 스무 줄이
// 정작 읽어야 할 것(일지를 썼다·승인을 기다린다·실패했다)을 화면 밖으로
// 밀어낸다. 그래서 접는다 — 다만 **접으면 안 되는 것**을 먼저 못 박는다.
//
// ## 개입 지점 불변 규칙
//
// `permission` · `error` · `oculpm-*` 는 어떤 경우에도 묶음 안에 들어가지
// 않는다 (`activityTypes.NEVER_FOLD`). 승인은 사람이 눌러야 풀리고, 실패를
// 접으면 그 턴은 성공한 것처럼 읽히고, 원장 기록은 이 화면의 존재 이유다.
// `src/__tests__/activity_group.test.ts` 가 이 불변을 문다.
//
// ## 왜 2패스인가
//
// 한 번에 훑으면서 접으면 "접을 수 있는가"의 판정과 "여기서 끊을 것인가"의
// 판정이 한 줄에 섞인다. 그러면 규칙 하나를 고칠 때마다 다른 하나가 조용히
// 바뀐다. 1패스는 **낱줄의 성질**만 정하고(접을 수 있는가), 2패스는 그
// 성질만 보고 **이웃끼리 붙인다**.

import { isFoldableKind, type ActivityKind, type ActivityStatus } from "./activityTypes";

/** 화면에 서는 활동 한 줄. */
export interface Activity {
  /** React key 이자 원본으로 돌아가는 표. */
  id: string;
  kind: ActivityKind;
  /** 같은 어휘 안의 갈래 (`journal_write`·`Bash`). 문구가 아니라 근거다. */
  verb: string | null;
  status: ActivityStatus;
}

/** 묶기 결과 — 낱줄이거나, 같은 어휘가 이어진 묶음이거나. */
export type ActivityNode<T extends Activity = Activity> =
  | { node: "one"; item: T }
  | { node: "run"; kind: ActivityKind; items: T[] };

/**
 * 묶음이 되는 최소 길이.
 *
 * 둘을 접으면 줄 수가 그대로다 (두 줄 → 묶음 한 줄 + 펼치기). 얻는 것 없이
 * 감추기만 하므로 셋부터 접는다.
 */
export const MIN_RUN = 3;

/**
 * 이 줄을 접어도 되는가 (1패스).
 *
 * 종류가 허락해도 **끝나지 않았거나 실패한 줄은 접지 않는다**: 도는 줄은 그
 * 자체가 진행 상황이고, 실패한 줄은 눈이 찾아야 하는 빨강이다.
 */
export function isFoldable(item: Activity): boolean {
  return isFoldableKind(item.kind) && item.status === "done";
}

/** 이어진 같은 어휘를 묶는다 (2패스). 입력 순서는 그대로 보존된다. */
export function groupActivities<T extends Activity>(items: readonly T[]): ActivityNode<T>[] {
  const marks = items.map(isFoldable);
  const out: ActivityNode<T>[] = [];
  let at = 0;
  while (at < items.length) {
    if (!marks[at]) {
      out.push({ node: "one", item: items[at] });
      at += 1;
      continue;
    }
    let end = at + 1;
    while (end < items.length && marks[end] && items[end].kind === items[at].kind) end += 1;
    const run = items.slice(at, end);
    if (run.length >= MIN_RUN) out.push({ node: "run", kind: items[at].kind, items: run });
    else for (const item of run) out.push({ node: "one", item });
    at = end;
  }
  return out;
}
