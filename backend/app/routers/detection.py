import os
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException, Body
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app.services.detection_service import detection_service
from app.services.model_loader import model_loader

logger = logging.getLogger("underwater-hitl-backend")

router = APIRouter(
    prefix="/api/detection",
    tags=["Object Detection"]
)

class StartDetectionRequest(BaseModel):
    upload_id: str
    saved_path: str
    confidence_threshold: float = Field(0.25, ge=0.0, le=1.0)
    iou_threshold: float = Field(0.45, ge=0.0, le=1.0)
    max_detections: int = Field(100, ge=1, le=1000)
    device: Optional[str] = Field("Auto", description="Auto-selected inference device")
    model_name: Optional[str] = Field("underwater_best.pt")

@router.post("/upload")
async def upload_detection_video(file: UploadFile = File(...)):
    """
    Upload an MP4, AVI, or MOV video file for object detection processing.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename missing in upload.")

    ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = [".mp4", ".avi", ".mov"]
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed formats: MP4, AVI, MOV."
        )

    try:
        content = await file.read()
        metadata = detection_service.handle_video_upload(file.filename, content)
        return metadata
    except Exception as e:
        logger.error(f"Upload failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/active-model")
async def get_active_detection_model():
    """
    Retrieves metadata for the active trained underwater detection model.
    """
    try:
        active_model = model_loader.get_model_info("underwater_best.pt")
        return active_model
    except Exception as e:
        logger.error(f"Failed to fetch active model: {e}")
        raise HTTPException(
            status_code=404,
            detail="No trained detection model available. Please complete the training workflow before running object detection."
        )

@router.get("/models")
async def get_detection_models():
    """
    Retrieves information on available trained detection models.
    """
    try:
        models = model_loader.list_models()
        return {"models": models}
    except Exception as e:
        logger.error(f"Failed to fetch models: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/start")
async def start_detection_job(request: StartDetectionRequest):
    """
    Triggers object detection processing on uploaded video with specified parameters.
    """
    if not os.path.exists(request.saved_path):
        raise HTTPException(status_code=404, detail="Uploaded video file not found on server.")

    try:
        settings = request.dict()
        job_id = detection_service.start_detection_job(
            upload_id=request.upload_id,
            saved_path_str=request.saved_path,
            settings=settings
        )
        return {"job_id": job_id, "status": "started"}
    except Exception as e:
        logger.error(f"Start detection failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{job_id}")
async def get_detection_status(job_id: str):
    """
    Polls real-time detection job progress (current frame, FPS, stage, ETA).
    """
    status = detection_service.get_job_status(job_id)
    if not status:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return status

@router.get("/results/{job_id}")
async def get_detection_results(job_id: str):
    """
    Retrieves full detection analytics, metrics, class distribution, and timeline logs.
    """
    results = detection_service.get_job_results(job_id)
    if not results:
        status = detection_service.get_job_status(job_id)
        if status and status.get("status") == "processing":
            raise HTTPException(status_code=202, detail="Job is still processing.")
        raise HTTPException(status_code=404, detail=f"Results for job '{job_id}' not found.")
    return results

@router.get("/download-video/{job_id}")
async def download_processed_video(job_id: str):
    """
    Downloads or streams the rendered video with bounding box overlays.
    """
    file_path = detection_service.get_job_file_path(job_id, "processed.mp4")
    if not file_path:
        raise HTTPException(status_code=404, detail="Processed video not found.")
    return FileResponse(
        path=str(file_path),
        media_type="video/mp4",
        filename=f"detection_processed_{job_id}.mp4",
        headers={"Accept-Ranges": "bytes"}
    )

@router.get("/original-video/{job_id}")
async def get_original_video(job_id: str):
    """
    Streams the original uploaded video for comparison mode.
    """
    status = detection_service.get_job_status(job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Job not found.")
    
    upload_id = status.get("upload_id")
    uploads_dir = detection_service.uploads_dir
    # Find uploaded file matching upload_id
    if upload_id and uploads_dir.exists():
        for f in uploads_dir.iterdir():
            if f.name.startswith(upload_id):
                return FileResponse(
                    path=str(f),
                    media_type="video/mp4",
                    headers={"Accept-Ranges": "bytes"}
                )
            
    raise HTTPException(status_code=404, detail="Original video file not found.")

@router.get("/download-csv/{job_id}")
async def download_csv(job_id: str):
    """
    Downloads frame-by-frame detection data in CSV format.
    """
    file_path = detection_service.get_job_file_path(job_id, "detections.csv")
    if not file_path:
        raise HTTPException(status_code=404, detail="Detection CSV file not found.")
    return FileResponse(
        path=str(file_path),
        media_type="text/csv",
        filename=f"detections_{job_id}.csv"
    )

@router.get("/download-json/{job_id}")
async def download_json(job_id: str):
    """
    Downloads full detection structured data in JSON format.
    """
    file_path = detection_service.get_job_file_path(job_id, "results.json")
    if not file_path:
        raise HTTPException(status_code=404, detail="Detection JSON file not found.")
    return FileResponse(
        path=str(file_path),
        media_type="application/json",
        filename=f"detections_{job_id}.json"
    )

@router.get("/download-report/{job_id}")
async def download_report(job_id: str):
    """
    Downloads summary text report.
    """
    file_path = detection_service.get_job_file_path(job_id, "report.txt")
    if not file_path:
        raise HTTPException(status_code=404, detail="Summary report file not found.")
    return FileResponse(
        path=str(file_path),
        media_type="text/plain",
        filename=f"detection_report_{job_id}.txt"
    )
