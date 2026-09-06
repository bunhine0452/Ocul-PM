import { describe, expect, it } from "vitest";

import {
  ACTIVITY_KINDS,
  ATTENTION_KINDS,
  NEVER_FOLD,
  OCULPM_KINDS,
  type ActivityKind,
} from "@/features/chat/activity/activityTypes";
import { groupActivities, MIN_RUN, type Activity } from "@/features/chat/activity/group";

// 플랜 v3-surface {#activity-group}.
//
// 개입 지점 불변 규칙 — permission·error·oculpm-* 는 절대 안 접힌다. 접는다는
// 것은 "훑고 지나가도 된다"는 말인데, 승인은 사람이 눌러야 풀리고 실패를
// 접으면 성공한 턴처럼 읽히고 원장 기록은 이 화면의 존재 이유다.

let seq = 0;
function item(kind: ActivityKind, status: Activity["status"] = "done"): Activity {
  seq += 1;
  return { id: `a${seq}`, kind, verb: null, status };
}

function foldedKinds(nodes: ReturnType<typeof groupActivities>): ActivityKind[] {
  return nodes.flatMap((node) => (node.node === "run" ? [node.kind] : []));
}

describe("활동 묶기", () => {
  it("같은 어휘가 셋 이상 이어지면 묶는다", () => {
    const nodes = groupActivities([item("read"), item("read"), item("read")]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ node: "run", kind: "read" });
  });

  it("둘은 안 묶는다 — 줄 수가 그대로라 감추기만 한다", () => {
    const nodes = groupActivities([item("read"), item("read")]);
    expect(nodes.every((n) => n.node === "one")).toBe(true);
    expect(MIN_RUN).toBe(3);
  });

  it("어휘가 다르면 끊긴다", () => {
    const nodes = groupActivities([item("read"), item("read"), item("edit"), item("read")]);
    expect(foldedKinds(nodes)).toEqual([]);
  });

  it("순서는 그대로다", () => {
    const items = [item("read"), item("shell"), item("read")];
    const nodes = groupActivities(items);
    expect(nodes.map((n) => (n.node === "one" ? n.item.id : n.items[0].id))).toEqual(
      items.map((i) => i.id),
    );
  });

  it("도는 줄과 실패한 줄은 접지 않는다", () => {
    expect(
      foldedKinds(groupActivities([item("read"), item("read", "running"), item("read")])),
    ).toEqual([]);
    expect(
      foldedKinds(groupActivities([item("read"), item("read", "failed"), item("read")])),
    ).toEqual([]);
  });
});

describe("개입 지점 불변 규칙", () => {
  it("승인·실패·우리 원장 셋은 어떤 길이로도 안 접힌다", () => {
    for (const kind of NEVER_FOLD) {
      const nodes = groupActivities([item(kind), item(kind), item(kind), item(kind), item(kind)]);
      expect(nodes.every((n) => n.node === "one")).toBe(true);
    }
  });

  it("NEVER_FOLD 는 acpBusyBus 의 attention 개념 + 실패 + 우리 셋을 모두 담는다", () => {
    for (const kind of ATTENTION_KINDS) expect(NEVER_FOLD.has(kind)).toBe(true);
    for (const kind of OCULPM_KINDS) expect(NEVER_FOLD.has(kind)).toBe(true);
    expect(NEVER_FOLD.has("error")).toBe(true);
  });

  it("어휘가 자라도 묶음 안에는 절대 이 셋이 안 들어간다", () => {
    // 15낱말을 통째로 한 줄에 늘어놓고 묶어도 결과는 같다.
    const nodes = groupActivities(ACTIVITY_KINDS.flatMap((kind) => [item(kind), item(kind), item(kind)]));
    for (const node of nodes) {
      if (node.node !== "run") continue;
      expect(NEVER_FOLD.has(node.kind)).toBe(false);
      for (const folded of node.items) expect(NEVER_FOLD.has(folded.kind)).toBe(false);
    }
  });

  it("어휘는 15낱말이고 우리 값어치는 그중 셋이다", () => {
    expect(ACTIVITY_KINDS).toHaveLength(15);
    expect([...OCULPM_KINDS].sort()).toEqual(["oculpm-a2a", "oculpm-journal", "oculpm-plan"]);
  });
});
