/**
 * `shellIntegrationApi` — 셸 통합(rc 한 줄) 커맨드의 래퍼 (`{#api-facades}`).
 * 머신 단위 설정이라 projectId 가 없다. 실패는 `ApiError` 하나로 접는다.
 */

import { call, type Envelope } from "@/api/invoke";
import { commands, type ShellIntegrationStatus } from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const shellIntegrationApi = {
  status: () =>
    unwrap<ShellIntegrationStatus>("shell_integration_status", commands.shellIntegrationStatus()),
  install: () =>
    unwrap<ShellIntegrationStatus>("shell_integration_install", commands.shellIntegrationInstall()),
  uninstall: () =>
    unwrap<ShellIntegrationStatus>(
      "shell_integration_uninstall",
      commands.shellIntegrationUninstall(),
    ),
};
