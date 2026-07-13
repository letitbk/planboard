import { describe, it, expect } from "vitest";
import { parseCsv, capCsv, CSV_MAX_ROWS, CSV_MAX_COLS } from "./parseCsv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("handles CRLF and trailing newline without a phantom row", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("strips a leading BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("handles quoted fields with embedded delimiters, quotes, newlines", () => {
    expect(parseCsv('a,"x,y"\n"he said ""hi""","l1\nl2"')).toEqual([
      ["a", "x,y"],
      ['he said "hi"', "l1\nl2"],
    ]);
  });
  it("tolerates an unterminated quote (rest of input becomes the field)", () => {
    expect(parseCsv('a,"unterminated\nrest')).toEqual([["a", "unterminated\nrest"]]);
  });
  it("keeps blank interior lines as single-empty-field rows", () => {
    expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
  });
  it("parses tsv with the tab delimiter", () => {
    expect(parseCsv("a\tb\n1\t2", "\t")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("returns [] for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("capCsv", () => {
  it("passes small tables through untruncated", () => {
    const c = capCsv([["a"], ["1"]]);
    expect(c).toEqual({
      rows: [["a"], ["1"]], totalRows: 2, totalCols: 1,
      rowsTruncated: false, colsTruncated: false,
    });
  });
  it("caps rows at exactly CSV_MAX_ROWS (500 in, not truncated; 501 in, truncated)", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => [String(i)]);
    expect(capCsv(mk(CSV_MAX_ROWS)).rowsTruncated).toBe(false);
    const over = capCsv(mk(CSV_MAX_ROWS + 1));
    expect(over.rowsTruncated).toBe(true);
    expect(over.rows.length).toBe(CSV_MAX_ROWS);
    expect(over.totalRows).toBe(CSV_MAX_ROWS + 1);
  });
  it("caps columns and reports it", () => {
    const wide = [Array.from({ length: CSV_MAX_COLS + 5 }, (_, i) => String(i))];
    const c = capCsv(wide);
    expect(c.colsTruncated).toBe(true);
    expect(c.rows[0].length).toBe(CSV_MAX_COLS);
    expect(c.totalCols).toBe(CSV_MAX_COLS + 5);
  });
  it("caps total cells (one pathological wide table can't render 500 full rows)", () => {
    const rows = Array.from({ length: 500 }, () =>
      Array.from({ length: 200 }, () => "x"),
    ); // 100k cells > 50k cap
    const c = capCsv(rows);
    expect(c.rows.length).toBe(250); // 50000 / 200
    expect(c.rowsTruncated).toBe(true);
  });
});
