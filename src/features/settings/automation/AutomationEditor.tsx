// 자동화 에디터 — 2-pane 의 오른쪽.
//
//   종류 → (스케줄) 빈도·시각  |  (워처) 감시 경로·재귀·반응성
//        → 출력 → 지시문 → 상시 도움말 → 문제 해결 3종
//
// 지시문 아래의 도움말은 **상시 노출**이다 (설계 §1.3·§2.4·§2.5). 사용자가
// 여기 쓰는 문장이 그대로 모델에게 가고, 자동화는 여러 번 돌 수 있다 — 그 두
// 사실을 모르면 결과가 이상해지고 원인을 못 찾는다. 문제 해결 3종은 진단 탭과
// **같은 컴포넌트**라 두 화면의 말이 갈라지지 않는다.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import type { AutomationDef } from "@/lib/bindings";
import { Field } from "../tabs/ui";
import {
  FREQUENCIES,
  KINDS,
  OUTPUTS,
  RESPONSIVENESS,
  WEEKDAYS,
  fieldsFor,
  localValidation,
  slugify,
  switchKind,
} from "./automationModel";
import { AutomationTroubleshooting } from "./AutomationTroubleshooting";

const SELECT_CLASS =
  "w-full h-9 rounded-md border border-input bg-background px-3 text-sm";

export function AutomationEditor({
  value,
  isNew,
  busy,
  onCancel,
  onSave,
}: {
  value: AutomationDef;
  isNew: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (def: AutomationDef) => void;
}) {
  const { t } = useT();
  const [def, setDef] = useState<AutomationDef>(value);
  const patch = (p: Partial<AutomationDef>) => setDef((d) => ({ ...d, ...p }));
  const isWatcher = def.kind === "watcher";
  const fields = fieldsFor(def.frequency ?? "");
  const problem = localValidation(def);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && !busy) onSave(def);
      }}
    >
      <Field label={t("automation.editor.title")}>
        <Input
          value={def.title}
          autoFocus
          onChange={(e) => {
            const title = e.currentTarget.value;
            // 새 정의일 때만 id 를 제목에서 따라 만든다 — 기존 정의의 id 를
            // 바꾸면 파일이 옮겨지고 실행 이력이 끊긴다.
            patch(isNew ? { title, id: slugify(title) } : { title });
          }}
        />
      </Field>

      <Field label={t("automation.editor.id")} hint={t("automation.editor.idHint")}>
        <Input
          value={def.id}
          disabled={!isNew}
          onChange={(e) => patch({ id: slugify(e.currentTarget.value) })}
        />
      </Field>

      <Field label={t("automation.editor.kind")} hint={t("automation.editor.kindHint")}>
        <select
          className={SELECT_CLASS}
          value={def.kind}
          disabled={!isNew}
          onChange={(e) =>
            setDef((d) => switchKind(d, e.currentTarget.value as AutomationDef["kind"]))
          }
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`automation.kindName.${k}` as never)}
            </option>
          ))}
        </select>
      </Field>

      {isWatcher && (
        <>
          <Field label={t("automation.editor.watch")} hint={t("automation.editor.watchHint")}>
            <Input
              value={def.watch ?? ""}
              spellCheck={false}
              placeholder="src/"
              onChange={(e) => patch({ watch: e.currentTarget.value })}
            />
          </Field>

          <Field label={t("automation.editor.recursive")}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={def.recursive !== false}
                onChange={(e) => patch({ recursive: e.currentTarget.checked })}
              />
              {t("automation.editor.recursiveLabel")}
            </label>
          </Field>

          <Field
            label={t("automation.editor.responsiveness")}
            hint={t("automation.editor.responsivenessHint")}
          >
            <select
              className={SELECT_CLASS}
              value={def.responsiveness ?? "balanced"}
              onChange={(e) => patch({ responsiveness: e.currentTarget.value })}
            >
              {RESPONSIVENESS.map((r) => (
                <option key={r} value={r}>
                  {t(`automation.tierName.${r}` as never)}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {!isWatcher && (
      <Field label={t("automation.editor.frequency")}>
        <select
          className={SELECT_CLASS}
          value={def.frequency ?? "daily"}
          onChange={(e) => patch({ frequency: e.currentTarget.value })}
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {t(`automation.freqName.${f}` as never)}
            </option>
          ))}
        </select>
      </Field>
      )}

      {!isWatcher && fields.every && (
        <Field label={t("automation.editor.every")}>
          <Input
            type="number"
            min={1}
            value={def.every ?? 1}
            onChange={(e) => patch({ every: Number(e.currentTarget.value) || 1 })}
          />
        </Field>
      )}

      {!isWatcher && fields.at && (
        <Field
          label={t("automation.editor.at")}
          hint={fields.atIsDateTime ? t("automation.editor.atOnceHint") : undefined}
        >
          <Input
            type={fields.atIsDateTime ? "datetime-local" : "time"}
            value={def.at ?? ""}
            onChange={(e) => patch({ at: e.currentTarget.value })}
          />
        </Field>
      )}

      {!isWatcher && fields.weekday && (
        <Field label={t("automation.editor.weekday")}>
          <select
            className={SELECT_CLASS}
            value={def.weekday ?? "mon"}
            onChange={(e) => patch({ weekday: e.currentTarget.value })}
          >
            {WEEKDAYS.map((w) => (
              <option key={w} value={w}>
                {t(`automation.weekday.${w}` as never)}
              </option>
            ))}
          </select>
        </Field>
      )}

      {!isWatcher && fields.dayOfMonth && (
        <Field label={t("automation.editor.dayOfMonth")} hint={t("automation.editor.clampHint")}>
          <Input
            type="number"
            min={1}
            max={31}
            value={def.day_of_month ?? 1}
            onChange={(e) => patch({ day_of_month: Number(e.currentTarget.value) || 1 })}
          />
        </Field>
      )}

      {!isWatcher && fields.monthDay && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("automation.editor.month")}>
            <Input
              type="number"
              min={1}
              max={12}
              value={def.month ?? 1}
              onChange={(e) => patch({ month: Number(e.currentTarget.value) || 1 })}
            />
          </Field>
          <Field label={t("automation.editor.day")} hint={t("automation.editor.clampHint")}>
            <Input
              type="number"
              min={1}
              max={31}
              value={def.day ?? 1}
              onChange={(e) => patch({ day: Number(e.currentTarget.value) || 1 })}
            />
          </Field>
        </div>
      )}

      {!isWatcher && fields.cron && (
        <Field label={t("automation.editor.cron")} hint={t("automation.editor.cronHint")}>
          <Input
            value={def.cron ?? ""}
            spellCheck={false}
            placeholder="0 9 * * MON-FRI"
            onChange={(e) => patch({ cron: e.currentTarget.value })}
          />
        </Field>
      )}

      <Field label={t("automation.editor.output")} hint={t("automation.editor.outputHint")}>
        <select
          className={SELECT_CLASS}
          value={def.output}
          onChange={(e) => patch({ output: e.currentTarget.value as AutomationDef["output"] })}
        >
          {OUTPUTS.map((o) => (
            <option key={o} value={o}>
              {t(`automation.output.${o}` as never)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("automation.editor.instructions")}>
        <textarea
          value={def.instructions}
          onChange={(e) => patch({ instructions: e.currentTarget.value })}
          rows={8}
          spellCheck={false}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
        />
      </Field>

      {/* 상시 도움말 — 설계 §1.3 / §2.4. 접히지 않는다. */}
      <div className="rounded-md border border-border/60 bg-accent/20 px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">{t("automation.editor.helpVerbatim")}</p>
        <p className="text-[11px] text-muted-foreground">{t("automation.editor.helpIdempotent")}</p>
        {isWatcher && (
          <p className="text-[11px] text-muted-foreground">{t("automation.editor.helpSettle")}</p>
        )}
      </div>

      {/* 문제 해결 3종 — 진단 탭과 같은 컴포넌트 (설계 §2.5). */}
      <AutomationTroubleshooting />

      {problem && <p className="text-[11px] text-destructive">{t(problem as never)}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn sm" disabled={!!problem || busy}>
          {t("common.save")}
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
