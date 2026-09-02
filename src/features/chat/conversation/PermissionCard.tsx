// 권한 요청 카드 — 에이전트가 승인을 기다릴 때.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { Code2, TriangleAlert } from "@/components/Icons";
import { useT } from "@/i18n";
import { AcpDiffView } from "../AcpDiffView";
import { clearsContext } from "./permissionOptions";
import { TOOL_ICON, type PermissionState } from "./shared";

/**
 * 승인 카드. 응답할 때까지 에이전트가 멈춰 있으므로 **닫기 버튼을 두지 않는다** —
 * 카드를 그냥 없애면 에이전트가 영영 기다린다. 나가는 길은 선택지뿐.
 */
export function PermissionCard({
  request,
  onDecide,
}: {
  request: PermissionState;
  onDecide: (requestId: string, optionId: string | null) => void;
}) {
  const { t } = useT();
  // 어댑터는 선택지 순서를 보장하지 않는다 — 실측(2026-08-14)에서 `Deny` 가
  // **첫 항목**으로 왔다. 강조는 순서가 아니라 kind 로 고르고, 우리 폴백 거절
  // 버튼은 어댑터가 거절 선택지를 안 줬을 때만 낸다(중복 방지).
  const hasReject = request.options.some((option) => option.option_kind.startsWith("reject"));
  // 계획을 수락하면서 **대화를 비우는** 선택지가 섞여 있으면, 무엇이 사라지는지
  // 버튼 위에 미리 적는다 — 누른 뒤에 알게 되면 늦다.
  const hasClearContext = request.options.some((option) => clearsContext(option.id));
  const Icon = TOOL_ICON[request.tool_kind] ?? Code2;
  // 명령 실행·삭제는 편집보다 대가가 크다 — 카드의 낯빛이 달라야 손이 느려진다.
  const risky = request.tool_kind === "execute" || request.tool_kind === "delete";

  return (
    <div
      className={"perm" + (risky ? " danger" : "")}
      role="group"
      aria-label={t("acp.perm.title")}
      // 승인 카드는 에이전트가 **멈추는 유일한 순간**이다 — 읽어 주는 기계에도
      // 도착이 알려져야 한다. 포커스는 뺏지 않는다: 컴포저에 치던 Enter 가
      // 허용 버튼 위에서 눌리는 사고가 더 나쁘다.
      aria-live="polite"
    >
      <div className="perm-head">
        <TriangleAlert size={13} />
        {t("acp.perm.title")}
      </div>
      <div className="perm-what">
        <Icon size={14} style={{ color: "var(--text-3)", flex: "none" }} />
        <span className="perm-title">{request.title || t("acp.tool.untitled")}</span>
        {request.locations.length ? (
          <span className="perm-path" title={request.locations.join("\n")}>
            {request.locations[0]}
            {request.locations.length > 1 ? ` +${request.locations.length - 1}` : ""}
          </span>
        ) : null}
      </div>
      {/* **무엇을 허용하는지가 카드 안에 있다.** 예전엔 제목과 경로뿐이라
          내용을 보려면 위의 도구 카드를 스스로 찾아 펼쳐야 했다 — 사실상
          블라인드 승인이었다. 실행이면 명령을, 편집이면 diff 를 그대로 보인다. */}
      {request.input ? (
        <div className="perm-payload">
          <div className="trace-io">
            <span className="trace-io-tag">IN</span>
            <pre>{request.input}</pre>
          </div>
        </div>
      ) : null}
      {request.diffs.length ? (
        <div className="perm-payload">
          <AcpDiffView diffs={request.diffs} />
        </div>
      ) : null}
      {hasClearContext ? <p className="perm-note">{t("acp.perm.clearContext")}</p> : null}
      <div className="perm-actions">
        {request.options.map((option) => (
          <button
            key={option.id}
            // "이번만 허용"만 초록이다. "항상 허용"은 영구 권한 부여라 1회
            // 허용과 같은 무게로 빛나면 안 된다. 컨텍스트를 비우는 선택지는
            // 허용이 아니라 **버리기**라, 허용 계열 어느 쪽과도 같은 낯빛을
            // 쓰지 않는다.
            className={
              "btn sm " +
              (clearsContext(option.id)
                ? "perm-destructive"
                : option.option_kind === "allow_once"
                  ? "primary"
                  : option.option_kind.startsWith("allow")
                    ? "perm-always"
                    : "ghost")
            }
            onClick={() => onDecide(request.request_id, option.id)}
          >
            {option.name}
          </button>
        ))}
        {hasReject ? null : (
          <button className="btn sm ghost" onClick={() => onDecide(request.request_id, null)}>
            {t("acp.perm.reject")}
          </button>
        )}
      </div>
    </div>
  );
}
