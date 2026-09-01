/**
 * 설정 → 데이터 → 선언적 설정 (Osaurus 라운드 Phase 6 `#config-approval-card`).
 *
 * 설정을 **원하는 상태**로 적은 YAML 한 장을 내보내고, 남의 문서를 열어
 * 무엇이 달라지는지 **먼저 보여 준 뒤** 적용한다.
 *
 * `useConfirm()` 을 쓰지 않는 이유: 파괴 확인이 아니라 **계산 결과 검토**다.
 * "정말 하시겠습니까" 로 접을 수 있는 판단이 아니라 목록을 봐야 하는 판단이라
 * 전용 카드로 편다.
 *
 * 그리고 「적용 완료」는 apply 호출의 성공이 아니라 **적용 뒤 다시 계획한
 * 결과가 비었을 때**만 말한다 (`#config-verify`) — 백엔드가 준 `residual` 이
 * 0 이 아니면 카드도 "일부만 적용됨" 이라고 적는다.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, FileCode, Loader2 } from "@/components/Icons";
import { declarativeConfigApi } from "@/api/declarativeConfig";
import { toAppError } from "@/api/invoke";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";
import type { ConfigApplyResult, ConfigPlan, ConfigPlanItem } from "@/lib/bindings";
import { Section } from "../tabs/ui";
import { groupPlan, hasWrites, reasonKey, surfaceLabelKey, type VisibleOp } from "./planView";

const OP_MARK: Record<VisibleOp, string> = { add: "+", change: "~", blocked: "⚠" };
const OP_TONE: Record<VisibleOp, string> = {
  add: "text-[color:var(--primary)]",
  change: "text-foreground",
  blocked: "text-muted-foreground",
};

export function DeclarativeConfigSection() {
  const { t } = useT();
  const { state } = useWorkspace();
  const projectId = state.currentProjectId;

  const [doc, setDoc] = useState<string | null>(null);
  const [plan, setPlan] = useState<ConfigPlan | null>(null);
  const [result, setResult] = useState<ConfigApplyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setDoc(null);
    setPlan(null);
    setResult(null);
  };

  const exportDoc = async () => {
    setBusy(true);
    try {
      const path = await declarativeConfigApi.exportToFile(projectId);
      if (path) toast.info(t("settings.declarative.exported", { path }));
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async () => {
    setBusy(true);
    try {
      const text = await declarativeConfigApi.readFile();
      if (text == null) return;
      // 문서를 열자마자 계획한다 — 사용자가 "계획" 버튼을 따로 누르게 하면
      // 문서를 연 상태와 계획을 본 상태가 갈라진다.
      const next = await declarativeConfigApi.plan(projectId, text);
      setDoc(text);
      setPlan(next);
      setResult(null);
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const applyDoc = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const outcome = await declarativeConfigApi.apply(projectId, doc);
      setResult(outcome);
      // 적용 뒤의 상태로 계획을 다시 그린다 — 카드가 방금 쓴 값을 여전히
      // "바꿀 것" 으로 보여 주면 무엇이 됐는지 알 수 없다.
      setPlan(await declarativeConfigApi.plan(projectId, doc));
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t("settings.declarative.title")}
      description={t("settings.declarative.desc")}
    >
      <div className="flex gap-2">
        <Button variant="outline" onClick={exportDoc} disabled={busy} className="flex-1">
          <Download className="w-3.5 h-3.5 mr-2" />
          {t("settings.declarative.export")}
        </Button>
        <Button variant="outline" onClick={openDoc} disabled={busy} className="flex-1">
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <FileCode className="w-3.5 h-3.5 mr-2" />
          )}
          {t("settings.declarative.open")}
        </Button>
      </div>

      {plan && (
        <div className="rounded-lg border border-border bg-background p-3 space-y-3">
          <p className="text-sm font-medium text-foreground">
            {t("settings.declarative.card.title")}
          </p>

          {groupPlan(plan).map((group) => (
            <ul key={group.op} className="space-y-1">
              {group.items.map((item) => (
                <PlanRow key={`${item.surface}:${item.key}`} op={group.op} item={item} />
              ))}
            </ul>
          ))}

          <p className="text-xs text-muted-foreground">
            {t("settings.declarative.card.unchanged", { count: String(plan.unchanged) })}
          </p>

          {result ? (
            <ApplyOutcome result={result} />
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} disabled={busy} className="flex-1">
                {t("common.cancel")}
              </Button>
              <Button onClick={applyDoc} disabled={busy || !hasWrites(plan)} className="flex-1">
                {t("settings.declarative.card.apply")}
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function PlanRow({ op, item }: { op: VisibleOp; item: ConfigPlanItem }) {
  const { t } = useT();
  const surface = t(surfaceLabelKey(item.surface));
  const detail =
    op === "add"
      ? t("settings.declarative.row.add", { value: item.to ?? "" })
      : op === "change"
        ? t("settings.declarative.row.change", { from: item.from ?? "", to: item.to ?? "" })
        : t("settings.declarative.row.blocked", { reason: t(reasonKey(item.reason)) });
  return (
    <li className={`text-xs font-mono flex gap-2 ${OP_TONE[op]}`}>
      <span aria-hidden="true" className="w-3 flex-shrink-0">
        {OP_MARK[op]}
      </span>
      <span className="flex-1 break-all">
        <span className="text-muted-foreground">{surface}</span> {item.key} — {detail}
      </span>
    </li>
  );
}

/**
 * 결말. `status` 는 백엔드가 **대조 검증까지 마친 뒤** 낸 결론이다 —
 * 프런트가 "쓴 개수 > 0 이니 성공" 이라고 다시 판단하지 않는다.
 */
function ApplyOutcome({ result }: { result: ConfigApplyResult }) {
  const { t } = useT();
  const tone =
    result.status === "partial" ? "text-destructive" : "text-[color:var(--primary)]";
  return (
    <div className="space-y-1.5 pt-1 border-t border-border/60">
      <p className={`text-sm font-medium ${tone}`}>
        {result.status === "applied"
          ? t("settings.declarative.done.applied", { count: String(result.applied.length) })
          : result.status === "no_op"
            ? t("settings.declarative.done.noop")
            : t("settings.declarative.done.partial", {
                count: String(result.applied.length),
                failed: String(result.failed.length),
                residual: String(result.residual),
              })}
      </p>
      {result.failed.map((f) => (
        <p key={`${f.surface}:${f.key}`} className="text-xs font-mono text-destructive/80">
          {f.key} — {f.detail}
        </p>
      ))}
    </div>
  );
}
