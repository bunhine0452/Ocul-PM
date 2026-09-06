// 아직 대화가 없을 때의 두 화면 — 어댑터가 안 붙은 자리와, 붙었는데 빈 자리.
//
// `AcpConversation.tsx` 에서 갈라 나온 **순수 뷰**다 (v3-surface {#acp-split}).
// 둘을 한 파일에 둔 이유는 같은 마크(`.ai-start`)를 쓰기 때문이다 — 한쪽만
// 고치면 두 화면의 첫인상이 갈라진다.

import { openSettings } from "@/lib/settingsNav";
import { ClaudeMark, CLAUDE_ORANGE } from "@/components/ClaudeMark";
import { CodexMark } from "@/components/CodexMark";
import { useT } from "@/i18n";

/** 제목 줄의 마크 — 색 상자에 넣어 가운데 띄우는 히어로는 뺐다 (de-AI). */
function Mark({ codex }: { codex: boolean }) {
  return codex ? (
    <CodexMark size={17} aria-hidden="true" />
  ) : (
    <ClaudeMark size={17} style={{ color: CLAUDE_ORANGE }} aria-hidden="true" />
  );
}

/**
 * 어댑터가 아직 안 붙었다.
 *
 * 오류 문구만 두면 사용자가 할 수 있는 일이 "다시 시도" 뿐이다(눌러도 같은
 * 곳에서 같은 이유로 막힌다). 그래서 설치·재시도·설정 세 갈래를 준다.
 */
export function AcpOffPanel({
  codex,
  starting,
  needsInstall,
  error,
  onInstall,
  onRetry,
}: {
  codex: boolean;
  starting: boolean;
  needsInstall: boolean;
  error: string | null;
  onInstall: () => void;
  onRetry: () => void;
}) {
  const { t } = useT();
  return (
    <div className="ai-wrap">
      <div className="ai-thread">
        <div className="ai-thread-inner">
          <div className="ai-start">
            <div className="ai-start-title">
              <Mark codex={codex} />
              {starting ? t(codex ? "acp.codex.preparing" : "acp.preparing") : t("acp.offTitle")}
            </div>
            <div className="ai-start-sub">
              {needsInstall
                ? t("acp.installAdapterSub")
                : t(codex ? "acp.codex.offSub" : "acp.offSub")}
            </div>
            {starting ? null : (
              <div className="ai-start-actions">
                {needsInstall ? (
                  <button className="btn sm primary" onClick={onInstall}>
                    {t("acp.installAdapter")}
                  </button>
                ) : null}
                <button
                  className={needsInstall ? "btn sm" : "btn sm primary"}
                  onClick={onRetry}
                >
                  {t("acp.retry")}
                </button>
                {/* 문구가 가리키던 "설정 → 통합" 은 없는 경로였다 — 버튼으로. */}
                <button className="btn sm" onClick={() => openSettings("oculpm")}>
                  {t("acp.openSettings")}
                </button>
              </div>
            )}
            {error && <div className="msg-error">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 붙었는데 아직 아무 말도 안 한 대화.
 *
 * **조용해야 한다** — 칩을 늘어놓으면 "무엇을 시킬까"를 고르는 화면이 되고,
 * 정작 하려던 말을 밀어낸다. 마크 하나와 두 줄이면 충분하다.
 */
export function AcpReadyPanel({ codex }: { codex: boolean }) {
  const { t } = useT();
  return (
    <div className="ai-start">
      <div className="ai-start-title">
        <Mark codex={codex} />
        {t("acp.readyTitle")}
      </div>
      <div className="ai-start-sub">{t("acp.readySub")}</div>
    </div>
  );
}
