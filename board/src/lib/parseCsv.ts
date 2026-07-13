// RFC-4180-ish CSV/TSV parsing for the artifact viewer (v0.15 follow-up):
// quoted fields, "" escapes, embedded delimiters/newlines, CRLF+LF, leading
// BOM stripped, trailing newline is not a row, an unterminated quote consumes
// the rest of the input. Render caps keep one pathological file from building
// an unbounded DOM (spec: 500 rows / 200 cols / 50k cells).

export const CSV_MAX_ROWS = 500;
export const CSV_MAX_COLS = 200;
export const CSV_MAX_CELLS = 50000;

export interface CappedCsv {
  rows: string[][];
  totalRows: number;
  totalCols: number;
  rowsTruncated: boolean;
  colsTruncated: boolean;
}

export function parseCsv(text: string, delim: "," | "\t" = ","): string[][] {
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let opened = false; // a quote opened a field that may otherwise be empty
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { inQuotes = true; opened = true; i++; continue; }
    if (c === delim) { endField(); opened = false; i++; continue; }
    if (c === "\r") { if (src[i + 1] === "\n") i++; endRow(); opened = false; i++; continue; }
    if (c === "\n") { endRow(); opened = false; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length > 0 || (inQuotes && opened)) endRow();
  return rows;
}

export function capCsv(rows: string[][]): CappedCsv {
  const totalRows = rows.length;
  const totalCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const colsTruncated = totalCols > CSV_MAX_COLS;
  let out = rows
    .slice(0, CSV_MAX_ROWS)
    .map((r) => (r.length > CSV_MAX_COLS ? r.slice(0, CSV_MAX_COLS) : r));
  let rowsTruncated = totalRows > CSV_MAX_ROWS;
  const colsShown = Math.min(totalCols, CSV_MAX_COLS);
  if (colsShown > 0) {
    const maxRowsByCells = Math.floor(CSV_MAX_CELLS / colsShown);
    if (out.length > maxRowsByCells) {
      out = out.slice(0, maxRowsByCells);
      rowsTruncated = true;
    }
  }
  return { rows: out, totalRows, totalCols, rowsTruncated, colsTruncated };
}
