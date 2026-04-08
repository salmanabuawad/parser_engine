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
        return cache.get_project(project_id)["summary"]
    except Exception:
        raise HTTPException(status_code=404, detail="Project not found")

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
