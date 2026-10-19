#!/usr/bin/env python3
"""Normalize local document resources with pinned MarkItDown, retaining provenance.

Exit 0: nonempty conversion/already Markdown; 1: review/OCR needed; 2: failure.
"""

import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys
import tempfile


VERSION = "0.1.8"
POLICY = "route3-local-resource-v1"
MARKDOWN = {".md", ".markdown", ".mdx"}
IMAGES = {".png", ".jpg", ".jpeg"}
DOCUMENTS = {".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".html", ".htm",
             ".epub", ".csv", ".tsv", ".json", ".xml", ".txt"}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_runtime():
    try:
        if importlib.metadata.version("markitdown") == VERSION:
            return
    except importlib.metadata.PackageNotFoundError:
        pass
    runtime = Path(os.environ.get(
        "ROUTE3_MARKITDOWN_PYTHON",
        str(Path.home() / ".local/share/route3/markitdown/bin/python"))).expanduser().absolute()
    if runtime.is_file() and str(runtime) != os.path.abspath(sys.executable):
        os.execv(str(runtime), [str(runtime), str(Path(__file__).absolute()), *sys.argv[1:]])
    raise RuntimeError(f"MarkItDown {VERSION} runtime unavailable; see references/markitdown.md")


def atomic_write(path, data):
    fd, temp = tempfile.mkstemp(prefix=".resource-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def classify(body, suffix):
    warnings = []
    if suffix == ".pdf":
        warnings.append("PDF layout and mixed scanned-page coverage require original-file verification")
    if suffix in {".xlsx", ".xls"}:
        warnings.append("Markdown does not preserve workbook formulas, types or calculation semantics")
    if suffix == ".epub":
        warnings.append("EPUB chapter completeness and reading order require original-file verification")
    status = "converted"
    if not body.strip():
        status = "needs_ocr" if suffix == ".pdf" else "needs_review"
        warnings.append("No readable text extracted; inspect original and use appropriate local extraction/OCR")
    if suffix in IMAGES:
        status = "needs_visual_review"
        warnings.append("Image output may contain metadata only; inspect image and obtain actual text separately")
    return status, warnings


def convert(source, cwd):
    source = source.expanduser().resolve(strict=True)
    cwd = cwd.expanduser().resolve(strict=True)
    if not source.is_file() or not cwd.is_dir():
        raise ValueError("input must be a local regular file and cwd an existing directory")
    if not source.stat().st_size:
        raise ValueError("source is empty")
    suffix = source.suffix.lower()
    source_hash = sha256(source)
    if suffix in MARKDOWN:
        body = source.read_text(encoding="utf-8")
        return {"status": "already_markdown" if body.strip() else "needs_review",
                "source_path": str(source), "source_sha256": source_hash,
                "markdown_path": str(source), "content_chars": len(body),
                "cache_hit": False, "warnings": [] if body.strip() else ["empty_markdown"]}
    if suffix not in DOCUMENTS | IMAGES:
        raise ValueError(f"unsupported resource extension: {suffix or '(none)'}")
    ensure_runtime()
    packages = sorted((dist.metadata.get("Name", "").lower(), dist.version)
                      for dist in importlib.metadata.distributions())
    runtime_hash = hashlib.sha256(json.dumps([sys.version, packages]).encode()).hexdigest()
    identity = {"source_path": str(source), "source_sha256": source_hash,
                "converter": "markitdown", "converter_version": VERSION,
                "runtime_sha256": runtime_hash,
                "policy": POLICY, "plugins": False, "cloud": False}
    fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", source.stem).strip(".-")[:48] or "resource"
    folder = cwd / ".workflow/route3/resources" / f"{name}-{fingerprint}"
    md_path, meta_path = folder / "content.md", folder / "source.json"
    if md_path.is_file() and meta_path.is_file():
        try:
            cached = json.loads(meta_path.read_text(encoding="utf-8"))
            cached_data = md_path.read_bytes()
            cached_body = cached_data.decode("utf-8")
            expected_status, expected_warnings = classify(cached_body, suffix)
            if (isinstance(cached, dict) and cached.get("identity") == identity
                    and cached.get("schema_version") == 1
                    and cached.get("source_path") == str(source)
                    and cached.get("source_sha256") == source_hash
                    and cached.get("markdown_path") == str(md_path)
                    and cached.get("metadata_path") == str(meta_path)
                    and cached.get("status") == expected_status
                    and cached.get("warnings") == expected_warnings
                    and cached.get("content_chars") == len(cached_body)
                    and hashlib.sha256(cached_data).hexdigest() == cached.get("markdown_sha256")):
                return {**cached, "cache_hit": True}
        except (OSError, ValueError, TypeError):
            pass  # Broken/incompatible derived artifacts are regenerated.

    with redirect_stdout(sys.stderr):
        from markitdown import MarkItDown, StreamInfo
        from markitdown import converters
        import requests

    class LocalOnlySession(requests.Session):
        def request(self, *args, **kwargs):
            raise RuntimeError("Remote fetch is disabled during local resource conversion")

    converter_names = {
        ".pdf": "PdfConverter", ".docx": "DocxConverter", ".pptx": "PptxConverter",
        ".xlsx": "XlsxConverter", ".xls": "XlsConverter", ".html": "HtmlConverter",
        ".htm": "HtmlConverter", ".epub": "EpubConverter", ".csv": "CsvConverter",
    }
    selected = ("ImageConverter" if suffix in IMAGES else
                converter_names.get(suffix, "PlainTextConverter"))
    with LocalOnlySession() as session, redirect_stdout(sys.stderr):
        converter = MarkItDown(enable_builtins=False, enable_plugins=False, requests_session=session)
        converter.register_converter(getattr(converters, selected)())
        result = converter.convert_local(source, stream_info=StreamInfo(extension=suffix))
    body = result.markdown
    if not isinstance(body, str):
        raise ValueError("converter did not return Markdown text")
    if sha256(source) != source_hash:
        raise RuntimeError("source changed during conversion; reconcile before retrying")
    status, warnings = classify(body, suffix)
    encoded = body.encode("utf-8")
    metadata = {"schema_version": 1, "identity": identity,
                "source_path": str(source), "source_sha256": source_hash,
                "markdown_path": str(md_path), "metadata_path": str(meta_path),
                "markdown_sha256": hashlib.sha256(encoded).hexdigest(),
                "status": status, "warnings": warnings, "content_chars": len(body),
                "converted_at": datetime.now(timezone.utc).isoformat()}
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_write(md_path, encoded)
    atomic_write(meta_path, (json.dumps(metadata, indent=2, ensure_ascii=False) + "\n").encode())
    return {**metadata, "cache_hit": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--cwd", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        report = convert(args.source, args.cwd)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if report["status"] in {"converted", "already_markdown"} else 1
    except Exception as error:
        print(json.dumps({"status": "failed", "error_type": type(error).__name__,
                          "message": str(error)[:600]}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
