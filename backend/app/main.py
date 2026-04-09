import json
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from app.config import PROJECTS_ROOT
from app.services.project_cache import ProjectCache
from app.services.system_cache import SystemCache
from app.services.system_cache_service import ensure_system_cache, export_system_excel_from_cache
from pathlib import Path

app = FastAPI(title="Solarica")
cache = ProjectCache(PROJECTS_ROOT)
system_cache = SystemCache(PROJECTS_ROOT)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/projects", StaticFiles(directory=str(PROJECTS_ROOT)), name="projects")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/api/projects")
def list_projects():
    return cache.list_projects()

@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    try:
        proj = cache.get_project(project_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Project not found")
    summary = dict(proj["summary"])
    # Augment with row stats from trackers
    trackers = proj.get("trackers", [])
    rows = [t.get("row") for t in trackers if t.get("row")]
    unique_rows = set(rows)
    numeric_rows = [int(r) for r in rows if str(r).isdigit()]
    summary["row_count"] = len(unique_rows)
    summary["mean_row_num"] = round(sum(numeric_rows) / len(numeric_rows), 1) if numeric_rows else None
    return summary

@app.get("/api/projects/{project_id}/blocks")
def get_blocks(project_id: str):
    try:
        return cache.get_project(project_id)["blocks"]
    except Exception:
        raise HTTPException(status_code=404, detail="Project not found")

@app.get("/api/projects/{project_id}/trackers")
def get_trackers(project_id: str):
    try:
        return cache.get_project(project_id)["trackers"]
    except Exception:
        raise HTTPException(status_code=404, detail="Project not found")

@app.get("/api/projects/{project_id}/piers")
def get_piers(project_id: str):
    try:
        return cache.get_project(project_id)["piers"]
    except Exception:
        raise HTTPException(status_code=404, detail="Project not found")

@app.get("/api/projects/{project_id}/pier/{pier_id}")
def get_pier(project_id: str, pier_id: str):
    try:
        project = cache.get_project(project_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Project not found")
    pier = next((p for p in project["piers"] if p["pier_id"] == pier_id), None)
    if not pier:
        raise HTTPException(status_code=404, detail="Pier not found")
    tracker = next((t for t in project["trackers"] if t["tracker_id"] == pier["tracker_id"]), None)
    block = next((b for b in project["blocks"] if b["block_id"] == pier["block_id"]), None)
    return {"pier": pier, "tracker": tracker, "block": block, "drawing_bundle": project["drawing_bundles"].get(pier_id)}

@app.get("/api/projects/{project_id}/pier/{pier_id}/zoom-target")
def get_zoom(project_id: str, pier_id: str):
    try:
        z = cache.get_project(project_id)["zoom_targets"].get(pier_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Project not found")
    if not z:
        raise HTTPException(status_code=404, detail="Zoom target not found")
    return z


# --- Pier statuses --------------------------------------------------------

VALID_STATUSES = {"Not Started", "Implemented", "Approved", "Rejected", "Fixed"}

def _statuses_path(project_id: str) -> Path:
    return PROJECTS_ROOT / project_id / "pier_statuses.json"

def _load_statuses(project_id: str) -> dict:
    p = _statuses_path(project_id)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {}

def _save_statuses(project_id: str, data: dict):
    p = _statuses_path(project_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")

class StatusUpdate(BaseModel):
    status: str

@app.get("/api/projects/{project_id}/pier-statuses")
def get_pier_statuses(project_id: str):
    return _load_statuses(project_id)

@app.put("/api/projects/{project_id}/pier/{pier_id}/status")
def update_pier_status(project_id: str, pier_id: str, body: StatusUpdate):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {VALID_STATUSES}")
    statuses = _load_statuses(project_id)
    if body.status == "Not Started":
        statuses.pop(pier_id, None)
    else:
        statuses[pier_id] = body.status
    _save_statuses(project_id, statuses)
    return {"pier_id": pier_id, "status": body.status}


# --- Plant info (editable project metadata) --------------------------------

PLANT_INFO_DEFAULTS = {
    "total_output_mw": None,
    "total_strings": None,
    "total_modules": None,
    "modules_per_string": None,
    "module_capacity_w": None,
    "module_length_m": None,
    "module_width_m": None,
    "pitch_m": None,
    "inverters": None,
    "dccb": None,
    "string_groups": None,
    "devices": None,
    "site_id": None,
    "project_number": None,
    "nextracker_model": None,
    "lat_long": None,
    "snow_load": None,
    "wind_load": None,
    "issue_date": None,
    "expected_trackers": None,
    "expected_piers": None,
    "expected_modules_from_bom": None,
    "tolerance_ratio": 0.05,
    "notes": "",
}

ELECTRICAL_KEYS = (
    "total_output_mw", "total_strings", "total_modules", "modules_per_string",
    "module_capacity_w", "module_length_m", "module_width_m", "pitch_m",
    "inverters", "dccb", "string_groups", "devices",
    "site_id", "project_number", "nextracker_model", "lat_long",
    "snow_load", "wind_load", "issue_date",
    "expected_trackers", "expected_piers", "expected_modules_from_bom",
    "tracker_matrix", "bill_of_materials",
)

def _plant_info_path(project_id: str) -> Path:
    return PROJECTS_ROOT / project_id / "plant_info.json"

def _load_plant_info(project_id: str) -> dict:
    p = _plant_info_path(project_id)
    base = dict(PLANT_INFO_DEFAULTS)
    # Fall back to electrical metadata extracted from PDFs (in summary.json)
    try:
        proj = cache.get_project(project_id)
        elec = (proj.get("summary") or {}).get("electrical") or {}
        for key in ELECTRICAL_KEYS:
            if elec.get(key) is not None:
                base[key] = elec[key]
    except Exception:
        pass
    # User overrides win
    if p.exists():
        try:
            user = json.loads(p.read_text(encoding="utf-8"))
            for key, value in user.items():
                if value is not None and value != "":
                    base[key] = value
        except Exception:
            pass
    return base

def _save_plant_info(project_id: str, data: dict):
    p = _plant_info_path(project_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")

@app.get("/api/projects/{project_id}/plant-info")
def get_plant_info(project_id: str):
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return _load_plant_info(project_id)

@app.post("/api/projects/{project_id}/plant-info/extract")
def extract_plant_info(project_id: str):
    """Re-extract electrical metadata from the construction PDF and merge into summary.json."""
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    manifest_path = project_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=400, detail="No manifest.json found for project")
    summary_path = project_dir / "summary.json"
    if not summary_path.exists():
        raise HTTPException(status_code=400, detail="No summary.json found for project")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        inputs = manifest.get("inputs") or {}
        construction_pdf = inputs.get("construction_pdf")
        ramming_pdf = inputs.get("ramming_pdf")
        if not construction_pdf or not Path(construction_pdf).exists():
            raise HTTPException(status_code=400, detail=f"Construction PDF not found at {construction_pdf}")
        from app.electrical_metadata import extract_electrical_metadata
        elec = extract_electrical_metadata(construction_pdf, ramming_pdf)
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        if elec.get("_extracted"):
            summary["electrical"] = {k: elec.get(k) for k in ELECTRICAL_KEYS}
            summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
            cache.projects.pop(project_id, None)
        return summary.get("electrical", {})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/projects/{project_id}/plant-info")
def update_plant_info(project_id: str, body: dict):
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    current = _load_plant_info(project_id)
    for key in PLANT_INFO_DEFAULTS:
        if key in body:
            current[key] = body[key]
    _save_plant_info(project_id, current)
    return current


@app.post("/api/projects/{project_id}/system/ensure")
def api_ensure_system(project_id: str, force: bool = False):
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        result = ensure_system_cache(project_dir=project_dir, force=force)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{project_id}/system/meta")
def api_system_meta(project_id: str):
    try:
        return system_cache.get_system(project_id)["meta"]
    except Exception:
        raise HTTPException(status_code=404, detail="System cache not found. Call /system/ensure first.")


@app.get("/api/projects/{project_id}/system/pier-type-counts")
def api_system_pier_type_counts(project_id: str):
    try:
        return system_cache.get_system(project_id)["pier_type_counts"]
    except Exception:
        raise HTTPException(status_code=404, detail="System cache not found. Call /system/ensure first.")


@app.get("/api/projects/{project_id}/system/pier-type-legend")
def api_system_pier_type_legend(project_id: str):
    try:
        return system_cache.get_system(project_id)["pier_type_legend"]
    except Exception:
        raise HTTPException(status_code=404, detail="System cache not found. Call /system/ensure first.")


@app.get("/api/projects/{project_id}/system/trackers")
def api_system_trackers(project_id: str):
    try:
        return system_cache.get_system(project_id)["trackers"]
    except Exception:
        raise HTTPException(status_code=404, detail="System cache not found. Call /system/ensure first.")


@app.get("/api/projects/{project_id}/system/piers")
def api_system_piers(
    project_id: str,
    block: str = "",
    row: str = "",
    tracker: str = "",
    pier_type: str = "",
    limit: int = 5000,
    offset: int = 0,
):
    try:
        piers = system_cache.get_system(project_id)["piers"]
    except Exception:
        raise HTTPException(status_code=404, detail="System cache not found. Call /system/ensure first.")

    def match(p):
        if block and str(p.get("block", "")) != block:
            return False
        if row and str(p.get("row", "")) != row:
            return False
        if tracker and str(p.get("tracker", "")) != tracker:
            return False
        if pier_type and str(p.get("pier_type", "")).upper() != pier_type.upper():
            return False
        return True

    # Filter then slice for simple paging.
    filtered = [p for p in piers if match(p)]
    limit = max(1, min(int(limit), 20000))
    offset = max(0, int(offset))
    return {
        "total": len(filtered),
        "items": filtered[offset : offset + limit],
    }


@app.post("/api/projects/{project_id}/system/export-excel")
def api_system_export_excel(project_id: str, force: bool = False):
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        ensure_system_cache(project_dir=project_dir, force=force)
        result = export_system_excel_from_cache(project_id=project_id, project_dir=project_dir)
        url = f"/projects/{project_id}/{result['xlsx_filename']}"
        return {"xlsx_path": result["xlsx_path"], "url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
