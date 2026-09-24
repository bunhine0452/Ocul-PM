// 새 터미널 탭의 기본 라벨 = **실제로 뜨는 셸의 이름** (크로스플랫폼 라운드 {#ui-e2e-minor}).
//
// 탭은 셸이 뜨기 전에 만들어져서 라벨을 "zsh" 로 박아 두었다. macOS 의 기본
// 셸이라 맞았지만, Linux(E2E)에서는 bash 가 도는 탭이 "zsh" 라고 적혀 있었다.
// 셸은 앱이 고르고(`default_shell.rs`) 설정 화면의 셸 통합 상태가 **같은 판정**을
// 돌려준다(`shell_integration_status` 의 `shell`) — 그 값으로 이름을 짓는다.
//
// macOS 는 예전 그대로 "zsh" 다 (D3 — 표기는 한 글자도 바뀌지 않는다).
import { useEffect, useState } from "react";
import type { ShellIntegrationStatus } from "@/lib/bindings";
import { shellIntegrationApi } from "@/api/shellIntegration";
import { getPlatform, type Platform } from "@/lib/platform";
import type { TerminalTab } from "@/contexts/WorkspaceContext";
import { canAutoRename } from "./tabTitle";

/** 판정이 오기 전(또는 실패)의 이름 — 그 OS 에서 가장 흔한 기본 셸. */
export function fallbackShellName(platform: Platform = getPlatform()): string {
  if (platform === "mac") return "zsh";
  return platform === "windows" ? "powershell" : "bash";
}

/**
 * 셸 통합 상태 → 탭 라벨의 셸 이름. PowerShell 은 판(5.1 `powershell` · 7+ `pwsh`)을
 * 프로필 자리로 가른다 — 5.1 만 `…\WindowsPowerShell\…` 에 프로필을 둔다.
 * 통합이 모르는 셸(Windows 의 cmd, Linux 의 fish·nu …)은 이름을 지어내지 않는다:
 * Windows 에서 PowerShell 도 못 찾았으면 남는 것은 `%COMSPEC%`(cmd)고, 그 밖은
 * 중립적인 "shell" 이다 — 셸이 제목을 알려 오면 그 제목이 덮어쓴다.
 */
export function shellNameFromStatus(
  status: Pick<ShellIntegrationStatus, "shell" | "rc_path">,
  platform: Platform = getPlatform(),
): string {
  if (platform === "mac") return "zsh";
  switch (status.shell) {
    case "zsh":
      return "zsh";
    case "bash":
      return "bash";
    case "powershell":
      if (platform !== "windows") return "pwsh";
      if (/[\\/]WindowsPowerShell[\\/]/i.test(status.rc_path)) return "powershell";
      return /[\\/]PowerShell[\\/]/i.test(status.rc_path) ? "pwsh" : "powershell";
    default:
      return platform === "windows" ? "cmd" : "shell";
  }
}

let pending: Promise<string> | null = null;
let known: string | null = null;

/** 한 번만 묻고 기억한다 — 실행 중에 기본 셸이 바뀔 일은 없다. 실패하면 기본값. */
export function loadShellName(): Promise<string> {
  if (known) return Promise.resolve(known);
  pending ??= shellIntegrationApi
    .status()
    .then((status) => shellNameFromStatus(status))
    .catch(() => fallbackShellName())
    .then((name) => {
      known = name;
      return name;
    });
  return pending;
}

/** 테스트 전용 — 기억해 둔 이름을 잊는다. */
export function __resetShellNameForTests(): void {
  pending = null;
  known = null;
}

/**
 * 기본 라벨(`zsh` · `bash 2` …)인 탭의 셸 이름만 바꾼다 — 사용자가 지은 이름·셸
 * 제목으로 바뀐 이름은 건드리지 않는다. 바뀐 것이 없으면 **같은 배열**을 돌려준다.
 * macOS 에서는 아무것도 안 한다 — 거기서 "fish" 라고 손수 지은 탭은 그대로 남는다 (D3).
 */
export function relabelDefaultTabs(
  tabs: TerminalTab[],
  name: string,
  platform: Platform = getPlatform(),
): TerminalTab[] {
  if (platform === "mac") return tabs;
  let changed = false;
  const next = tabs.map((tab) => {
    if (!canAutoRename(tab.label)) return tab;
    const label = tab.label.trim().replace(/^\S+/, name);
    if (label === tab.label) return tab;
    changed = true;
    return { ...tab, label };
  });
  return changed ? next : tabs;
}

/**
 * 새 탭에 붙일 셸 이름. macOS 는 늘 "zsh" 이고 묻지도 않는다. 그 밖의 OS 는 판정이
 * 오면 다시 그려지고, 이미 만들어진 기본 라벨 탭은 부르는 쪽이 `relabelDefaultTabs` 로 고친다.
 */
export function useShellName(): string {
  const [name, setName] = useState(() => known ?? fallbackShellName());
  useEffect(() => {
    if (getPlatform() === "mac") return;
    let alive = true;
    void loadShellName().then((resolved) => {
      if (alive) setName(resolved);
    });
    return () => {
      alive = false;
    };
  }, []);
  return name;
}
