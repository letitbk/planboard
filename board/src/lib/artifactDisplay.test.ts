// The card's whole branch decision, unit-tested without a DOM: a table's
// typeset render displays like a figure; CSVs (including legacy inlineText
// bundles) NEVER inline — they are click-to-open links.
import { describe, expect, it } from "vitest";
import { anchorProps, artifactDisplay, inlineSafe, viewKind } from "./artifactDisplay";
import type { ResultArtifact } from "./types";

const SRC = { path: "output/x", sha256: "0".repeat(64), bytes: 10, oversized: false };

function art(over: Partial<ResultArtifact>): ResultArtifact {
  return {
    id: "a",
    kind: "other",
    title: "A",
    file: null,
    source: { ...SRC },
    producedBy: null,
    ...over,
  } as ResultArtifact;
}

const ASSETS = {
  "table1.png": "url:png",
  "table1.tex": "url:tex",
  "table1.csv": "url:csv",
  "fig.svg": "url:svg",
  "t.html": "url:html",
  "t.md": "url:md",
};

describe("artifactDisplay", () => {
  it("table + png renders as an image (like a figure)", () => {
    const d = artifactDisplay(
      art({ kind: "table", file: "artifacts/table1.png" }),
      ASSETS,
    );
    expect(d).toMatchObject({ mode: "table-image", url: "url:png" });
  });

  it("table with only a CSV file is a card, never inline", () => {
    const d = artifactDisplay(
      art({ kind: "table", file: "artifacts/table1.csv" }),
      ASSETS,
    );
    expect(d.mode).toBe("card");
  });

  it("LEGACY table with csv inlineText is a card (no dump)", () => {
    const d = artifactDisplay(
      art({
        kind: "table",
        file: "artifacts/table1.csv",
        inlineText: "a,b\n1,2\n",
      }),
      ASSETS,
    );
    expect(d.mode).toBe("card");
  });

  it("html and md tables still inline (sanitized path)", () => {
    const h = artifactDisplay(
      art({ kind: "table", file: "artifacts/t.html", inlineText: "<table/>" }),
      ASSETS,
    );
    expect(h).toMatchObject({ mode: "table-inline", kind: "html" });
    const m = artifactDisplay(
      art({ kind: "table", file: "artifacts/t.md", inlineText: "| a |" }),
      ASSETS,
    );
    expect(m).toMatchObject({ mode: "table-inline", kind: "md" });
  });

  it("figure with a url renders as figure", () => {
    const d = artifactDisplay(art({ kind: "figure", file: "artifacts/fig.svg" }), ASSETS);
    expect(d).toMatchObject({ mode: "figure", url: "url:svg" });
  });

  it("oversized always wins", () => {
    const d = artifactDisplay(
      art({ kind: "figure", file: "artifacts/fig.svg", source: { ...SRC, oversized: true } }),
      ASSETS,
    );
    expect(d.mode).toBe("oversized");
  });

  it("tex and data attach as labeled links when present in assets", () => {
    const d = artifactDisplay(
      art({
        kind: "table",
        file: "artifacts/table1.png",
        tex: "artifacts/table1.tex",
        data: "artifacts/table1.csv",
      }),
      ASSETS,
    );
    expect(d.mode).toBe("table-image");
    if (d.mode === "table-image") {
      expect(d.links.map((l) => l.label)).toEqual([".tex", "data: table1.csv"]);
      expect(d.links[0].url).toBe("url:tex");
    }
  });

  it("tex/data absent from assets are silently omitted", () => {
    const d = artifactDisplay(
      art({ kind: "table", file: "artifacts/table1.png", tex: "artifacts/gone.tex" }),
      ASSETS,
    );
    if (d.mode === "table-image") expect(d.links).toEqual([]);
  });

  it("other kind with a url is a card; nothing at all is missing", () => {
    expect(
      artifactDisplay(art({ kind: "other", file: "artifacts/table1.csv" }), ASSETS).mode,
    ).toBe("card");
    expect(artifactDisplay(art({}), ASSETS).mode).toBe("missing");
  });
});

describe("viewKind (artifact viewer)", () => {
  it("maps extensions to viewer kinds", () => {
    expect(viewKind("artifacts/results.md")).toBe("md");
    expect(viewKind("T.CSV")).toBe("csv");
    expect(viewKind("t.tsv")).toBe("tsv");
    for (const f of ["a.txt", "a.log", "a.json", "a.tex"]) expect(viewKind(f)).toBe("text");
    expect(viewKind("fig.png")).toBeNull();
    expect(viewKind("page.html")).toBeNull();
    expect(viewKind("noext")).toBeNull();
    expect(viewKind(null)).toBeNull();
  });
});

describe("inlineSafe / anchorProps (artifact viewer)", () => {
  it("matches the pinned Python artifact policy vector", () => {
    // Mirrored in tests/test_board.py. SVG is intentionally server-inline for
    // sandboxed image rendering but not safe for top-level client navigation.
    const vectors: Array<[string, boolean, boolean]> = [
      ["a.md", true, true], ["T.CSV", true, true],
      ["a.tsv", true, true], ["a.txt", true, true],
      ["a.log", true, true], ["a.json", true, true],
      ["a.tex", true, true], ["a.png", true, true],
      ["a.jpg", true, true], ["a.jpeg", true, true],
      ["a.gif", true, true], ["a.webp", true, true],
      ["a.pdf", true, true], ["a.svg", true, false],
      ["a.html", false, false], ["a.xlsx", false, false],
      ["a.xml", false, false], ["noext", false, false],
    ];
    for (const [name, _serverInline, clientInlineSafe] of vectors) {
      expect(inlineSafe(name), name).toBe(clientInlineSafe);
    }
  });

  it("marks text, raster, pdf as inline-safe; svg/html/xlsx/unknown not", () => {
    for (const f of ["a.md", "a.csv", "a.png", "a.pdf"]) expect(inlineSafe(f)).toBe(true);
    // svg: served inline for <img> figures but sandboxed — anchors download
    for (const f of ["a.svg", "a.html", "a.xlsx", "a.xml", "noext"]) expect(inlineSafe(f)).toBe(false);
    expect(inlineSafe(null)).toBe(false);
  });
  it("live inline-safe URLs open in a new tab without download", () => {
    expect(anchorProps("/artifact/x/r1/a.pdf", "a.pdf")).toEqual({ target: "_blank", rel: "noopener" });
  });
  it("live active/unknown types keep the download attribute", () => {
    expect(anchorProps("/artifact/x/r1/p.html", "p.html")).toEqual({ download: "p.html" });
  });
  it("data: URLs always download (Chrome blocks top-level data: navigation)", () => {
    expect(anchorProps("data:text/csv;base64,QQ==", "t.csv")).toEqual({ download: "t.csv" });
  });
});

describe("view tagging (artifact viewer)", () => {
  it("card mode carries the main file's view kind", () => {
    const d = artifactDisplay(art({ kind: "other", file: "artifacts/t.md" }), ASSETS);
    expect(d).toMatchObject({ mode: "card", view: "md" });
  });
  it("links() tags .tex as text and data files by extension", () => {
    const d = artifactDisplay(
      art({ kind: "table", file: "artifacts/table1.png", tex: "artifacts/table1.tex", data: "artifacts/table1.csv" }),
      ASSETS,
    );
    expect(d.mode).toBe("table-image");
    if (d.mode === "table-image") {
      expect(d.links.find((l) => l.label === ".tex")?.view).toBe("text");
      expect(d.links.find((l) => l.label.startsWith("data:"))?.view).toBe("csv");
    }
  });
});
