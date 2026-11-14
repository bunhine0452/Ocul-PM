// 끌어다 놓은 경로의 따옴표 — Windows 는 PowerShell 이다(업그레이드 라운드 TI-03). 예전의 큰따옴표는
// 안의 `$` · 백틱을 펼치고 쉼표를 배열로 만들었다.
import { describe, expect, it } from "vitest";

import { dropText, shellQuote } from "@/features/terminal/dropFiles";

describe("PowerShell quoting for dropped paths", () => {
  it("wraps a path with $ and a comma in single quotes, so nothing expands or splits", () => {
    expect(shellQuote("C:\\Users\\me\\$env,a.png", true)).toBe("'C:\\Users\\me\\$env,a.png'");
    expect(shellQuote("C:\\shots\\`whoami`.png", true)).toBe("'C:\\shots\\`whoami`.png'");
  });

  it("doubles a single quote inside the name — curly ones too, PowerShell reads them as quotes", () => {
    expect(shellQuote("C:\\shots\\it's.png", true)).toBe("'C:\\shots\\it''s.png'");
    expect(shellQuote("C:\\shots\\it\u2019s.png", true)).toBe("'C:\\shots\\it\u2019\u2019s.png'");
  });

  it("quotes , @ = % that a POSIX shell takes bare", () => {
    for (const name of ["a,b.png", "a@b.png", "a=b.png", "100%.png"]) {
      expect(shellQuote(`C:\\x\\${name}`, true)).toBe(`'C:\\x\\${name}'`);
      expect(shellQuote(`/x/${name}`, false)).toBe(`/x/${name}`);
    }
  });

  it("keeps a plain Windows path bare", () => {
    expect(shellQuote("C:\\shots\\home-1.png", true)).toBe("C:\\shots\\home-1.png");
  });

  it("drops control bytes from a dropped name before quoting (TI-04)", () => {
    const text = dropText(["/tmp/a\x1b[201~\rb.png"], false);
    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("\r");
    expect(text).toBe("'/tmp/a\nb.png' ");
  });
});
