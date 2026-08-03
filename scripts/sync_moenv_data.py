#!/usr/bin/env python3
"""Download and normalize MOENV public datasets for the static GIS site."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

API_BASE = "https://data.moenv.gov.tw/api/v2"
LIMIT = 1000
MAX_ROWS = 50000
USER_AGENT = "soil-groundwater-gis/1.0 (+GitHub Actions)"


def lower_keys(record: dict[str, Any]) -> dict[str, Any]:
    return {str(k).lower(): v for k, v in record.items()}


def first(record: dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = record.get(key.lower())
        if value is not None and str(value).strip() != "":
            return value
    return default


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def valid_taiwan(lat: float | None, lng: float | None) -> bool:
    return lat is not None and lng is not None and 20 < lat < 27 and 117 < lng < 123


def tm2_to_wgs84(easting: Any, northing: Any, zone: int = 121) -> tuple[float, float] | None:
    x_val = to_float(easting)
    y_val = to_float(northing)
    if x_val is None or y_val is None:
        return None

    a = 6378137.0
    f = 1 / 298.257222101
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    k0 = 0.9999
    x = x_val - 250000.0
    y = y_val
    m = y / k0
    e4 = e2 * e2
    e6 = e4 * e2
    mu = m / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    j1 = 3 * e1 / 2 - 27 * e1**3 / 32
    j2 = 21 * e1**2 / 16 - 55 * e1**4 / 32
    j3 = 151 * e1**3 / 96
    j4 = 1097 * e1**4 / 512
    fp = mu + j1 * math.sin(2 * mu) + j2 * math.sin(4 * mu) + j3 * math.sin(6 * mu) + j4 * math.sin(8 * mu)
    sin_fp, cos_fp, tan_fp = math.sin(fp), math.cos(fp), math.tan(fp)
    c1 = ep2 * cos_fp**2
    t1 = tan_fp**2
    n1 = a / math.sqrt(1 - e2 * sin_fp**2)
    r1 = a * (1 - e2) / (1 - e2 * sin_fp**2) ** 1.5
    d = x / (n1 * k0)
    lat = fp - (n1 * tan_fp / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ep2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ep2 - 3 * c1**2) * d**6 / 720
    )
    lon0 = math.radians(zone)
    lon = lon0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ep2 + 24 * t1**2) * d**5 / 120
    ) / cos_fp
    return math.degrees(lat), math.degrees(lon)


def coordinate_from_values(x: Any, y: Any, county: str = "") -> tuple[float, float] | None:
    x_num, y_num = to_float(x), to_float(y)
    if x_num is None or y_num is None:
        return None
    if 117 <= x_num <= 123 and 20 <= y_num <= 27:
        return y_num, x_num
    if 117 <= y_num <= 123 and 20 <= x_num <= 27:
        return x_num, y_num
    zone = 119 if any(name in county for name in ("金門", "連江", "馬祖")) else 121
    return tm2_to_wgs84(x_num, y_num, zone)


def extract_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("records", "data", "result", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
        if isinstance(value, dict) and isinstance(value.get("records"), list):
            return [row for row in value["records"] if isinstance(row, dict)]
    return []


def request_json(url: str, retries: int = 3) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read().decode("utf-8-sig"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            if attempt == retries:
                raise RuntimeError(f"request failed after {retries} attempts: {url}: {exc}") from exc
            time.sleep(attempt * 3)
    raise RuntimeError("unreachable")


def fetch_dataset(dataset: str, api_key: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, MAX_ROWS, LIMIT):
        query = urllib.parse.urlencode(
            {"format": "json", "offset": offset, "limit": LIMIT, "api_key": api_key}
        )
        payload = request_json(f"{API_BASE}/{dataset}?{query}")
        batch = extract_rows(payload)
        rows.extend(batch)
        print(f"{dataset}: offset={offset}, batch={len(batch)}, total={len(rows)}", flush=True)
        if len(batch) < LIMIT:
            break
    return rows


def normalize_site(raw: dict[str, Any]) -> dict[str, Any] | None:
    r = lower_keys(raw)
    lat = to_float(first(r, "wgs84_lat", "lat", "latitude"))
    lng = to_float(first(r, "wgs84_lng", "lng", "lon", "longitude"))
    if not valid_taiwan(lat, lng):
        return None
    site_type = str(first(r, "site_type"))
    site_use = str(first(r, "site_use"))
    control = str(first(r, "controltype"))
    deanno_date = str(first(r, "deanno_date"))
    deanno_no = str(first(r, "deanno_no"))
    combined = f"{site_type} {site_use} {control}"
    released = bool(deanno_date.strip() or deanno_no.strip() or "解除" in combined or "解列" in combined)
    if released:
        status_group = "released"
    elif "整治" in combined:
        status_group = "active-remediation"
    elif "控制" in combined:
        status_group = "active-control"
    else:
        status_group = "other-active"
    has_soil = "土壤" in combined
    has_groundwater = "地下水" in combined
    media_group = "both" if has_soil and has_groundwater else "soil" if has_soil else "groundwater" if has_groundwater else "unknown"
    return {
        "id": str(first(r, "site_id")),
        "name": str(first(r, "site_name", default="污染場址")),
        "county": str(first(r, "county")),
        "township": str(first(r, "township")),
        "siteType": site_type,
        "siteUse": site_use,
        "pollutant": str(first(r, "pollutant")),
        "address": str(first(r, "pollutantaddress", "siteaddress", "address")),
        "control": control,
        "annoNo": str(first(r, "anno_no")),
        "annoDate": str(first(r, "anno_date")),
        "deannoNo": deanno_no,
        "deannoDate": deanno_date,
        "landNo": str(first(r, "landno")),
        "area": str(first(r, "sitearea")),
        "lat": lat,
        "lng": lng,
        "statusGroup": status_group,
        "mediaGroup": media_group,
        "released": released,
    }


def normalize_regional_well(raw: dict[str, Any]) -> dict[str, Any] | None:
    r = lower_keys(raw)
    county = str(first(r, "county"))
    point = coordinate_from_values(first(r, "twd97lon", "wgs84_lng", "lng"), first(r, "twd97lat", "wgs84_lat", "lat"), county)
    if not point or not valid_taiwan(*point):
        point = coordinate_from_values(first(r, "twd97tm2x", "gis_x"), first(r, "twd97tm2y", "gis_y"), county)
    if not point or not valid_taiwan(*point):
        return None
    status = str(first(r, "statusofuse", "status"))
    active = not any(token in status for token in ("停用", "廢", "撤", "不使用"))
    return {
        "source": "環境部區域性水質井",
        "sourceCode": "MOENV-WQ",
        "id": str(first(r, "siteid", "wellid")),
        "name": str(first(r, "sitename", "wellname", default="區域性地下水水質監測井")),
        "county": county,
        "township": str(first(r, "township")),
        "address": str(first(r, "siteaddress", "address")),
        "groundwaterZone": str(first(r, "ugwdistname", "groundwaterzone")),
        "depth": str(first(r, "welldepth", "depth")),
        "status": status,
        "active": active,
        "lat": point[0],
        "lng": point[1],
    }


def normalize_site_well(raw: dict[str, Any]) -> dict[str, Any] | None:
    r = lower_keys(raw)
    county = str(first(r, "county"))
    point = coordinate_from_values(first(r, "gis_x", "wgs84_lng", "lng"), first(r, "gis_y", "wgs84_lat", "lat"), county or str(first(r, "site_addr")))
    if not point or not valid_taiwan(*point):
        return None
    status = str(first(r, "attribute", "status"))
    active = not any(token in status for token in ("停用", "廢", "撤"))
    return {
        "source": "環境部場置性監測井",
        "sourceCode": "MOENV-SITE",
        "id": str(first(r, "wno", "wellno", "wellid")),
        "name": str(first(r, "wname", "wellname", default="場置性地下水監測井")),
        "siteName": str(first(r, "site_name")),
        "county": county,
        "township": str(first(r, "township")),
        "address": str(first(r, "site_addr", "address")),
        "groundwaterZone": str(first(r, "groundwaterzone")),
        "depth": str(first(r, "welldepth", "depth")),
        "attribute": status,
        "status": status,
        "active": active,
        "url": str(first(r, "url")),
        "lat": point[0],
        "lng": point[1],
    }


def write_dataset(output_dir: Path, filename: str, dataset: str, source_name: str, rows: list[dict[str, Any]]) -> None:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    payload = {
        "schemaVersion": 1,
        "dataset": dataset,
        "source": source_name,
        "updatedAt": now.isoformat().replace("+00:00", "Z"),
        "count": len(rows),
        "records": rows,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / filename).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data", help="output directory")
    args = parser.parse_args()

    api_key = os.environ.get("MOENV_API_KEY", "").strip()
    if not api_key:
        print("MOENV_API_KEY is missing", file=sys.stderr)
        return 2

    output_dir = Path(args.output)
    raw_sites = fetch_dataset("EMS_S_07", api_key)
    raw_regional = fetch_dataset("WQX_P_07", api_key)
    raw_site_wells = fetch_dataset("GISEPA_P_33", api_key)

    sites = [record for row in raw_sites if (record := normalize_site(row))]
    regional = [record for row in raw_regional if (record := normalize_regional_well(row))]
    site_wells = [record for row in raw_site_wells if (record := normalize_site_well(row))]

    write_dataset(output_dir, "moenv-sites.json", "EMS_S_07", "環境部污染場址資料", sites)
    write_dataset(output_dir, "moenv-regional-wells.json", "WQX_P_07", "環境部區域性地下水水質監測井", regional)
    write_dataset(output_dir, "moenv-site-wells.json", "GISEPA_P_33", "環境部場置性地下水監測井", site_wells)

    status = {
        "schemaVersion": 1,
        "updatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "datasets": {
            "EMS_S_07": len(sites),
            "WQX_P_07": len(regional),
            "GISEPA_P_33": len(site_wells),
        },
    }
    (output_dir / "sync-status.json").write_text(json.dumps(status, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
