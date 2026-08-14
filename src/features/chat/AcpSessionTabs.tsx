import { Plus, X } from "@/components/Icons";
import { ClaudeMark } from "@/components/ClaudeMark";
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
// 백엔드에는 탭이라는 개념이 없다 — 프로젝트당 연결 하나·활성 세션 하나뿐이다.
// 탭은 그 위에 얹은 프런트 개념(오가며 보는 대화 목록)이고, 전환은 이미 있는
// `session/load` 로 그 세션을 다시 여는 것이다.

export interface AcpTab {
  id: string;
  title: string | null;
}

export function AcpSessionTabs({
  tabs,
  activeId,
  onPick,
  onClose,
  onNew,
  busy,
}: {
  tabs: readonly AcpTab[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  busy: boolean;
}) {
  const { t } = useT();

  return (
    <div className="acp-tabs" role="tablist" aria-label={t("acp.tabs.aria")}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const label = tab.title || t("acp.untitledSession");
        return (
          <div key={tab.id} className={"acp-tab" + (active ? " active" : "")}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="acp-tab-main"
              onClick={() => onPick(tab.id)}
              title={label}
            >
              <ClaudeMark size={13} className="acp-tab-mark" />
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
      <button
        type="button"
        className="acp-tab-new"
        onClick={onNew}
        disabled={busy}
        aria-label={t("acp.newConversation")}
        title={t("acp.newConversation")}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
