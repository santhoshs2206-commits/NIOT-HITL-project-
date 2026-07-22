import logging
from fastapi import APIRouter, UploadFile, File, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.services import video_service, tracking_service

logger = logging.getLogger("underwater-hitl-backend.videos_router")

router = APIRouter(
    tags=["Videos"]
)

class VideoUploadResponse(BaseModel):
    video_id: str
    filename: str
    status: str

class ExtractionSummaryModel(BaseModel):
    extraction_time_s: float
    average_composite_score: float
    pixel_diff_avg: float
    hist_diff_avg: float
    ssim_diff_avg: float
    trigger_reasons: dict[str, int]
    original_fps: float
    original_duration_s: float
    reduction_ratio: float

class FrameExtractionResponse(BaseModel):
    video_id: str
    frames_extracted: int
    original_total_frames: int
    frame_width: int
    frame_height: int
    status: str
    motion_profile: str
    reduction_ratio: float
    extraction_summary: ExtractionSummaryModel

class FrameInfo(BaseModel):
    name: str
    annotated: bool
    skipped: bool = False

class FramesListResponse(BaseModel):
    video_id: str
    total_frames: int
    frames: list[FrameInfo]

class SkipRangeRequest(BaseModel):
    start_frame: str
    end_frame: str

class AnnotationItem(BaseModel):
    label: str
    bbox: list[float]  # [xmin, ymin, xmax, ymax]
    id: str | None = None
    tracking_id: str | None = None
    source: str | None = None
    propagation_state: str | None = None
    confidence: float | None = None
    tracker: str | None = None
    tracker_version: str | None = None
    created_by: str | None = None



class SaveAnnotationsRequest(BaseModel):
    annotations: list[AnnotationItem]

class SaveAnnotationsResponse(BaseModel):
    video_id: str
    frame_name: str
    annotated_frames: int
    status: str

class VideoStatusItem(BaseModel):
    video_id: str
    filename: str
    total_frames: int
    skipped_frames: int = 0
    effective_total_frames: int = 0
    original_total_frames: int
    annotated_frames: int
    completion_rate: float
    status: str
    motion_profile: str
    reduction_ratio: float
    extraction_summary: ExtractionSummaryModel | None = None
    video_deleted: bool = False

class DatasetStatusResponse(BaseModel):
    total_videos: int
    total_frames: int
    skipped_frames: int = 0
    effective_total_frames: int = 0
    annotated_frames: int
    remaining_frames: int
    overall_completion_rate: float
    videos: list[VideoStatusItem]

class PropagationRequest(BaseModel):
    start_frame: str
    mode: str = "until_lost"
    tracker_type: str = "CSRT"
    yolo_fallback: bool = False
    session_id: str | None = None
    confidence_threshold: float | None = None

class PropagationResponse(BaseModel):
    frames_propagated: int
    stop_reason: str
    failure_frame: str | None = None
    objects_tracked: int
    session_id: str
    error_detail: str | None = None
    history: list[dict] | None = None


@router.post("/upload-video", response_model=VideoUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_video(file: UploadFile = File(...)):
    """
    Upload an underwater video.
    Validates the video format, creates a dedicated storage folder under a unique video_id,
    saves the video, and creates the initial metadata.json file.
    """
    logger.info(f"Received upload request for file: '{file.filename}'")
    result = video_service.save_uploaded_video(file)
    return result

@router.post("/extract-frames/{video_id}", response_model=FrameExtractionResponse)
def extract_frames(video_id: str, motion_profile: str = "Moderate"):
    """
    Extract frames from the uploaded video file.
    Locates the video file inside the storage folder for the given video_id,
    extracts key frames as JPEG files using the specified motion_profile,
    clears old frames if any exist, updates metadata.json, and returns frame details.
    """
    logger.info(f"Received frame extraction request for video_id: '{video_id}' with profile: '{motion_profile}'")
    result = video_service.extract_frames_for_video(video_id, motion_profile=motion_profile)
    return result

@router.get("/extraction-progress/{video_id}")
def get_extraction_progress(video_id: str):
    """
    Get real-time frame extraction progress, FPS, ETA, current frame, and recent keyframe image names.
    """
    return video_service.get_extraction_progress(video_id)

@router.get("/frames/{video_id}", response_model=FramesListResponse)
async def get_frames(video_id: str):
    """
    Get the list of all extracted frames for the given video_id, 
    including their individual annotation status.
    """
    logger.info(f"Received request to get frames for video_id: '{video_id}'")
    result = video_service.get_frames_for_video(video_id)
    return result

@router.get("/frame/{video_id}/{frame_name}", response_class=FileResponse)
async def get_frame(video_id: str, frame_name: str):
    """
    Retrieve and serve an individual extracted frame image file.
    Validates that the frame file exists and returns it as an image response.
    """
    logger.info(f"Received request to get frame '{frame_name}' for video_id: '{video_id}'")
    frame_path = video_service.get_frame_path(video_id, frame_name)
    return FileResponse(path=frame_path, media_type="image/jpeg")

@router.post("/annotations/propagate/{video_id}", response_model=PropagationResponse)
def propagate_annotations(video_id: str, request: PropagationRequest):
    """
    Propagate bounding box annotations from a starting frame to subsequent frames
    using optical flow/template object tracking and optional YOLO recovery fallback.
    """
    logger.info(f"Received propagation request for video_id: '{video_id}' from frame '{request.start_frame}'")
    try:
        result = tracking_service.propagate_annotations(
            video_id=video_id,
            start_frame=request.start_frame,
            mode=request.mode,
            tracker_type=request.tracker_type,
            use_yolo_fallback=request.yolo_fallback,
            session_id=request.session_id,
            confidence_threshold=request.confidence_threshold
        )
        return result
    except Exception as e:
        logger.exception(f"Failed to execute propagation for video_id: '{video_id}': {e}")
        return {
            "frames_propagated": 0,
            "stop_reason": "error",
            "failure_frame": request.start_frame,
            "objects_tracked": 0,
            "session_id": "",
            "error_detail": str(e)
        }

@router.post("/annotations/{video_id}/{frame_name}", response_model=SaveAnnotationsResponse)
async def save_annotations(video_id: str, frame_name: str, request: SaveAnnotationsRequest):
    """
    Save object detection annotations for a specific frame image.
    Converts drawn pixel coordinates to normalized YOLO coordinates,
    updates classes.json with new categories dynamically,
    updates metadata, and returns status details.
    """
    logger.info(f"Received request to save annotations for video_id: '{video_id}', frame: '{frame_name}'")
    annotations_dicts = [ann.dict() for ann in request.annotations]
    result = video_service.save_annotations_for_frame(video_id, frame_name, annotations_dicts)
    return result

@router.put("/annotations/{video_id}/{frame_name}/{annotation_id}", response_model=SaveAnnotationsResponse)
async def update_single_annotation(video_id: str, frame_name: str, annotation_id: str, request: AnnotationItem):
    """
    Update a single object detection annotation for a specific frame by its annotation_id.
    """
    logger.info(f"Received request to update single annotation '{annotation_id}' for video_id: '{video_id}', frame: '{frame_name}'")
    result = video_service.update_single_annotation(video_id, frame_name, annotation_id, request.dict())
    return result

@router.get("/classes", response_model=list[str])
async def get_classes():
    """
    Get the list of all registered object labels (unique class names)
    to populate the frontend autocomplete suggestions.
    """
    logger.info("Received request to retrieve all dynamic class labels")
    result = video_service.get_all_classes()
    return result

@router.get("/dataset-status", response_model=DatasetStatusResponse)
async def get_dataset_status():
    """
    Get aggregated dataset annotation metrics along with status for each video.
    """
    logger.info("Received request to retrieve global dataset status")
    result = video_service.get_dataset_status()
    return result


@router.get("/annotations/{video_id}/{frame_name}", response_model=SaveAnnotationsRequest)
async def get_annotations(video_id: str, frame_name: str):
    """
    Get saved object detection annotations for a specific frame image.
    """
    logger.info(f"Received request to get annotations for video_id: '{video_id}', frame: '{frame_name}'")
    result = video_service.get_annotations_for_frame(video_id, frame_name)
    return {"annotations": result}


@router.delete("/videos/{video_id}/video-only")
def delete_uploaded_video_only(video_id: str):
    """
    Deletes only the source uploaded video file for video_id.
    Preserves extracted frames, annotations, and labels.
    """
    logger.info(f"Received request to delete source video file for video_id: '{video_id}'")
    result = video_service.delete_uploaded_video_only(video_id)
    return result


@router.delete("/videos/{video_id}/complete-dataset")
def delete_complete_dataset(video_id: str):
    """
    Permanently deletes the entire dataset directory for video_id.
    """
    logger.info(f"Received request to delete complete dataset for video_id: '{video_id}'")
    result = video_service.delete_complete_dataset(video_id)
    return result


@router.post("/reset-annotations/{video_id}")
def reset_annotations(video_id: str):
    """
    Completely clears all annotations, YOLO label files, and tracking metadata for video_id.
    Preserves all extracted JPEG frame images and video files.
    """
    logger.info(f"Received request to reset annotations for video_id: '{video_id}'")
    result = video_service.reset_dataset_annotations(video_id)
    return result


@router.post("/videos/{video_id}/frames/{frame_name}/skip")
def skip_frame(video_id: str, frame_name: str):
    """
    Marks a specific frame as skipped, excluding it from AI training.
    """
    logger.info(f"Received request to skip frame: '{frame_name}' for video_id: '{video_id}'")
    result = video_service.skip_frame(video_id, frame_name)
    return result


@router.post("/videos/{video_id}/frames/{frame_name}/restore")
def restore_frame(video_id: str, frame_name: str):
    """
    Restores a skipped frame back to the active annotation workflow.
    """
    logger.info(f"Received request to restore frame: '{frame_name}' for video_id: '{video_id}'")
    result = video_service.restore_frame(video_id, frame_name)
    return result


@router.post("/videos/{video_id}/skip-range")
def skip_frame_range(video_id: str, request: SkipRangeRequest):
    """
    Marks a range of frames (from start_frame to end_frame inclusive) as skipped.
    Excludes all specified frames from AI training while preserving images.
    """
    logger.info(f"Received request to skip frame range: '{request.start_frame}' to '{request.end_frame}' for video_id: '{video_id}'")
    result = video_service.skip_frame_range(video_id, request.start_frame, request.end_frame)
    return result






# Route moved above wildcard to prevent collision

