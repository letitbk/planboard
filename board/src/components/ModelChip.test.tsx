// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ModelChip from "./ModelChip";

afterEach(cleanup);

describe("ModelChip", () => {
  it("renders prescribed and a reported override", () => {
    const { container } = render(
      <ModelChip usage={{ prescribed: { model: "opus", effort: "max" }, reported: { model: "sonnet", effort: null } }} />,
    );
    expect(screen.getByText("opus·max")).toBeTruthy();
    expect(container.textContent).toContain("reported sonnet");
  });

  it("uses a custom reported label", () => {
    render(<ModelChip usage={{ prescribed: null, reported: { model: "opus", effort: null } }} reportedLabel="captured by" />);
    expect(screen.getByText("captured by opus")).toBeTruthy();
  });

  it("renders nothing for null / empty usage", () => {
    const { container: c1 } = render(<ModelChip usage={null} />);
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(<ModelChip usage={{ prescribed: null, reported: null }} />);
    expect(c2.firstChild).toBeNull();
  });
});
