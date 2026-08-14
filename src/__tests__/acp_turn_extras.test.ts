import { describe, expect, it } from "vitest";
import { openTurn } from "@/features/chat/acpTurns";

// 사용자 발화에 딸려 보낸 것 — 컴포저의 칩은 보내는 순간 사라지므로 턴에 남긴다.

const IMAGE = { src: "data:image/png;base64,AAA", name: "shot.png", width: 1104, height: 172 };

describe("openTurn extras", () => {
  it("keeps attachments and images on the user turn", () => {
    const [user] = openTurn([], "look at this", {
      attachments: ["src/a.ts"],
      images: [IMAGE],
    });
    expect(user.attachments).toEqual(["src/a.ts"]);
    expect(user.images).toEqual([IMAGE]);
  });

  /** 빈 배열을 남기면 화면이 "첨부 줄"을 그리고 그 안이 비어 여백만 생긴다. */
  it("omits the fields entirely when nothing was attached", () => {
    const [user] = openTurn([], "plain", { attachments: [], images: [] });
    expect(user.attachments).toBeUndefined();
    expect(user.images).toBeUndefined();
  });

  /** 나중에 컴포저 상태를 비워도 이미 보낸 턴은 그대로여야 한다. */
  it("copies the arrays instead of aliasing the caller's", () => {
    const attachments = ["src/a.ts"];
    const [user] = openTurn([], "hi", { attachments });
    attachments.length = 0;
    expect(user.attachments).toEqual(["src/a.ts"]);
  });

  it("still opens an empty agent turn to receive the answer", () => {
    const turns = openTurn([], "hi");
    expect(turns).toHaveLength(2);
    expect(turns[1]).toEqual({ role: "agent", text: "" });
  });
});
