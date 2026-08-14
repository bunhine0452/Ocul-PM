import { OculIcon, X } from "@/components/Icons";
import { useT } from "@/i18n";

// PR-ACP14 — 세션 탭.
//
// 백엔드는 프로젝트당 활성 세션 하나만 안다. 탭은 그 위에 얹은 프런트 개념이다
// — "오가며 보는 대화들"의 목록이고, 전환은 그 세션을 다시 여는 것(session/load)
// 이다. 덕분에 백엔드에 새 개념을 만들지 않고도 성립한다.

export interface AcpTab {
  id: string;
  title: string | null;
}

export function AcpSessionTabs({
  tabs,
  activeId,
  onPick,
  onClose,
}: {
  tabs: AcpTab[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useT();
  // 탭이 하나뿐이면 줄을 그리지 않는다 — 고를 것이 없는 탭바는 자리만 먹는다.
  if (tabs.length < 2) return null;

  return (
    <div className="acp-tabs" role="tablist" aria-label={t("acp.tabs.aria")}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div key={tab.id} className={"acp-tab" + (active ? " active" : "")}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="acp-tab-main"
              onClick={() => onPick(tab.id)}
              title={tab.title ?? t("acp.untitledSession")}
            >
              <OculIcon size={13} className="acp-tab-mark" />
              <span className="acp-tab-title">
                {tab.title || t("acp.untitledSession")}
              </span>
            </button>
            <button
              type="button"
              className="acp-tab-close"
              onClick={() => onClose(tab.id)}
              aria-label={t("acp.tabs.close")}
              title={t("acp.tabs.close")}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
