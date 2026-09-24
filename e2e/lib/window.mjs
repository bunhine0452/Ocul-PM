// 창 크기 — 목표는 **웹뷰 안쪽 폭**(innerWidth)이다. 사용자가 보는 레이아웃을
// 정하는 것이 그 값이라서.
//
// 1차: WebDriver `Set Window Rect`. 창틀만큼 모자라면 한 번 보정한다.
// 2차: 드라이버가 못 하면(WebView2 는 호스트 창을 모른다) OS 도구로 —
//      Windows 는 user32 SetWindowPos(PowerShell), Linux 는 xdotool.

import { execFileSync } from "node:child_process";
import { IS_WIN } from "./env.mjs";
import { sleep } from "./page.mjs";

const inner = (wd) => wd.execute("return [window.innerWidth, window.innerHeight];");

function osResize(width, height, processName) {
  if (IS_WIN) {
    const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class E2eWin {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@
$p = Get-Process -Name '${processName}' -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { throw '${processName} main window not found' }
[void][E2eWin]::ShowWindow($p.MainWindowHandle, 9)
if (-not [E2eWin]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 0, 0, ${width}, ${height}, 0x0014)) { throw 'SetWindowPos failed' }`;
    const encoded = Buffer.from(ps, "utf16le").toString("base64");
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { stdio: "pipe" });
    return "SetWindowPos";
  }
  execFileSync("xdotool", ["search", "--onlyvisible", "--name", "^Ocul-PM$", "windowsize", "%@", String(width), String(height)], {
    stdio: "pipe",
  });
  return "xdotool windowsize";
}

/**
 * 웹뷰 안쪽이 `width`×`height` 쯤 되게 맞춘다. 실제로 얻은 크기와 쓴 방법을 돌려준다
 * — 러너 화면보다 큰 창은 OS 가 잘라낼 수 있으므로 결과를 **보고**하지 판정하지 않는다.
 */
export async function resizeViewport(wd, width, height, { processName = "ocul-pm" } = {}) {
  const notes = [];
  const close = (got) => Math.abs(got[0] - width) <= 24 && Math.abs(got[1] - height) <= 60;
  let got = await inner(wd);
  try {
    await wd.setWindowRect({ width, height });
    await sleep(700);
    got = await inner(wd);
    if (!close(got)) {
      // 창틀·제목줄 몫을 더해 한 번 더 — 목표는 바깥이 아니라 안쪽 크기다.
      await wd.setWindowRect({ width: width + (width - got[0]), height: height + (height - got[1]) });
      await sleep(700);
      got = await inner(wd);
    }
    notes.push(`webdriver setWindowRect → ${got.join("×")}`);
  } catch (e) {
    notes.push(`setWindowRect 불가: ${e.code ?? e.message}`);
  }
  if (!close(got)) {
    try {
      const how = osResize(width, height, processName);
      await sleep(900);
      got = await inner(wd);
      if (!close(got)) {
        osResize(width + (width - got[0]), height + (height - got[1]), processName);
        await sleep(900);
        got = await inner(wd);
      }
      notes.push(`${how} → ${got.join("×")}`);
    } catch (e) {
      notes.push(`OS 창 조절 실패: ${String(e.stderr ?? e.message).trim().slice(0, 200)}`);
    }
  }
  return { inner: got, reached: close(got), notes };
}
