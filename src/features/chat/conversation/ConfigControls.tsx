// 모델·모드·추론강도 컨트롤과 부가 설정.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Code2, ClipboardCheck, Flame, Lock, Play, Rocket, Settings, Sparkles } from "@/components/Icons";
import { type AcpConfigOption } from "@/lib/bindings";
import { useT } from "@/i18n";
import { nextIndex } from "../ultracode";
import { useDismiss } from "../useDismiss";

/**
 * 울트라코드 칸의 가상 값.
 *
 * 어댑터의 effort 목록은 `low·medium·high·xhigh·max` 다섯 개이고 울트라코드는
 * **거기 없다** — 사용자 쪽 Claude Code 는 `max` **다음** 칸에 두고 "xhigh +
 * workflows" 라 설명한다. 즉 effort 값이 아니라 키워드로 켜지는 상태다.
 *
 * 그래서 트랙에 칸 하나를 덧대고, 고르면 effort 는 `xhigh` 로 두고 키워드를
 * 켠다. (앞선 라운드에 `max` 를 울트라코드로 이름만 바꿔 놓았는데, 그러면
 * max 가 사라져 실제로 고를 수 없었다.)
 */
export const ULTRA_VALUE = "__ultracode__";

/** 울트라코드가 대응하는 실제 effort 값. */
export const ULTRA_EFFORT = "xhigh";

/**
 * 울트라코드를 켤 수 있는 모델인가.
 *
 * 워크플로는 서브에이전트를 여럿 굴리는 일이라 작은 모델에서는 의미가 없다
 * (그리고 사용자 관찰상 상위 모델에서만 켜진다). 값 목록을 우리가 들고 있지
 * 않으므로 **모델 id 로 판정**한다 — 새 상위 모델이 나와도 이름에 opus/fable
 * 이 들어가면 자동으로 통과한다.
 */
export function supportsUltracode(model: string | null | undefined): boolean {
  if (!model) return false;
  const id = model.toLowerCase();
  return id.includes("opus") || id.includes("fable") || id === "default";
}

/** 자주 쓰는 설정 3종은 바깥에 — 나머지는 `⋯` 안으로. */
export const PRIMARY_CONFIG_IDS = ["mode", "model", "effort"] as const;

/** 컨트롤 트리거에 붙일 아이콘. */
export const CONFIG_ICON: Readonly<Record<string, typeof Lock>> = {
  mode: Lock,
  model: Sparkles,
  effort: Flame,
};

/**
 * 권한 모드 선택지별 아이콘. 모드는 **무엇을 허용하는가**라서 이름만으로는
 * 구분이 느리다 — 자물쇠/코드/계획/로켓이 훨씬 빨리 읽힌다.
 */
export const MODE_ICON: Readonly<Record<string, typeof Lock>> = {
  default: Lock,
  acceptEdits: Code2,
  plan: ClipboardCheck,
  auto: Rocket,
  dontAsk: Play,
  bypassPermissions: AlertTriangle,
};

/**
 * 모드별 색.
 *
 * 권한 모드는 **틀리면 대가가 큰** 설정이라, 지금 무엇인지가 글자를 읽기 전에
 * 보여야 한다. 위험이 커질수록 차가운 색에서 뜨거운 색으로 간다 — 자물쇠(회색)
 * → 편집 허용(초록) → 계획(파랑) → 자동(보라) → 안 묻기(주황) → 전면 우회(빨강).
 */
// 색은 전부 토큰을 지난다 — 생 hex 는 다크·프리셋 테마에서 채도 보정을 못
// 받아 홀로 이질적으로 뜬다 (파랑=회청 토큰, 보라=리팩터 토큰이 의미도 맞다).
export const MODE_COLOR: Readonly<Record<string, string>> = {
  default: "var(--text-2)",
  acceptEdits: "var(--accent)",
  plan: "var(--t-chore)",
  auto: "var(--t-refactor)",
  dontAsk: "var(--t-error)",
  bypassPermissions: "var(--t-bug)",
};

/**
 * ⇧Tab 이 도는 모드들 — 안전한 넷만.
 *
 * 어댑터는 여섯을 주지만 `dontAsk` 와 `bypassPermissions` 는 **되돌릴 수 없는
 * 일을 묻지 않고 하는** 모드다. 키 하나를 연타하다 거기 착지하면 사고다.
 * 메뉴에서는 여전히 고를 수 있다 — 명시적으로 고르는 것과 실수로 지나가는
 * 것은 다르다. (VS Code 확장이 넷만 보여 주는 것도 같은 이유로 읽힌다.)
 */
export const CYCLE_MODES = ["default", "acceptEdits", "plan", "auto"] as const;

export function choicesOf(option: AcpConfigOption) {
  return option.is_boolean
    ? [
        { value: "true", name: "On", description: null },
        { value: "false", name: "Off", description: null },
      ]
    : option.choices;
}

/**
 * 설정 하나를 여는 컨트롤.
 *
 * 메뉴 행은 **아이콘 + 이름 + 설명** 두 줄이다. 설명은 우리가 지어내지 않고
 * 어댑터가 준 것을 그대로 쓴다("Standard behavior, prompts for dangerous
 * operations"). 모드처럼 결과가 위험할 수 있는 선택은 이름만으로 부족하다.
 */
export function ConfigControl({
  option,
  onChange,
  compact,
}: {
  option: AcpConfigOption;
  onChange: (configId: string, value: string) => void;
  /** true 면 트리거에 값 텍스트 없이 아이콘만 (오버플로 안에서 쓸 때). */
  compact?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  const choices = choicesOf(option);
  if (!choices.length) return null;

  const current = choices.find((c) => c.value === option.current);
  // 모드는 **고른 값**이 아이콘을 정한다. 항목 id 로 정하면 Auto 를 골라도
  // 자물쇠(Manual)가 그대로 남는다 — 실제로 그렇게 보였다.
  const TriggerIcon =
    (option.id === "mode" ? MODE_ICON[option.current ?? ""] : undefined) ??
    CONFIG_ICON[option.id];

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "")}
        // 좁아질 때 **무엇부터 접을지**를 CSS 가 고를 수 있게 종류를 실어 둔다
        // (agent.css 의 컨테이너 쿼리). 모드와 effort 는 아이콘이 색·모양으로
        // 값을 말하지만, 모델은 아이콘이 하나뿐이라 이름이 마지막까지 남아야 한다.
        data-config={option.id}
        aria-haspopup="menu"
        aria-expanded={open}
        title={option.name}
        onClick={() => setOpen((v) => !v)}
      >
        {TriggerIcon ? (
          <TriggerIcon
            size={13}
            style={option.id === "mode" ? { color: MODE_COLOR[option.current ?? ""] } : undefined}
          />
        ) : null}
        {compact ? null : (
          <span
            className="agent-chip-label"
            style={option.id === "mode" ? { color: MODE_COLOR[option.current ?? ""] } : undefined}
          >
            {current?.name ?? option.current}
          </span>
        )}
      </button>
      {open ? (
        <div className="settings-menu" role="menu" aria-label={option.name}>
          <div className="settings-group-label">
            {option.name}
            {option.id === "mode" ? (
              <span className="settings-group-hint">{t("acp.modeCycleHint")}</span>
            ) : null}
          </div>
          {choices.map((choice) => {
            const RowIcon = option.id === "mode" ? MODE_ICON[choice.value] : undefined;
            return (
              <button
                key={choice.value}
                type="button"
                role="menuitemradio"
                aria-checked={choice.value === option.current}
                className={"settings-row" + (choice.value === option.current ? " active" : "")}
                onClick={() => {
                  setOpen(false);
                  onChange(option.id, choice.value);
                }}
              >
                <span
                  className="settings-row-icon"
                  style={
                    option.id === "mode" ? { color: MODE_COLOR[choice.value] } : undefined
                  }
                >
                  {RowIcon ? <RowIcon size={15} /> : null}
                </span>
                <span className="settings-row-body">
                  <span className="settings-row-name">{choice.name}</span>
                  {choice.description ? (
                    <span className="settings-row-desc">{choice.description}</span>
                  ) : null}
                </span>
                {choice.value === option.current ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 자주 쓰지 않는 나머지 설정(Fast mode·서브에이전트 …). */
export function MoreSettings({
  options,
  onChange,
}: {
  options: AcpConfigOption[];
  onChange: (configId: string, value: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  if (!options.length) return null;

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("acp.settings")}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings size={13} />
      </button>
      {open ? (
        <div className="settings-menu" role="menu" aria-label={t("acp.settings")}>
          {options.map((option) => (
            <section key={option.id} className="settings-group">
              <div className="settings-group-label">{option.name}</div>
              {choicesOf(option).map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.value === option.current}
                  className={"settings-row" + (choice.value === option.current ? " active" : "")}
                  onClick={() => {
                    setOpen(false);
                    onChange(option.id, choice.value);
                  }}
                >
                  <span className="settings-row-icon" />
                  <span className="settings-row-body">
                    <span className="settings-row-name">{choice.name}</span>
                    {choice.description ? (
                      <span className="settings-row-desc">{choice.description}</span>
                    ) : null}
                  </span>
                  {choice.value === option.current ? <Check size={14} /> : null}
                </button>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Effort — 평소엔 **현재 값만** 보이고, 누르면 트랙이 열린다.
 *
 * 트랙을 항상 펼쳐 두면 컴포저 바닥에서 가장 시끄러운 물체가 되는데, 정작
 * 자주 바꾸는 값은 아니다. 값에 순서가 있으므로 열렸을 때는 목록이 아니라
 * 트랙으로 — 위치가 곧 강도다.
 *
 * `default` 선택지는 뺀다. 실제 기본이 `xhigh` 라 "Default" 와 "Xhigh" 가
 * 같은 것을 두 이름으로 부르는 꼴이고, 고르면 무엇이 되는지 알 수 없다.
 */
export function EffortControl({
  option,
  onChange,
  ultracode,
  onUltracode,
  ultraReady,
}: {
  option: AcpConfigOption;
  onChange: (configId: string, value: string) => void;
  ultracode: boolean;
  onUltracode: (on: boolean) => void;
  /** 울트라코드를 켤 수 있는 모델인지 (아니면 마지막 칸이 잠긴다). */
  ultraReady: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  // 열리면 슬라이더로 포커스를 옮긴다 — 그래야 방향키·Tab 이 **값**을 움직인다.
  // 안 옮기면 Tab 이 포커스를 팝오버 밖으로 던져 버린다.
  useEffect(() => {
    if (open) sliderRef.current?.focus();
  }, [open]);

  /** 칸 하나를 고른다. 울트라코드 칸은 effort 를 xhigh 로 두고 키워드를 켠다. */
  const onPick = (value: string) => {
    if (value === ULTRA_VALUE) {
      // 못 켜는 모델이면 아무 일도 하지 않는다 — 켠 척하면 사용자는 워크플로가
      // 돌 거라 믿고 기다린다.
      if (!ultraReady) return;
      onUltracode(true);
      if (option.current !== ULTRA_EFFORT) onChange(option.id, ULTRA_EFFORT);
      return;
    }
    onUltracode(false);
    onChange(option.id, value);
  };

  // 어댑터 값 뒤에 울트라코드 칸을 덧댄다 — max 는 그대로 남는다.
  const choices = useMemo(
    () => [
      ...option.choices.filter((c) => c.value !== "default"),
      {
        value: ULTRA_VALUE,
        name: t("acp.ultracode"),
        description: ultraReady ? t("acp.ultracodeHint") : t("acp.ultracodeNeedsModel"),
      },
    ],
    [option.choices, t, ultraReady],
  );
  if (choices.length < 2) return null;

  // 현재 값이 `default` 로 와도 사용자에게는 실제 동작인 xhigh 로 보인다.
  const effortValue = option.current === "default" ? ULTRA_EFFORT : option.current;
  const currentValue = ultracode ? ULTRA_VALUE : effortValue;
  const index = Math.max(
    0,
    choices.findIndex((c) => c.value === currentValue),
  );
  const current = choices[index];

  const move = (delta: number) => {
    const at = nextIndex(
      index,
      delta,
      choices.length,
      (i) => choices[i].value === ULTRA_VALUE && !ultraReady,
    );
    if (at !== index) onPick(choices[at].value);
  };

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "")}
        // 단계를 **데이터로** 실어 색은 CSS 가 고른다 — 값 목록이 어댑터에서
        // 오므로, 색 표를 JS 에 두면 값이 하나 늘 때 두 곳을 고쳐야 한다.
        data-effort={currentValue}
        data-config="effort"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={option.name}
        onClick={() => setOpen((v) => !v)}
      >
        <Flame size={13} />
        <span className="agent-chip-label">{current?.name ?? currentValue}</span>
      </button>
      {open ? (
        <div className="settings-menu effort-menu" role="dialog" aria-label={option.name}>
          <div className="settings-group-label">{option.name}</div>
          <div
            className="effort"
            ref={sliderRef}
            role="slider"
            tabIndex={0}
            aria-label={option.name}
            aria-valuemin={0}
            aria-valuemax={choices.length - 1}
            aria-valuenow={index}
            aria-valuetext={current?.name}
            onKeyDown={(e) => {
              // 팝오버가 열려 있는 동안 Tab 은 포커스 이동이 아니라 **값 이동**
              // 이다 — 이 순간 사용자가 하려는 일은 그것뿐이다.
              if (e.key === "Tab") {
                e.preventDefault();
                move(e.shiftKey ? -1 : 1);
                return;
              }
              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          >
            {/* 값이 위, 트랙이 아래 — 눈이 "지금 무엇"을 먼저 읽고 그 다음
                "어디쯤"을 본다. 나란히 놓으면 둘이 서로를 밀어낸다. */}
            <span
              className={"effort-label" + (currentValue === ULTRA_VALUE ? " top" : "")}
              data-effort={currentValue}
            >
              {current?.name ?? currentValue}
              {/* 울트라코드가 "무엇의 준말인지"를 이름 옆에 붙여 둔다 — 여섯 칸
                  중 유일하게 척도의 연장이 아니라 별개의 물건이라, 설명 없이는
                  max 다음의 더 센 칸으로 오해된다. */}
              {currentValue === ULTRA_VALUE ? (
                <span className="effort-label-note">{t("acp.ultracodeSub")}</span>
              ) : null}
            </span>
            <span className="effort-track">
              {/* 지나온 구간을 선으로 먼저 깔면 "어디쯤"이 점을 세기 전에
                  읽힌다. 점은 그 위의 눈금이다. */}
              <span
                className={"effort-fill" + (currentValue === ULTRA_VALUE ? " top" : "")}
                data-effort={currentValue}
                style={{
                  width: `${choices.length > 1 ? (index / (choices.length - 1)) * 100 : 0}%`,
                }}
              />
              {choices.map((choice, i) => (
                <button
                  key={choice.value}
                  type="button"
                  className={
                    "effort-dot" +
                    (i === index ? " on" : "") +
                    (i < index ? " lit" : "") +
                    // 마지막 칸은 척도의 연장이 아니라 별개의 물건이다.
                    (choice.value === ULTRA_VALUE ? " top" : "") +
                    (choice.value === ULTRA_VALUE && !ultraReady ? " locked" : "")
                  }
                  disabled={choice.value === ULTRA_VALUE && !ultraReady}
                  aria-label={choice.name}
                  title={choice.description ?? choice.name}
                  onClick={() => onPick(choice.value)}
                />
              ))}
            </span>
          </div>
          {/* 한 줄만 보이고 넘치면 잘린다 — 전문은 title 에 남겨 둔다. */}
          <div
            className="effort-hint"
            title={currentValue === ULTRA_VALUE ? t("acp.ultracodeFull") : undefined}
          >
            {currentValue === ULTRA_VALUE ? t("acp.ultracodeHint") : t("acp.effortHint")}
          </div>
        </div>
      ) : null}
    </div>
  );
}
