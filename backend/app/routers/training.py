import logging
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Dict, Any, Optional

from app.services.training_service import training_service

logger = logging.getLogger("underwater-hitl-backend.training_router")

router = APIRouter(
    prefix="/api/training",
    tags=["YOLO Training"]
)

class ExportRequest(BaseModel):
    video_id: Optional[str] = None
    split_ratio: float = 0.8

class FinalizeRequest(BaseModel):
    video_id: str

class StartTrainingRequest(BaseModel):
    video_id: Optional[str] = None
    mode: str = "scratch"  # scratch or continue
    epochs: int = 100
    batch: int = 8
    imgsz: int = 640

@router.post("/export")
def export_dataset(req: Optional[ExportRequest] = None):
    """
    Exports annotated, non-skipped frames to YOLO format (train/val splits & data.yaml)
    and executes training readiness validation for target video_id.
    """
    ratio = req.split_ratio if req else 0.8
    vid_id = req.video_id if req else None
    logger.info(f"Received request to export YOLO dataset for video_id='{vid_id}' with split ratio: {ratio}")
    try:
        res = training_service.export_yolo_dataset(video_id=vid_id, split_ratio=ratio)
        return res
    except Exception as e:
        logger.error(f"Failed to export dataset: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/finalize")
def finalize_dataset(req: FinalizeRequest):
    """
    Finalizes all currently annotated frames for video_id and marks state as READY_FOR_TRAINING.
    Serves as the official bridge between Annotation Workspace and YOLO Training.
    """
    logger.info(f"Received request to finalize dataset for video_id: '{req.video_id}'")
    try:
        res = training_service.finalize_dataset(req.video_id)
        return res
    except Exception as e:
        logger.error(f"Failed to finalize dataset for '{req.video_id}': {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/start")
def start_training(req: Optional[StartTrainingRequest] = None):
    """
    Launches YOLOv8 background training job (supports scratch or transfer learning mode).
    """
    vid_id = req.video_id if req else None
    mode = req.mode if req else "scratch"
    epochs = req.epochs if req else 100
    batch = req.batch if req else 8
    imgsz = req.imgsz if req else 640
    logger.info(f"Received request to start YOLO training for video_id='{vid_id}' (mode={mode}) with epochs={epochs}, batch={batch}, imgsz={imgsz}")
    try:
        res = training_service.start_training(video_id=vid_id, mode=mode, epochs=epochs, batch=batch, imgsz=imgsz)
        return res
    except Exception as e:
        logger.error(f"Failed to start training: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/continue")
def continue_training(req: Optional[StartTrainingRequest] = None):
    """
    Continues training from previous best weights for target video_id (Transfer Learning mode).
    """
    vid_id = req.video_id if req else None
    epochs = req.epochs if req else 100
    batch = req.batch if req else 8
    imgsz = req.imgsz if req else 640
    logger.info(f"Received request to continue YOLO training for video_id='{vid_id}' with epochs={epochs}, batch={batch}, imgsz={imgsz}")
    try:
        res = training_service.start_training(video_id=vid_id, mode="continue", epochs=epochs, batch=batch, imgsz=imgsz)
        return res
    except Exception as e:
        logger.error(f"Failed to continue training: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get("/datasets")
def get_available_training_datasets():
    """
    Returns every available video dataset with its annotation progress, status, class count, and metadata.
    Used by the Training Page to render interactive dataset cards and target selection dropdown.
    """
    logger.info("Received request to retrieve all available training datasets")
    return training_service.get_all_training_datasets()

@router.get("/status")
def get_training_status(video_id: Optional[str] = None):
    """
    Returns current training progress, metrics, and readiness checklist for target video_id.
    """
    return training_service.get_status(video_id=video_id)
