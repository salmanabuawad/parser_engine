"""
Solarica Parsing Engine API.

All project data (blocks, trackers, piers, pier statuses, metadata, uploaded files)
is stored in Postgres. The parser still writes JSON artifacts to disk for debug,
but all API reads/writes go through the DB.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import PROJECTS_ROOT
from app.services import db_store

app = FastAPI(title="Solarica Parsing Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/projects", StaticFiles(directory=str(PROJECTS_ROOT)), name="projects")


# --- Constants ------------------------------------------------------------

VALID_STATUSES = {"New", "In Progress", "Implemented", "Approved", "Rejected", "Fixed"}

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
    "pier_type_specs", "pier_spacing_m",
)

# File upload kinds allowed
FILE_KINDS = {"construction_pdf", "ramming_pdf", "overlay_image", "other"}


# --- Health ---------------------------------------------------------------

@app.get("/health")
def health():
    return {"ok": True}


# --- Helpers --------------------------------------------------------------

def _require_project_uuid(project_id: str) -> str:
    u = db_store.get_project_uuid(project_id)
    if not u:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return u


def _compute_row_stats(trackers: list) -> dict:
    rows = [str(t.get("row", "")) for t in trackers if t.get("row")]
    unique = set(rows)
    numeric = [int(r) for r in rows if r.isdigit()]
    return {
        "row_count": len(unique),
        "mean_row_num": round(sum(numeric) / len(numeric), 1) if numeric else None,
    }


def _load_plant_info(project_uuid: str) -> dict:
    """Merge defaults ← extracted electrical (summary.electrical) ← user plant_info overrides."""
    meta = db_store.get_project_metadata(project_uuid)
    base = dict(PLANT_INFO_DEFAULTS)
    elec = (meta.get("summary") or {}).get("electrical") or {}
    for key in ELECTRICAL_KEYS:
        if elec.get(key) is not None:
            base[key] = elec[key]
    user = meta.get("plant_info") or {}
    for key, value in user.items():
        if value is not None and value != "":
            base[key] = value
    return base


def _project_upload_dir(project_id: str) -> Path:
    d = PROJECTS_ROOT / project_id / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


# --- Project list / create / delete ---------------------------------------

class ProjectCreate(BaseModel):
    project_id: str
    name: Optional[str] = None
    site_profile: Optional[str] = None


@app.get("/api/projects")
def api_list_projects():
    projects = db_store.list_projects()
    # Compatibility: the old API returned [{project_id, summary}] rows
    return [
        {"project_id": p["project_id"], "summary": p.get("summary") or {}}
        for p in projects
    ]


@app.post("/api/projects")
def api_create_project(body: ProjectCreate):
    pid = body.project_id.strip()
    if not pid or not all(c.isalnum() or c in "-_" for c in pid):
        raise HTTPException(status_code=400, detail="Invalid project_id (alphanumeric, '-', '_' only)")
    uu = db_store.upsert_project(pid, name=body.name or pid, site_profile=body.site_profile, status="draft")
    (PROJECTS_ROOT / pid).mkdir(parents=True, exist_ok=True)
    _project_upload_dir(pid)
    return {"project_id": pid, "id": uu, "status": "draft"}


@app.get("/api/projects/{project_id}")
def api_get_project(project_id: str):
    uu = _require_project_uuid(project_id)
    meta = db_store.get_project_metadata(uu)
    summary = dict(meta.get("summary") or {})
    trackers = db_store.get_trackers(uu)
    summary.update(_compute_row_stats(trackers))
    # Ensure counts reflect DB state
    blocks = db_store.get_blocks(uu)
    piers_count = len(db_store.get_piers(uu))
    summary.setdefault("block_count", len(blocks))
    summary.setdefault("tracker_count", len(trackers))
    summary["block_count"] = len(blocks)
    summary["tracker_count"] = len(trackers)
    summary["pier_count"] = piers_count
    return summary


@app.get("/api/projects/{project_id}/blocks")
def api_get_blocks(project_id: str):
    uu = _require_project_uuid(project_id)
    return db_store.get_blocks(uu)


@app.get("/api/projects/{project_id}/trackers")
def api_get_trackers(project_id: str):
    uu = _require_project_uuid(project_id)
    return db_store.get_trackers(uu)


@app.get("/api/projects/{project_id}/piers")
def api_get_piers(project_id: str):
    uu = _require_project_uuid(project_id)
    return db_store.get_piers(uu)


@app.get("/api/projects/{project_id}/pier/{pier_id}")
def api_get_pier(project_id: str, pier_id: str):
    uu = _require_project_uuid(project_id)
    pier = db_store.get_pier(uu, pier_id)
    if not pier:
        raise HTTPException(status_code=404, detail="Pier not found")
    # Lookup tracker + block (cheap since already indexed)
    trackers = db_store.get_trackers(uu)
    blocks = db_store.get_blocks(uu)
    tracker = next((t for t in trackers if t.get("tracker_id") == pier.get("tracker_id")), None)
    block = next((b for b in blocks if b.get("block_id") == pier.get("block_id")), None)
    bundles = db_store.get_drawing_bundles(uu)
    return {"pier": pier, "tracker": tracker, "block": block, "drawing_bundle": bundles.get(pier_id)}


@app.get("/api/projects/{project_id}/pier/{pier_id}/zoom-target")
def api_get_zoom(project_id: str, pier_id: str):
    uu = _require_project_uuid(project_id)
    targets = db_store.get_zoom_targets(uu)
    z = targets.get(pier_id)
    if not z:
        raise HTTPException(status_code=404, detail="Zoom target not found")
    return z


# --- Pier statuses --------------------------------------------------------

class StatusUpdate(BaseModel):
    status: str


@app.get("/api/projects/{project_id}/pier-statuses")
def api_get_pier_statuses(project_id: str):
    uu = _require_project_uuid(project_id)
    return db_store.get_pier_statuses(uu)


@app.put("/api/projects/{project_id}/pier/{pier_id}/status")
def api_update_pier_status(project_id: str, pier_id: str, body: StatusUpdate):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {sorted(VALID_STATUSES)}")
    uu = _require_project_uuid(project_id)
    db_store.set_pier_status(uu, pier_id, body.status)
    return {"pier_id": pier_id, "status": body.status}


# --- Plant info -----------------------------------------------------------

@app.get("/api/projects/{project_id}/plant-info")
def api_get_plant_info(project_id: str):
    uu = _require_project_uuid(project_id)
    return _load_plant_info(uu)


@app.put("/api/projects/{project_id}/plant-info")
def api_update_plant_info(project_id: str, body: dict):
    uu = _require_project_uuid(project_id)
    meta = db_store.get_project_metadata(uu)
    current_user = dict(meta.get("plant_info") or {})
    for key in PLANT_INFO_DEFAULTS:
        if key in body:
            current_user[key] = body[key]
    db_store.update_plant_info(uu, current_user)
    return _load_plant_info(uu)


# --- File upload + parse --------------------------------------------------

@app.get("/api/projects/{project_id}/files")
def api_list_files(project_id: str):
    uu = _require_project_uuid(project_id)
    return db_store.list_project_files(uu)


@app.post("/api/projects/{project_id}/files")
async def api_upload_file(
    project_id: str,
    kind: str = Form(...),
    file: UploadFile = File(...),
):
    if kind not in FILE_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid kind. Must be one of {sorted(FILE_KINDS)}")
    uu = _require_project_uuid(project_id)

    upload_dir = _project_upload_dir(project_id)
    safe_name = f"{kind}_{uuid.uuid4().hex[:8]}_{Path(file.filename).name}"
    dest = upload_dir / safe_name

    sha = hashlib.sha256()
    size = 0
    with dest.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            sha.update(chunk)
            size += len(chunk)
            f.write(chunk)

    file_id = db_store.add_project_file(
        project_uuid=uu,
        kind=kind,
        filename=safe_name,
        storage_path=str(dest.resolve()),
        original_name=file.filename,
        size_bytes=size,
        sha256=sha.hexdigest(),
    )
    return {"id": file_id, "filename": safe_name, "kind": kind, "size": size}


@app.delete("/api/projects/{project_id}/files")
def api_clear_files(project_id: str):
    uu = _require_project_uuid(project_id)
    # Delete physical files too
    upload_dir = PROJECTS_ROOT / project_id / "uploads"
    if upload_dir.exists():
        shutil.rmtree(upload_dir, ignore_errors=True)
        upload_dir.mkdir(parents=True, exist_ok=True)
    db_store.clear_project_files(uu)
    return {"ok": True}


@app.post("/api/projects/{project_id}/parse")
def api_parse_project(project_id: str):
    """
    Clear all existing artifacts for this project and re-run the parser using the
    currently uploaded files. Returns the new summary.
    """
    uu = _require_project_uuid(project_id)
    files = db_store.list_project_files(uu)
    kinds = {f["kind"]: f for f in files}
    construction = kinds.get("construction_pdf")
    ramming = kinds.get("ramming_pdf")
    overlay = kinds.get("overlay_image") or construction  # fall back to construction PDF
    if not construction:
        raise HTTPException(status_code=400, detail="Missing construction PDF. Upload a file with kind=construction_pdf first.")
    if not ramming:
        raise HTTPException(status_code=400, detail="Missing ramming PDF. Upload a file with kind=ramming_pdf first.")

    # Clear old artifacts
    db_store.delete_project_artifacts(uu)
    db_store.upsert_project(project_id, status="parsing")

    try:
        # Run the parser
        from app.parser import run_pipeline
        from app.site_profiles import load_site_profile
        from app.electrical_metadata import extract_electrical_metadata

        out_dir = PROJECTS_ROOT / project_id
        out_dir.mkdir(parents=True, exist_ok=True)

        input_paths = [construction["storage_path"], ramming["storage_path"]]
        profile = load_site_profile(profile_name="auto", input_paths=input_paths)

        result = run_pipeline(
            construction_pdf=construction["storage_path"],
            ramming_pdf=ramming["storage_path"],
            overlay_source=overlay["storage_path"],
            out_dir=out_dir,
            profile=profile,
        )

        # Persist into DB
        db_store.insert_blocks(uu, result.get("blocks", []))
        db_store.insert_trackers(uu, result.get("trackers", []))
        db_store.insert_piers(uu, result.get("piers", []))
        db_store.set_drawing_bundles(uu, result.get("drawing_bundles", {}))
        db_store.set_zoom_targets(uu, result.get("zoom_targets", {}))

        # Attach extracted electrical metadata to summary
        summary = dict(result.get("summary") or {})
        try:
            elec = extract_electrical_metadata(
                construction["storage_path"], ramming["storage_path"]
            )
            if elec.get("_extracted"):
                summary["electrical"] = {k: v for k, v in elec.items() if not k.startswith("_")}
        except Exception:
            pass
        db_store.set_project_metadata(uu, summary)
        db_store.upsert_project(project_id, status="ready")

        return {
            "status": "ready",
            "block_count": len(result.get("blocks", [])),
            "tracker_count": len(result.get("trackers", [])),
            "pier_count": len(result.get("piers", [])),
        }
    except Exception as e:
        db_store.upsert_project(project_id, status="error")
        raise HTTPException(status_code=500, detail=str(e))


# --- Aggregation endpoints (fast DB queries) ------------------------------

@app.get("/api/projects/{project_id}/pier-type-counts")
def api_pier_type_counts(project_id: str):
    uu = _require_project_uuid(project_id)
    return db_store.get_pier_type_counts(uu)


@app.get("/api/projects/{project_id}/block-summary")
def api_block_summary(project_id: str):
    uu = _require_project_uuid(project_id)
    return db_store.get_block_summary(uu)


@app.get("/api/projects/{project_id}/row-summary")
def api_row_summary(project_id: str):
    uu = _require_project_uuid(project_id)
    return db_store.get_row_summary(uu)
