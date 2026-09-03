import { memo } from "react";
import { X } from "@/components/Icons";
import { AgentMark } from "@/components/AgentMark";
import { useT } from "@/i18n";

// PR-ACP14 — 상단바를 대신하는 세션 탭 줄.
//
// 여기는 원래 "Claude Code / Claude Code 를 앱 안에서 구동" 이라는 제목+설명이
// 있던 자리다. 둘 다 지웠다: 화면 이름은 사이드바가 이미 말하고 있고, 설명은
// 처음 한 번 읽고 나면 영영 쓸모가 없는데 창에서 제일 좋은 자리를 차지한다.
//
// 대신 **지금 열어 둔 대화들**을 건다. 상단바에서 알고 싶은 것은 "이 화면이
// 무엇인가"가 아니라 "나는 어느 대화에 있는가"이고, 그 답은 탭 줄이 제목과
// 전환을 한 몸으로 준다.
//
// 백엔드에는 탭이라는 개념이 없다 — 프로젝트당 어댑터 연결 하나가 전부다.
// 탭은 그 위에 얹은 프런트 개념(오가며 보는 대화 목록)이고, 전환은 이미 있는
// `session/load` 로 그 세션을 다시 여는 것이다.
//
// 다만 그 연결 하나 위에서 **대화 여럿이 동시에 돈다**(2026-08-20). 그래서 탭은
// "번갈아 보는 창"이면서 동시에 "각자 돌고 있는 것들"이다 — 지금 안 보고 있는
// 탭도 답을 받는 중일 수 있다.

export interface AcpTab {
  id: string;
  title: string | null;
  /**
   * **아직 안 만들어진** 대화 (새 세션 버튼을 누른 직후).
   *
   * 세션은 첫 마디를 보낼 때 비로소 생긴다 — 그전까지는 백엔드에도 지난 대화
   * 목록에도 없다. 그런데 탭 줄이 그것까지 없는 셈 치니, 새 세션을 눌러도
   * 상단바는 방금 떠나온 대화를 그대로 가리키고 있었다("눌러도 아무 일도 안
   * 일어난다"). 이 탭은 그 사이를 메우는 표시이고, 첫 마디와 함께 진짜 탭이
   * 된다 (그래서 목록에 저장하지 않는다 — 화면에서만 산다).
   */
  pending?: boolean;
}

/**
 * 답이 흐르는 동안 대화 화면은 초당 수십 번 다시 그려진다 — 탭 줄은 그 리듬과
 * 아무 상관이 없다. props 가 그대로면 여기서 멈춘다 (부모가 `tabs` 배열과
 * 콜백을 안정적으로 넘겨 준다).
 */
export const AcpSessionTabs = memo(function AcpSessionTabs({
  provider = "claude",
  tabs,
  activeId,
  onPick,
  onClose,
}: {
  /**
   * 이 탭 줄이 어느 어댑터의 것인가 — 마크를 고르는 데만 쓴다.
   *
   * 타입을 `AcpConversation` 에서 가져오지 않는 이유는 그쪽이 이 파일을
   * 가져오기 때문이다 (순환). 값이 둘뿐이라 여기 적는 편이 싸다.
   */
  provider?: "claude" | "codex";
  tabs: readonly AcpTab[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useT();
  // `AgentMark` 의 라우팅 표를 그대로 쓴다 — 마크를 고르는 자리가 둘이 되면
  // 한쪽만 새 어댑터를 알게 된다.
  const agentId = provider === "codex" ? "codex" : "claude-code";

  /**
   * ←/→ 로 탭을 오간다 (ARIA tabs 관례). 활성 탭만 Tab 키 순서에 남긴다 —
   * 탭이 여덟이면 Tab 을 여덟 번 눌러야 지나갈 수 있었다.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const at = tabs.findIndex((tab) => tab.id === activeId);
    if (at === -1 || tabs.length < 2) return;
    e.preventDefault();
    const next = (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onPick(tabs[next].id);
  };

  return (
    <div className="acp-tabs" role="tablist" aria-label={t("acp.tabs.aria")} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const label = tab.pending
          ? t("acp.newConversation")
          : tab.title || t("acp.untitledSession");
        return (
          <div
            key={tab.id}
            className={"acp-tab" + (active ? " active" : "") + (tab.pending ? " pending" : "")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className="acp-tab-main"
              onClick={() => onPick(tab.id)}
              title={label}
            >
              {/* 탭마다 **그 어댑터의** 마크. 예전엔 Claude 마크가 박혀 있어
                  Codex 대화에도 Claude 로고가 붙었다 — 두 어댑터를 나란히 쓰면
                  탭 줄이 거짓말을 하는 셈이다. */}
              <AgentMark agentId={agentId} size={13} className="acp-tab-mark" />
              <span className="acp-tab-title">{label}</span>
            </button>
            {/* 마지막 하나는 닫지 못한다 — 닫으면 제목도 전환할 곳도 없는 빈
                줄이 남는다. 대화를 없애는 것은 목록의 삭제이지 탭 닫기가 아니다. */}
            {tabs.length > 1 ? (
              <button
                type="button"
                className="acp-tab-close"
                onClick={() => onClose(tab.id)}
                aria-label={t("acp.tabs.close")}
                title={t("acp.tabs.close")}
              >
                <X size={11} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
