/**
 * 대화 스레드에 남는 **배너 가족** — 어댑터가 죽었을 때, 기록 도구 없이 대화가
 * 열렸을 때({#mcp-missing-visible}), 그리고 이 대화의 변경이 아직 기록되지
 * 않았을 때({#gate-beyond-cc}). 셋 다 플랜 `v3-record-integrity`.
 *
 * `AcpConversation` 안에 인라인으로 있던 「에이전트 종료」 배너를 여기로 옮겼다.
 * 새 배너가 같은 가족이라 같은 자리에 두는 편이 읽기 쉽고, 그 파일은 이미 크기
 * 래칫에 걸려 있다.
 *
 * ## 왜 이 배너가 필요한가
 *
 * `client_mcp_servers()` 는 `oculpm-mcp` 를 못 찾으면 빈 목록을 돌려주고 세션은
 * 그대로 열렸다. 에이전트에게는 `journal_write` 가 아예 없고, 화면에는 아무
 * 표시도 없다 — **조용한 성공**이다. 여기서 없애는 것은 그 침묵이지 경고의
 * 개수가 아니다: 붙었을 때는 아무 것도 안 뜨고, 못 붙었을 때만 **어디를 찾아
 * 봤는지**와 **무엇을 하면 되는지**가 한 번 뜬다.
 */

import { useEffect, useState } from "react";
import { TriangleAlert } from "@/components/Icons";
import { acpApi } from "@/api/acp";
import type { AcpObjection, AcpProvider, AcpRecordingStatus } from "@/lib/bindings";
import { useT } from "@/i18n";

/**
 * 어댑터 프로세스가 죽었다. 이 배너가 없으면 마지막 상태가 그대로 남아
 * **아무 일도 없는 척**한다 — 보내면 그때서야 오류가 난다.
 */
export function AgentGoneNotice({
  starting,
  onReconnect,
}: {
  starting: boolean;
  onReconnect: () => void;
}) {
  const { t } = useT();
  return (
    <div className="failure" role="status">
      <span className="failure-icon">
        <TriangleAlert size={13} />
      </span>
      <span className="failure-body">
        <span className="failure-title">{t("acp.agentGone")}</span>
        <span className="failure-details">{t("acp.agentGoneSub")}</span>
      </span>
      <button
        type="button"
        className="btn sm primary failure-act"
        disabled={starting}
        onClick={onReconnect}
      >
        {t("acp.reconnect")}
      </button>
    </div>
  );
}

/**
 * 기록 도구가 안 붙은 채로 열린 대화를 알린다.
 *
 * 백엔드가 **세션을 열 때 실제로 일어난 일**을 적어 두고 이쪽은 그것을 읽기만
 * 한다 (`acp_recording_status`). 여기서 다시 탐색하면 "지금은 있는데 그때는
 * 없었다"를 말할 수 없다.
 *
 * `sessionId` 가 바뀔 때마다 다시 묻는다 — 배너는 **세션이 열린 뒤**에만 뜬다.
 * 닫으면 이 화면이 살아 있는 동안 다시 안 뜬다(저장하지 않는다 — 기계 상태가
 * 바뀌면 다음 실행에서 다시 말해야 한다).
 */
export function RecordingNotice({
  projectId,
  provider,
  sessionId,
}: {
  projectId: number;
  provider?: AcpProvider;
  sessionId: string | null;
}) {
  const { t } = useT();
  const [status, setStatus] = useState<AcpRecordingStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    acpApi
      .recordingStatus(projectId, provider ?? null)
      .then((next) => {
        if (alive) setStatus(next);
      })
      // 진단이 실패했다고 대화 위에 또 다른 오류를 얹지 않는다.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, provider, sessionId]);

  // 붙었으면 조용하다. 아직 모르면(연 적 없음·조회 실패) 아무 말도 안 한다 —
  // 모르는 것을 "없다"로 말하는 것이 이 항목이 고치려는 바로 그 잘못이다.
  if (!status || status.attached || dismissed) return null;

  return (
    <div className="failure warning" role="status">
      <span className="failure-icon">
        <TriangleAlert size={13} />
      </span>
      <span className="failure-body">
        <span className="failure-title">{t("acp.recording.title")}</span>
        <span className="failure-details">{t("acp.recording.body")}</span>
        {status.searched.length ? (
          <span className="failure-details">
            {t("acp.recording.searched")}
            {"\n"}
            {status.searched.join("\n")}
          </span>
        ) : null}
        <span className="failure-details">{t("acp.recording.fix")}</span>
      </span>
      <button
        type="button"
        className="btn sm failure-act"
        onClick={() => setDismissed(true)}
      >
        {t("acp.recording.dismiss")}
      </button>
    </div>
  );
}

/**
 * **배달 게이트의 앱 안 얼굴** (플랜 `v3-record-integrity` {#gate-beyond-cc}).
 *
 * Claude Code 는 `Stop` 훅에서 `exit 2` 로 턴을 되돌려 기록을 강제할 수 있다.
 * 앱 안 ACP 대화에는 그 수단이 없다 — 프로토콜에 "이 턴을 물리고 다시 시키기"가
 * 없고, 있다 해도 사용자가 보고 있는 대화에서 앱이 말없이 턴을 한 번 더 돌리는
 * 것은 게이트가 아니라 유령이다. 그래서 **차단 대신 배너 하나**다.
 *
 * 소음이 되지 않게 지키는 규율 셋 (셸 게이트에서 그대로 가져왔다):
 *
 * 1. **대화당 한 번만 발화한다** — 백엔드가 `.delivery-gate-<대화>` 플래그를
 *    CC 훅과 같은 파일로 공유한다.
 * 2. **기록하면 사라진다** — 턴마다 다시 판정해서 이의가 풀리면 백엔드가
 *    배너를 거두고, 여기서는 `null` 이 돌아와 사라진다.
 * 3. **닫으면 그 대화에서는 끝** — 닫힘을 백엔드에 알려 다음 턴에도 안 뜬다.
 *
 * 조용한 성공도 아니다: 발화 순간 신호 원장에 줄이 남아 Today 카드와 회고의
 * 상시 한 줄이 센다. 배너를 못 보고 지나가도 숫자는 남는다.
 *
 * `turnKey` 가 바뀔 때마다 다시 묻는다 — 판정은 **턴이 끝난 순간**에 내려지므로
 * 그 전에 물으면 늘 한 턴 뒤진 답을 본다.
 *
 * 호출부가 넘기는 `busy` 가 그 열쇠로 맞는 이유: `busy` 는 스트림의 `done`
 * 이벤트가 아니라 **`acp_prompt` 커맨드가 반환한 뒤** 내려간다(`send` 의
 * `finally`). 백엔드는 그 반환 직전에 판정을 끝내므로, 이 조회는 이번 턴의
 * 판정을 본다. 순서가 뒤집히면 배너가 늘 한 턴 늦게 뜬다.
 */
export function JournalGateNotice({
  sessionId,
  turnKey,
}: {
  sessionId: string | null;
  turnKey: unknown;
}) {
  const { t } = useT();
  const [objection, setObjection] = useState<AcpObjection | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setObjection(null);
      return;
    }
    let alive = true;
    acpApi
      .journalObjection(sessionId)
      .then((next) => {
        // 다른 대화의 답이 늦게 도착해 이 대화 위에 뜨는 일이 없게 한 번 더 짚는다.
        if (alive && (!next || next.acp_session_id === sessionId)) setObjection(next);
      })
      // 판정을 못 읽었다고 대화 위에 또 다른 오류를 얹지 않는다.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId, turnKey]);

  if (!objection) return null;

  return (
    <div className="failure warning" role="status">
      <span className="failure-icon">
        <TriangleAlert size={13} />
      </span>
      <span className="failure-body">
        <span className="failure-title">{t("acp.gate.title")}</span>
        <span className="failure-details">{objection.reason}</span>
        <span className="failure-details">
          {t("acp.gate.files")}
          {"\n"}
          {objection.changed.join("\n")}
        </span>
        <span className="failure-details">{objection.action}</span>
      </span>
      <button
        type="button"
        className="btn sm failure-act"
        onClick={() => {
          setObjection(null);
          void acpApi.dismissJournalObjection(objection.acp_session_id).catch(() => {});
        }}
      >
        {t("acp.gate.dismiss")}
      </button>
    </div>
  );
}
