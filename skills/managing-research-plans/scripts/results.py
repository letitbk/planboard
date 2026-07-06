#!/usr/bin/env python3
"""research-plans results: bundle mechanics for the results layer.

Stdlib only, Python 3.9+. Subcommands:
  discover                             list candidate output artifacts (JSON)
  stage     --component NN-slug        create/print a .staging-<id>/ dir
  copy      --staging DIR --into artifacts|scripts SRC...   copy + hash (JSON)
  finalize  --staging DIR              validate, atomic-rename to next rN/ (JSON)
  verdict   --component S --version N --status accepted|changes-requested
            --reviewer NAME [--comment TEXT] [--plan-version M]
  changed   --component NN-slug        sources drifted since latest bundle? (JSON)

The agent writes manifest.json and report.md into the staging dir itself;
finalize validates them. Finalized bundles are immutable (enforced by the
sign-off hook for Write/Edit; by convention otherwise).
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

MAX_BYTES = 5 * 1024 * 1024
SCAN_DIRS = ["output", "outputs", "figures", "figs", "plots", "viz", "visuals",
             "graphics", "tables", "results", "reports"]
SCAN_EXTS = {
    ".png", ".jpg", ".jpeg", ".svg", ".gif", ".pdf",
    ".csv", ".tsv", ".html", ".md", ".txt", ".tex", ".json",
}
SKIP_DIRS = {".git", "node_modules", "plans", "__pycache__"}
R_RE = re.compile(r"^r(\d+)$")


def die(msg, code=1):
    print("results: %s" % msg, file=sys.stderr)
    sys.exit(code)


def find_root(start=None):
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=10,
            cwd=str(start) if start else None,
        )
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip())
    except Exception:
        pass
    return Path.cwd()


def sha256_file(path):
    h = hashlib.sha256()
    with open(str(path), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def component_dir(root, component):
    d = root / "plans" / "execution" / component
    if not d.is_dir():
        die("no component at plans/execution/%s" % component)
    return d


def next_version(results_dir):
    n = 0
    if results_dir.is_dir():
        for p in results_dir.iterdir():
            m = R_RE.fullmatch(p.name)
            if m and p.is_dir():
                n = max(n, int(m.group(1)))
    return n + 1


def safe_extra_dir(root, d):
    """Resolve a --dir value to a repo-relative scan dir, or die on escape.
    Rejects absolute paths, `..` escapes, and symlinks that resolve outside
    the repo; returns the unresolved root/d so relative_to(root) still holds."""
    if os.path.isabs(d):
        die("--dir must be repo-relative, not absolute: %s" % d)
    dp = root / d
    try:
        resolved = dp.resolve()
    except OSError:
        die("--dir cannot be resolved: %s" % d)
    root_r = root.resolve()
    if resolved != root_r and root_r not in resolved.parents:
        die("--dir escapes the repository: %s" % d)
    return dp


def cmd_discover(root, args):
    scan = [root / dname for dname in SCAN_DIRS]
    for d in (getattr(args, "dir", None) or []):
        scan.append(safe_extra_dir(root, d))
    found = []
    seen = set()
    for d in scan:
        if not d.is_dir():
            continue
        for p in d.rglob("*"):
            if not p.is_file() or p.suffix.lower() not in SCAN_EXTS:
                continue
            if any(part in SKIP_DIRS or part.startswith(".") for part in p.parts):
                continue
            rel = str(p.relative_to(root))
            if rel.startswith("plans/"):
                continue  # bundles never adopt themselves
            if rel in seen:
                continue  # a --dir may overlap a default scan dir
            seen.add(rel)
            st = p.stat()
            found.append({"path": rel, "bytes": st.st_size,
                          "mtime": datetime.datetime.fromtimestamp(
                              st.st_mtime).strftime("%Y-%m-%d %H:%M")})
    found.sort(key=lambda x: x["mtime"], reverse=True)
    print(json.dumps(found[:200], indent=1))


def cmd_stage(root, args):
    comp = component_dir(root, args.component)
    results_dir = comp / "results"
    staging = results_dir / (".staging-%s" % uuid.uuid4().hex[:8])
    (staging / "artifacts").mkdir(parents=True)
    (staging / "scripts").mkdir()
    print(str(staging))


def cmd_copy(root, args):
    staging = Path(args.staging)
    if not staging.is_dir() or not staging.name.startswith(".staging-"):
        die("--staging must be an existing .staging-* directory")
    into = staging / args.into
    into.mkdir(exist_ok=True)
    records = []
    for src in args.sources:
        sp = Path(src)
        if not sp.is_absolute():
            sp = root / sp
        if not sp.is_file():
            die("source not found: %s" % src)
        size = sp.stat().st_size
        digest = sha256_file(sp)
        rec = {"src": src, "sha256": digest, "bytes": size, "oversized": False}
        if args.into == "artifacts" and size > MAX_BYTES:
            rec["file"] = None
            rec["oversized"] = True
        else:
            dest = into / sp.name
            shutil.copy2(str(sp), str(dest))
            rec["file"] = "%s/%s" % (args.into, sp.name)
        records.append(rec)
    print(json.dumps(records, indent=1))


def validate_staged(staging):
    manifest_p = staging / "manifest.json"
    if not manifest_p.is_file():
        return None, "manifest.json missing from staging dir"
    try:
        manifest = json.loads(manifest_p.read_text(encoding="utf-8"))
    except ValueError as e:
        return None, "manifest.json is not valid JSON: %s" % e
    for key in ("component", "provenance", "trigger", "capturedAt", "artifacts"):
        if key not in manifest:
            return None, "manifest.json missing required key: %s" % key
    if not (staging / "report.md").is_file():
        return None, "report.md missing from staging dir"
    for art in manifest["artifacts"]:
        f = art.get("file")
        if f is None:
            if not art.get("source", {}).get("oversized"):
                return None, "artifact %s has no file and is not oversized" % art.get("id")
            continue
        fp = staging / f
        if not fp.is_file():
            return None, "artifact file missing in staging: %s" % f
        src = art.get("source", {})
        if src.get("sha256") and sha256_file(fp) != src["sha256"]:
            return None, "checksum mismatch for %s (copy differs from source hash)" % f
        pb = art.get("producedBy")
        if pb and pb.get("script") and not (staging / pb["script"]).is_file():
            return None, "script snapshot missing: %s" % pb["script"]
    return manifest, None


def cmd_finalize(root, args):
    staging = Path(args.staging)
    if not staging.is_dir():
        die("no staging dir at %s" % staging)
    manifest, err = validate_staged(staging)
    if err:
        die(err)
    results_dir = staging.parent
    version = next_version(results_dir)
    manifest["resultsVersion"] = version
    manifest.setdefault("schemaVersion", 1)
    (staging / "manifest.json").write_text(
        json.dumps(manifest, indent=1), encoding="utf-8")
    target = results_dir / ("r%d" % version)
    try:
        os.rename(str(staging), str(target))
    except OSError as e:
        die("atomic rename failed: %s" % e)
    try:
        rel = str(target.relative_to(find_root(target)))
    except ValueError:
        rel = str(target)
    print(json.dumps({"resultsVersion": version, "path": rel}))


def cmd_verdict(root, args):
    comp = component_dir(root, args.component)
    bundle = comp / "results" / ("r%d" % args.version)
    if not bundle.is_dir():
        die("no bundle at %s" % bundle)
    vp = bundle / "verdict.json"
    doc = {
        "status": args.status,
        "date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "planVersion": args.plan_version,
        "reviewer": args.reviewer,
    }
    if args.comment:
        doc["comment"] = args.comment
    try:
        fd = os.open(str(vp), os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    except FileExistsError:
        die("verdict already recorded for %s r%d — verdicts are written once"
            % (args.component, args.version))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
    print(str(vp))


def cmd_changed(root, args):
    comp = component_dir(root, args.component)
    results_dir = comp / "results"
    latest = next_version(results_dir) - 1
    if latest < 1:
        print(json.dumps({"latest": None, "changed": [], "note": "no bundles yet"}))
        return
    manifest_p = results_dir / ("r%d" % latest) / "manifest.json"
    try:
        manifest = json.loads(manifest_p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print(json.dumps({"latest": latest, "changed": [],
                          "note": "manifest unreadable"}))
        return
    changed = []
    for art in manifest.get("artifacts", []):
        src = art.get("source", {})
        rel = src.get("path")
        if not rel:
            continue
        sp = root / rel
        if not sp.is_file():
            changed.append({"path": rel, "why": "source deleted"})
        elif src.get("sha256") and sha256_file(sp) != src["sha256"]:
            changed.append({"path": rel, "why": "content changed"})
    print(json.dumps({"latest": latest, "changed": changed}, indent=1))


def main():
    ap = argparse.ArgumentParser(description="research-plans results mechanics")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("discover")
    d.add_argument("--dir", action="append", default=None,
                   help="extra repo-relative dir to scan (repeatable)")
    s = sub.add_parser("stage")
    s.add_argument("--component", required=True)
    c = sub.add_parser("copy")
    c.add_argument("--staging", required=True)
    c.add_argument("--into", required=True, choices=["artifacts", "scripts"])
    c.add_argument("sources", nargs="+")
    f = sub.add_parser("finalize")
    f.add_argument("--staging", required=True)
    v = sub.add_parser("verdict")
    v.add_argument("--component", required=True)
    v.add_argument("--version", type=int, required=True)
    v.add_argument("--status", required=True,
                   choices=["accepted", "changes-requested"])
    v.add_argument("--reviewer", required=True)
    v.add_argument("--comment", default="")
    v.add_argument("--plan-version", type=int, default=None)
    g = sub.add_parser("changed")
    g.add_argument("--component", required=True)
    for p in (d, s, c, f, v, g):
        p.add_argument("--root", default=None)
    args = ap.parse_args()
    root = Path(args.root) if args.root else find_root()
    {"discover": cmd_discover, "stage": cmd_stage, "copy": cmd_copy,
     "finalize": cmd_finalize, "verdict": cmd_verdict,
     "changed": cmd_changed}[args.cmd](root, args)


if __name__ == "__main__":
    main()
