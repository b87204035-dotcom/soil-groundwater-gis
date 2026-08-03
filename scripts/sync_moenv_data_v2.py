#!/usr/bin/env python3
"""Robust MOENV downloader used by GitHub Actions.

Uses the existing normalizers, but adds lowercase endpoint fallback,
browser-like headers, clearer errors, retries, and optional handling for
the retiring GISEPA_P_33 dataset.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

import sync_moenv_data as legacy

API_BASES = (
    "https://data.moenv.gov.tw/api/v2",
    "https://data.epa.gov.tw/api/v2",
)
LIMIT = 1000
MAX_ROWS = 50000
HEADERS = {
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
    "Referer": "https://data.moenv.gov.tw/",
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0 Safari/537.36 "
        "soil-groundwater-gis/2.0"
    ),
    "Connection": "close",
}


class ApiError(RuntimeError):
    pass


def redact(text: str, api_key: str) -> str:
    return text.replace(api_key, "***") if api_key else text


def decode_json(data: bytes) -> Any:
    text = data.decode("utf-8-sig", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        preview = " ".join(text[:500].split())
        raise ApiError(f"API 回傳的不是 JSON：{preview}") from exc


def open_json(url: str, api_key: str, retries: int = 3) -> Any:
    request = urllib.request.Request(url, headers=HEADERS)
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return decode_json(response.read())
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8-sig", errors="replace")[:800]
            message = f"HTTP {exc.code}：{' '.join(body.split())}"
            if exc.code in (401, 403):
                raise ApiError(
                    "環境部 API 拒絕金鑰。請確認 Secret 使用的是第2版 API Key；"
                    f"伺服器回應：{redact(message, api_key)}"
                ) from exc
            if exc.code == 404:
                raise
            last_error = ApiError(redact(message, api_key))
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(attempt * 4)
    raise ApiError(f"連線重試 {retries} 次仍失敗：{redact(str(last_error), api_key)}")


def endpoint_candidates(dataset: str, offset: int, api_key: str) -> list[str]:
    query = urllib.parse.urlencode(
        {"format": "json", "offset": offset, "limit": LIMIT, "api_key": api_key}
    )
    paths = (dataset.lower(), dataset)
    return [f"{base}/{path}?{query}" for base in API_BASES for path in paths]


def fetch_page(dataset: str, offset: int, api_key: str) -> Any:
    errors: list[str] = []
    for url in endpoint_candidates(dataset, offset, api_key):
        safe = url.split("api_key=", 1)[0] + "api_key=***"
        print(f"嘗試 {safe}", flush=True)
        try:
            return open_json(url, api_key)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                errors.append(f"{safe} -> HTTP 404")
                continue
            raise
        except ApiError as exc:
            # Authentication errors should not be hidden by trying another host.
            if "拒絕金鑰" in str(exc):
                raise
            errors.append(f"{safe} -> {exc}")
    raise ApiError("；".join(errors) or f"{dataset} 無可用 API 端點")


def fetch_dataset(dataset: str, api_key: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, MAX_ROWS, LIMIT):
        payload = fetch_page(dataset, offset, api_key)
        batch = legacy.extract_rows(payload)
        if offset == 0 and not batch and isinstance(payload, dict):
            message = payload.get("message") or payload.get("error") or payload.get("Message")
            if message:
                raise ApiError(f"{dataset} API 錯誤：{message}")
        rows.extend(batch)
        print(f"{dataset}: offset={offset}, batch={len(batch)}, total={len(rows)}", flush=True)
        if len(batch) < LIMIT:
            break
    return rows


def normalize_all(
    rows: list[dict[str, Any]], normalizer: Callable[[dict[str, Any]], dict[str, Any] | None]
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for row in rows:
        normalized = normalizer(row)
        if normalized is not None:
            output.append(normalized)
    return output


def write_status(output_dir: Path, counts: dict[str, int], errors: dict[str, str]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    status = {
        "schemaVersion": 2,
        "updatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "datasets": counts,
        "errors": errors,
    }
    (output_dir / "sync-status.json").write_text(
        json.dumps(status, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(json.dumps(status, ensure_ascii=False, indent=2), flush=True)


def main() -> int:
    output_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    api_key = os.environ.get("MOENV_API_KEY", "").strip()
    if not api_key:
        print("MOENV_API_KEY 未設定", file=sys.stderr)
        return 2

    configs = [
        ("EMS_S_07", "moenv-sites.json", "環境部污染場址資料", legacy.normalize_site, True),
        ("WQX_P_07", "moenv-regional-wells.json", "環境部區域性地下水水質監測井", legacy.normalize_regional_well, True),
        # 官方已標示此資料集預計下架；失敗時不阻擋其他兩個資料集更新。
        ("GISEPA_P_33", "moenv-site-wells.json", "環境部場置性地下水監測井", legacy.normalize_site_well, False),
    ]

    counts: dict[str, int] = {}
    errors: dict[str, str] = {}
    required_failed = False

    for dataset, filename, source_name, normalizer, required in configs:
        print(f"\n=== 同步 {dataset} ===", flush=True)
        try:
            raw = fetch_dataset(dataset, api_key)
            normalized = normalize_all(raw, normalizer)
            legacy.write_dataset(output_dir, filename, dataset, source_name, normalized)
            counts[dataset] = len(normalized)
            print(f"{dataset} 完成：原始 {len(raw)} 筆，有效座標 {len(normalized)} 筆", flush=True)
        except Exception as exc:  # noqa: BLE001 - emit actionable Actions logs
            message = redact(str(exc), api_key)
            errors[dataset] = message
            counts[dataset] = 0
            print(f"::error title={dataset} 同步失敗::{message}", file=sys.stderr, flush=True)
            if required:
                required_failed = True
            else:
                # Keep the website contract stable even when the retiring dataset is unavailable.
                legacy.write_dataset(output_dir, filename, dataset, source_name, [])

    write_status(output_dir, counts, errors)
    return 1 if required_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
