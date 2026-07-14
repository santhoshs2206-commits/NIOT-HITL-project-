import logging
from fastapi import APIRouter, UploadFile, File, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.services import video_service

logger = logging.getLogger("underwater-hitl-backend.videos_router")

router = APIRouter(
    tags=["Videos"]
)

class VideoUploadResponse(BaseModel):
    video_id: str
    filename: str
    status: str

class FrameExtractionResponse(BaseModel):
    video_id: str
    frames_extracted: int
    frame_width: int
    frame_height: int
    status: str

class FrameInfo(BaseModel):
    name: str
    annotated: bool

class FramesListResponse(BaseModel):
    video_id: str
    total_frames: int
    frames: list[FrameInfo]

class AnnotationItem(BaseModel):
    label: str
    bbox: list[float]  # [xmin, ymin, xmax, ymax]

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
    annotated_frames: int
    completion_rate: float
    status: str

class DatasetStatusResponse(BaseModel):
    total_videos: int
    total_frames: int
    annotated_frames: int
    remaining_frames: int
    overall_completion_rate: float
    videos: list[VideoStatusItem]


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
async def extract_frames(video_id: str):
    """
    Extract frames from the uploaded video file.
    Locates the video file inside the storage folder for the given video_id,
    extracts all individual frames as JPEG files, clears old frames if any exist,
    updates metadata.json, and returns frame details.
    """
    logger.info(f"Received frame extraction request for video_id: '{video_id}'")
    result = video_service.extract_frames_for_video(video_id)
    return result

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

