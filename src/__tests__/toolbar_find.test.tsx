import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Toolbar } from "@/components/Toolbar";
import { onOpenPaletteRequest } from "@/lib/paletteNav";

afterEach(cleanup);

describe("Toolbar find (4.0)", () => {
  it("is off by default", () => {
    render(<Toolbar title="T" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the palette through the request bus", () => {
    const opened = vi.fn();
    const off = onOpenPaletteRequest(opened);
    render(<Toolbar title="T" find />);
    fireEvent.click(screen.getByRole("button"));
    expect(opened).toHaveBeenCalledTimes(1);
    off();
    fireEvent.click(screen.getByRole("button"));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
