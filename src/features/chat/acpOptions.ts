import type { AcpConfigOption } from "@/lib/bindings";

// 설정 한 벌이 **정말로 달라졌는가**.
//
// 되읽기(`acp_options`)는 매번 새 배열을 준다 — 값이 그대로여도 그렇다. 그것을
// 그대로 상태에 넣으면 `session` 객체의 아이덴티티가 바뀌고, 그 아이덴티티에
// 걸려 있던 효과가 다시 돌면서 되읽기를 또 부른다. 되읽기 → 새 객체 → 되읽기.
//
// 실제로 그렇게 돌았다: 화면이 보이는 동안 `acp_status`·`acp_options`·
// `acp_session_title`·`acp_list_sessions` 가 초당 수천 번씩 나갔고, 마지막
// 것은 어댑터로 나가는 **진짜 JSON-RPC 왕복**이라 Claude Code 프로세스까지
// 함께 두들겼다. 화면에는 아무 일도 안 일어나므로 눈으로는 안 보인다.
//
// 그래서 "달라졌을 때만 갈아 끼운다". 깊은 비교를 하는 이유는 얕은 비교로는
// 답이 언제나 "달라졌다"이기 때문이다.

function sameChoices(
  left: AcpConfigOption["choices"],
  right: AcpConfigOption["choices"],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((choice, i) => {
    const other = right[i];
    return (
      choice.value === other.value &&
      choice.name === other.name &&
      choice.description === other.description
    );
  });
}

/** 두 설정 목록이 화면에 같은 것을 그리는가 (순서까지 포함해서). */
export function sameOptions(
  left: readonly AcpConfigOption[],
  right: readonly AcpConfigOption[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((option, i) => {
    const other = right[i];
    return (
      option.id === other.id &&
      option.name === other.name &&
      option.category === other.category &&
      option.current === other.current &&
      option.is_boolean === other.is_boolean &&
      sameChoices(option.choices, other.choices)
    );
  });
}
