import os
import re
import json
import shutil
import logging
import time
from pathlib import Path
import numpy as np
import cv2
from fastapi import UploadFile, HTTPException, status
from app.config import STORAGE_DIR, CLASSES_FILE, PROFILE_CONFIGS, EMERGENCY_MAX_GAP
from app.services.keyframe_selector import HybridAdaptiveKeyFrameSelector

logger = logging.getLogger("underwater-hitl-backend.video_service")

# Global tracker for real-time video extraction progress per video_id
EXTRACTION_PROGRESS: dict[str, dict] = {}

# Allowed video extensions and MIME types
ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
ALLOWED_MIME_TYPES = {
    "video/mp4",
    "video/x-msvideo",  # avi
    "video/quicktime",  # mov
    "video/x-matroska",  # mkv
    "video/webm"
}

ALLOWED_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png"
}

def generate_next_video_id() -> str:
    """
    Scans the storage directory to find the next sequential video_id.
    Matches folder names of the format 'vid_XXX' where XXX is a zero-padded integer.
    """
    max_id = 0
    pattern = re.compile(r"^vid_(\d+)$")
    
    if STORAGE_DIR.exists():
        for item in STORAGE_DIR.iterdir():
            if item.is_dir():
                match = pattern.match(item.name)
                if match:
                    val = int(match.group(1))
                    if val > max_id:
                        max_id = val
                        
    next_id = max_id + 1
    return f"vid_{next_id:03d}"

def validate_video_file(file: UploadFile):
    """
    Validates that the uploaded file is a supported video format.
    Raises HTTPException 400 if validation fails.
    """
    filename = file.filename or ""
    file_ext = Path(filename).suffix.lower()
    
    # Check extension
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file extension '{file_ext}'. Allowed extensions: {', '.join(ALLOWED_EXTENSIONS)}"
        )
        
    # Check MIME content type if available
    if file.content_type and file.content_type not in ALLOWED_MIME_TYPES:
        # Note: sometimes OS/browsers send generic octet-stream, so we prioritize extension but check mime as secondary.
        logger.warning(f"File uploaded with non-standard MIME type: {file.content_type}. Proceeding due to valid extension.")

def save_uploaded_video(file: UploadFile) -> dict:
    """
    Validates the file, generates a unique video_id, sets up the storage directory structure,
    saves the video file, and writes the initial metadata.json.
    """
    # 1. Validate
    validate_video_file(file)
    
    # 2. Generate video_id
    video_id = generate_next_video_id()
    logger.info(f"Generating video ID '{video_id}' for file: '{file.filename}'")
    
    # 3. Create folders
    video_dir = STORAGE_DIR / video_id
    images_dir = video_dir / "images"
    labels_dir = video_dir / "labels"
    
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)
    
    # 4. Save video file
    file_ext = Path(file.filename or "video.mp4").suffix.lower()
    video_filename = f"video{file_ext}"
    video_path = video_dir / video_filename
    
    try:
        with open(video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        logger.info(f"Successfully saved video file to {video_path}")
    except Exception as e:
        logger.error(f"Failed to save uploaded video file: {e}")
        # Clean up directory if save fails
        if video_dir.exists():
            shutil.rmtree(video_dir)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save video file on server."
        )
        
    # 5. Initialize metadata.json
    metadata = {
        "video_id": video_id,
        "filename": file.filename,
        "total_frames": 0,
        "annotated_frames": 0,
        "status": "uploaded"
    }
    
    metadata_path = video_dir / "metadata.json"
    try:
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)
        logger.info(f"Initialized metadata.json at {metadata_path}")
    except Exception as e:
        logger.error(f"Failed to create metadata.json: {e}")
        if video_dir.exists():
            shutil.rmtree(video_dir)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initialize video metadata."
        )
        
    return {
        "video_id": video_id,
        "filename": file.filename,
        "status": "uploaded"
    }

def get_extraction_progress(video_id: str) -> dict:
    """
    Returns real-time or cached extraction progress for a specific video_id.
    """
    if video_id in EXTRACTION_PROGRESS:
        return EXTRACTION_PROGRESS[video_id]

    video_dir = STORAGE_DIR / video_id
    metadata_path = video_dir / "metadata.json"
    if metadata_path.exists():
        try:
            with open(metadata_path, "r") as f:
                meta = json.load(f)
            if meta.get("status") == "extracted" or meta.get("total_frames", 0) > 0:
                summary = meta.get("extraction_summary", {})
                total_frames = meta.get("original_total_frames", meta.get("total_frames", 0))
                extracted = meta.get("total_frames", 0)
                images_dir = video_dir / "images"
                recent_frames = []
                if images_dir.exists():
                    all_imgs = sorted([p.name for p in images_dir.glob("*.jpg")])
                    recent_frames = all_imgs[-8:] if all_imgs else []

                return {
                    "video_id": video_id,
                    "status": "completed",
                    "stage": "Dataset Ready",
                    "frames_processed": total_frames,
                    "total_video_frames": total_frames,
                    "frames_extracted": extracted,
                    "frames_ignored": max(0, total_frames - extracted),
                    "progress_percent": 100.0,
                    "current_fps": 0,
                    "eta_seconds": 0,
                    "current_frame_filename": recent_frames[-1] if recent_frames else "",
                    "latest_extracted_frames": recent_frames,
                    "frame_width": meta.get("frame_width", 1920),
                    "frame_height": meta.get("frame_height", 1080),
                    "video_fps": summary.get("original_fps", 30),
                    "video_duration_s": summary.get("original_duration_s", 0),
                    "reduction_ratio": summary.get("reduction_ratio", round(total_frames / max(1, extracted), 2))
                }
        except Exception:
            pass

    return {
        "video_id": video_id,
        "status": "idle",
        "stage": "Idle",
        "frames_processed": 0,
        "total_video_frames": 0,
        "frames_extracted": 0,
        "frames_ignored": 0,
        "progress_percent": 0.0,
        "current_fps": 0,
        "eta_seconds": 0,
        "current_frame_filename": "",
        "latest_extracted_frames": [],
        "frame_width": 0,
        "frame_height": 0,
        "video_fps": 0,
        "video_duration_s": 0,
        "reduction_ratio": 1.0
    }

def extract_frames_for_video(video_id: str, motion_profile: str = "Moderate") -> dict:
    """
    Extracts key frames from the uploaded video using the Hybrid Adaptive Key Frame Selection algorithm.
    Saves them as frame0001.jpg, frame0002.jpg, etc. under storage/<video_id>/images/
    Updates metadata.json with rich statistics.
    """
    if motion_profile not in PROFILE_CONFIGS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported motion profile '{motion_profile}'. Allowed profiles: {', '.join(PROFILE_CONFIGS.keys())}"
        )
    profile_cfg = PROFILE_CONFIGS[motion_profile]
    composite_threshold = profile_cfg["composite_threshold"]
    weights = profile_cfg["weights"]

    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    # Search for video file (video.*)
    video_path = None
    for ext in ALLOWED_EXTENSIONS:
        candidate = video_dir / f"video{ext}"
        if candidate.exists() and candidate.is_file():
            video_path = candidate
            break

    if not video_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video file is missing in the storage folder for video ID '{video_id}'."
        )

    # Clean up old images if directory already exists
    images_dir = video_dir / "images"
    if images_dir.exists():
        logger.info(f"Cleaning up existing images directory: {images_dir}")
        shutil.rmtree(images_dir)
    os.makedirs(images_dir, exist_ok=True)

    # Clean up old labels as extraction is run again
    labels_dir = video_dir / "labels"
    if labels_dir.exists():
        logger.info(f"Cleaning up existing labels directory: {labels_dir}")
        shutil.rmtree(labels_dir)
    os.makedirs(labels_dir, exist_ok=True)

    # Initialize OpenCV capture
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logger.error(f"Failed to open video file: {video_path}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The video file is invalid, corrupt, or cannot be opened."
        )

    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_duration_s = total_video_frames / fps if fps > 0 else 0.0

    # Initialize global progress state
    EXTRACTION_PROGRESS[video_id] = {
        "video_id": video_id,
        "status": "reading_video",
        "stage": "Reading Video",
        "frames_processed": 0,
        "total_video_frames": total_video_frames,
        "frames_extracted": 0,
        "frames_ignored": 0,
        "progress_percent": 0.0,
        "current_fps": 0,
        "eta_seconds": 0,
        "current_frame_filename": "",
        "latest_extracted_frames": [],
        "frame_width": frame_width,
        "frame_height": frame_height,
        "video_fps": round(fps, 2),
        "video_duration_s": round(video_duration_s, 2),
        "reduction_ratio": 1.0
    }

    selector = HybridAdaptiveKeyFrameSelector(
        composite_threshold=composite_threshold,
        weights=weights,
        emergency_max_gap=EMERGENCY_MAX_GAP
    )

    frames_processed = 0
    frames_extracted = 0
    keyframe_indices = []
    
    start_time = time.time()

    try:
        success, current_frame = cap.read()
        EXTRACTION_PROGRESS[video_id]["status"] = "extracting"
        EXTRACTION_PROGRESS[video_id]["stage"] = "Extracting Frames"

        while success:
            frames_processed += 1
            
            # Read ahead to check if the NEXT frame is valid (to detect last frame)
            next_success, next_frame = cap.read()
            is_last_frame = not next_success
            
            should_save, reason, metrics = selector.should_extract(
                frame_idx=frames_processed,
                frame=current_frame,
                is_last_frame=is_last_frame
            )
            
            saved_name = ""
            if should_save:
                frames_extracted += 1
                frame_filename = f"frame{frames_extracted:04d}.jpg"
                saved_name = frame_filename
                frame_path = images_dir / frame_filename
                
                if frame_width == 0 or frame_height == 0:
                    frame_height, frame_width, _ = current_frame.shape
                    
                success_write = cv2.imwrite(str(frame_path), current_frame)
                if not success_write:
                    logger.error(f"Failed to write frame to {frame_path}")
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=f"Failed to save extracted keyframe {frames_extracted}."
                    )
                keyframe_indices.append(frames_processed)

                recent = EXTRACTION_PROGRESS[video_id].get("latest_extracted_frames", [])
                recent.append(frame_filename)
                if len(recent) > 8:
                    recent = recent[-8:]
                EXTRACTION_PROGRESS[video_id]["latest_extracted_frames"] = recent

            # Update progress metrics every frame (or at least calculate speed & ETA)
            elapsed = time.time() - start_time
            current_fps = round(frames_processed / elapsed, 1) if elapsed > 0 else 0
            remaining_frames = max(0, total_video_frames - frames_processed)
            eta_s = int(remaining_frames / current_fps) if current_fps > 0 else 0
            pct = round((frames_processed / max(1, total_video_frames)) * 100, 1)
            reduction = round(frames_processed / max(1, frames_extracted), 2)

            EXTRACTION_PROGRESS[video_id].update({
                "frames_processed": frames_processed,
                "frames_extracted": frames_extracted,
                "frames_ignored": max(0, frames_processed - frames_extracted),
                "progress_percent": min(99.0, pct),
                "current_fps": current_fps,
                "eta_seconds": eta_s,
                "reduction_ratio": reduction,
                "current_frame_filename": saved_name if saved_name else f"frame_idx_{frames_processed}"
            })
            
            success = next_success
            current_frame = next_frame

    except HTTPException:
        EXTRACTION_PROGRESS[video_id]["status"] = "error"
        EXTRACTION_PROGRESS[video_id]["stage"] = "Error"
        raise
    except Exception as e:
        EXTRACTION_PROGRESS[video_id]["status"] = "error"
        EXTRACTION_PROGRESS[video_id]["stage"] = "Error"
        logger.exception(f"Unexpected error during frame extraction: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error during frame extraction: {str(e)}"
        )
    finally:
        cap.release()
        cv2.destroyAllWindows()

    if frames_extracted == 0:
        EXTRACTION_PROGRESS[video_id]["status"] = "error"
        EXTRACTION_PROGRESS[video_id]["stage"] = "Error"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No keyframes could be extracted from the video file."
        )

    # Transition to metadata generation stage
    EXTRACTION_PROGRESS[video_id]["status"] = "generating_metadata"
    EXTRACTION_PROGRESS[video_id]["stage"] = "Generating Metadata"
    EXTRACTION_PROGRESS[video_id]["progress_percent"] = 99.5

    end_time = time.time()
    extraction_time_s = end_time - start_time
    video_duration_s = total_video_frames / fps if fps > 0 else (frames_processed / 10.0)
    reduction_ratio = round(frames_processed / frames_extracted, 2) if frames_extracted > 0 else 1.0
    selector_stats = selector.get_summary_statistics()

    extraction_summary = {
        "extraction_time_s": round(extraction_time_s, 2),
        "average_composite_score": round(selector_stats["average_composite_score"], 4),
        "pixel_diff_avg": round(selector_stats["pixel_diff_avg"], 4),
        "hist_diff_avg": round(selector_stats["hist_diff_avg"], 4),
        "ssim_diff_avg": round(selector_stats["ssim_diff_avg"], 4),
        "trigger_reasons": selector_stats["trigger_reasons"],
        "original_fps": round(fps, 2),
        "original_duration_s": round(video_duration_s, 2),
        "reduction_ratio": reduction_ratio
    }

    # Update metadata.json
    metadata_path = video_dir / "metadata.json"
    if metadata_path.exists():
        try:
            with open(metadata_path, "r") as f:
                metadata = json.load(f)
        except Exception as e:
            logger.warning(f"Could not read metadata.json to update: {e}. Reinitializing.")
            metadata = {
                "video_id": video_id,
                "filename": video_path.name
            }
    else:
        metadata = {
            "video_id": video_id,
            "filename": video_path.name
        }

    metadata.update({
        "total_frames": frames_extracted,
        "original_total_frames": frames_processed,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "status": "extracted",
        "motion_profile": motion_profile,
        "reduction_ratio": reduction_ratio,
        "extraction_summary": extraction_summary
    })

    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)

    # Complete progress state
    EXTRACTION_PROGRESS[video_id].update({
        "status": "completed",
        "stage": "Dataset Ready",
        "frames_processed": frames_processed,
        "total_video_frames": frames_processed,
        "frames_extracted": frames_extracted,
        "frames_ignored": max(0, frames_processed - frames_extracted),
        "progress_percent": 100.0,
        "current_fps": 0,
        "eta_seconds": 0,
        "reduction_ratio": reduction_ratio
    })

    metadata["total_frames"] = frames_extracted
    metadata["original_total_frames"] = frames_processed
    metadata["annotated_frames"] = 0
    metadata["frame_width"] = frame_width
    metadata["frame_height"] = frame_height
    metadata["status"] = "annotating"
    metadata["motion_profile"] = motion_profile
    metadata["keyframe_indices"] = keyframe_indices
    metadata["reduction_ratio"] = reduction_ratio
    metadata["extraction_summary"] = extraction_summary

    try:
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)
        logger.info(f"Updated metadata.json for {video_id} with {frames_extracted} keyframes from {frames_processed} total frames.")
    except Exception as e:
        logger.error(f"Failed to update metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update video metadata after extraction."
        )

    return {
        "video_id": video_id,
        "frames_extracted": frames_extracted,
        "original_total_frames": frames_processed,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "status": "annotating",
        "motion_profile": motion_profile,
        "reduction_ratio": reduction_ratio,
        "extraction_summary": extraction_summary
    }

def get_frames_for_video(video_id: str) -> dict:
    """
    Retrieves all extracted frames for the given video_id.
    Reads total_frames from metadata.json.
    Checks the labels folder to determine the annotation status (annotated = true if label file exists).
    Returns frames sorted in numeric order.
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    metadata_path = video_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Metadata is missing for video ID '{video_id}'. Frames may not be extracted yet."
        )

    try:
        with open(metadata_path, "r") as f:
            metadata = json.load(f)
    except Exception as e:
        logger.error(f"Failed to read metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read video metadata."
        )

    # Check status. If still uploaded, frames are not extracted.
    if metadata.get("status") == "uploaded":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Frames have not been extracted for this video. Please extract frames first."
        )

    images_dir = video_dir / "images"
    if not images_dir.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Images directory not found. Frames may have been deleted or not extracted."
        )

    # Get list of images
    try:
        image_files = [
            f for f in os.listdir(images_dir)
            if f.lower().endswith(".jpg") or f.lower().endswith(".jpeg")
        ]
    except Exception as e:
        logger.error(f"Failed to list frames inside images directory: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list frame images."
        )

    # Numerical sorting (e.g. frame0001.jpg -> 1)
    def get_frame_num(filename: str) -> int:
        match = re.search(r'\d+', filename)
        return int(match.group()) if match else 999999

    image_files.sort(key=get_frame_num)

    skipped_frames_set = set(metadata.get("skipped_frames", []))
    labels_dir = video_dir / "labels"
    frames_list = []
    
    for filename in image_files:
        # Check if corresponding label file exists
        frame_name_no_ext = Path(filename).stem
        label_file = labels_dir / f"{frame_name_no_ext}.txt"
        annotated = label_file.exists() and label_file.is_file()
        is_skipped = filename in skipped_frames_set
        
        frames_list.append({
            "name": filename,
            "annotated": annotated,
            "skipped": is_skipped
        })

    return {
        "video_id": video_id,
        "total_frames": metadata.get("total_frames", len(frames_list)),
        "frames": frames_list
    }

def get_frame_path(video_id: str, frame_name: str) -> Path:
    """
    Returns the file path of a specific extracted frame.
    Validates that the video ID and the frame file exist,
    sanitizes frame_name to prevent directory traversal,
    and validates that the file extension is allowed.
    """
    # Sanitize the frame name to prevent path traversal
    safe_frame_name = Path(frame_name).name
    
    # Get the file extension
    ext = Path(safe_frame_name).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image type."
        )

    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    frame_path = video_dir / "images" / safe_frame_name

    if not frame_path.exists() or not frame_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Frame '{frame_name}' not found for video ID '{video_id}'."
        )

    return frame_path

def get_or_create_class_id(label: str) -> int:
    """
    Looks up the lowercase label in CLASSES_FILE.
    If it exists, returns the class ID.
    If it does not exist, assigns the next sequential class ID,
    saves the updated classes map to disk, and returns the new ID.
    """
    classes = {}
    if CLASSES_FILE.exists():
        try:
            with open(CLASSES_FILE, "r") as f:
                classes = json.load(f)
        except Exception as e:
            logger.error(f"Failed to read CLASSES_FILE: {e}. Starting fresh.")
            classes = {}

    lower_label = label.strip().lower()
    if lower_label in classes:
        return classes[lower_label]

    # Assign next available ID
    next_id = max(classes.values()) + 1 if classes else 0
    classes[lower_label] = next_id

    try:
        os.makedirs(CLASSES_FILE.parent, exist_ok=True)
        with open(CLASSES_FILE, "w") as f:
            json.dump(classes, f, indent=2)
        logger.info(f"Assigned new class ID {next_id} to label '{lower_label}'")
    except Exception as e:
        logger.error(f"Failed to write to CLASSES_FILE: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update classes.json."
        )
        
    return next_id

def get_annotations_metadata_path(video_id: str) -> Path:
    return STORAGE_DIR / video_id / "annotations_metadata.json"

def get_annotations_metadata(video_id: str) -> dict:
    metadata_path = get_annotations_metadata_path(video_id)
    if metadata_path.exists():
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read annotations_metadata.json for {video_id}: {e}")
            
    return {
        "video_id": video_id,
        "propagation_sessions": [],
        "events": [],
        "frames": {}
    }

def save_annotations_metadata(video_id: str, data: dict):
    metadata_path = get_annotations_metadata_path(video_id)
    try:
        os.makedirs(metadata_path.parent, exist_ok=True)
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save annotations_metadata.json for {video_id}: {e}")

def save_annotations_for_frame(video_id: str, frame_name: str, annotations: list[dict]) -> dict:
    """
    Saves annotations for a specific frame in YOLO format.
    Validates existence of the video directory and the frame file.
    Converts coordinates from pixel space [xmin, ymin, xmax, ymax] to normalized YOLO space.
    Saves to storage/<video_id>/labels/<frame_name_no_ext>.txt.
    Recalculates annotated_frames and updates metadata.json and annotations_metadata.json.
    """
    # 1. Validate video directory
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    # 2. Validate frame existence
    get_frame_path(video_id, frame_name)

    # 3. Read metadata.json to get width and height
    metadata_path = video_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="metadata.json is missing for this video."
        )

    try:
        with open(metadata_path, "r") as f:
            metadata = json.load(f)
    except Exception as e:
        logger.error(f"Failed to read metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read video metadata."
        )

    frame_width = metadata.get("frame_width")
    frame_height = metadata.get("frame_height")

    if not frame_width or not frame_height:
        logger.error(f"Frame dimensions missing in metadata for {video_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Frame dimensions are missing in metadata. Please re-run frame extraction."
        )

    safe_frame_name = Path(frame_name).name
    frame_name_no_ext = Path(safe_frame_name).stem
    labels_dir = video_dir / "labels"
    label_file_path = labels_dir / f"{frame_name_no_ext}.txt"

    # 4. Handle annotations saving or deletion
    meta_data = get_annotations_metadata(video_id)
    
    if not annotations:
        # Delete label file if it exists
        if label_file_path.exists():
            try:
                os.remove(label_file_path)
                logger.info(f"Deleted label file: {label_file_path} because annotations are empty.")
            except Exception as e:
                logger.error(f"Failed to delete label file {label_file_path}: {e}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to clean up label file."
                )
        if "frames" in meta_data and frame_name in meta_data["frames"]:
            meta_data["frames"].pop(frame_name, None)
    else:
        # Ensure labels directory exists
        os.makedirs(labels_dir, exist_ok=True)
        
        yolo_lines = []
        rich_anns = []
        import uuid
        
        for ann in annotations:
            label = ann.get("label")
            bbox = ann.get("bbox")  # [xmin, ymin, xmax, ymax]
            
            if not label or not bbox or len(bbox) != 4:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid annotation format. Each item must contain 'label' and 'bbox': [xmin, ymin, xmax, ymax]."
                )
                
            xmin, ymin, xmax, ymax = bbox
            
            # Reject zero-size or negative size bounding boxes
            if xmax <= xmin or ymax <= ymin:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Bounding boxes must have positive width and height."
                )

            # Validate that bounding box is completely inside image boundaries
            if xmin < 0 or ymin < 0 or xmax > frame_width or ymax > frame_height:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Bounding box coordinates must lie within the image boundaries."
                )

            # Get class ID dynamically
            class_id = get_or_create_class_id(label)

            # Calculate normalized YOLO coordinates:
            x_center = (xmin + xmax) / 2.0 / frame_width
            y_center = (ymin + ymax) / 2.0 / frame_height
            w = (xmax - xmin) / frame_width
            h = (ymax - ymin) / frame_height

            # Format to 6 decimal places
            yolo_lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {w:.6f} {h:.6f}")
            
            # Build rich annotation item
            rich_ann = {
                "id": ann.get("id") or f"ann_{uuid.uuid4().hex[:8]}",
                "tracking_id": ann.get("tracking_id"),
                "label": label,
                "bbox": [int(xmin), int(ymin), int(xmax), int(ymax)],
                "source": ann.get("source") or "manual",
                "created_by": ann.get("created_by") or "user",
                "tracker": ann.get("tracker"),
                "tracker_version": ann.get("tracker_version"),
                "propagation_state": ann.get("propagation_state") or "manual",
                "confidence": ann.get("confidence"),
                "tracking_history": ann.get("tracking_history") or []
            }
            rich_anns.append(rich_ann)

        # Overwrite label file
        try:
            with open(label_file_path, "w") as f:
                f.write("\n".join(yolo_lines) + "\n")
            logger.info(f"Saved {len(yolo_lines)} annotations to {label_file_path}")
        except Exception as e:
            logger.error(f"Failed to write label file {label_file_path}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save annotations to disk."
            )
            
        # Update rich annotations metadata
        if "frames" not in meta_data:
            meta_data["frames"] = {}
        meta_data["frames"][frame_name] = rich_anns

    # Save metadata JSON file
    save_annotations_metadata(video_id, meta_data)

    # 5. Update metadata.json count of annotated frames
    annotated_frames = 0
    if labels_dir.exists():
        try:
            annotated_frames = len([
                f for f in os.listdir(labels_dir)
                if f.lower().endswith(".txt") and os.path.isfile(labels_dir / f)
            ])
        except Exception as e:
            logger.error(f"Failed to count labels files: {e}")
            annotated_frames = metadata.get("annotated_frames", 0)

    total_frames = metadata.get("total_frames", 0)
    metadata["annotated_frames"] = annotated_frames
    skipped_count = len(metadata.get("skipped_frames", []))
    effective_total = max(0, total_frames - skipped_count)

    if (effective_total > 0 and annotated_frames >= effective_total) or (effective_total == 0 and total_frames > 0):
        metadata["status"] = "completed"
    elif metadata.get("status") == "completed" and annotated_frames < effective_total:
        metadata["status"] = "annotating"

    try:
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)
        logger.info(f"Updated metadata.json for {video_id} with annotated_frames={annotated_frames}, status={metadata['status']}")
    except Exception as e:
        logger.error(f"Failed to write metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update video metadata."
        )

    return {
        "video_id": video_id,
        "frame_name": safe_frame_name,
        "annotated_frames": annotated_frames,
        "status": metadata["status"]
    }

def update_single_annotation(video_id: str, frame_name: str, annotation_id: str, updated_data: dict) -> dict:
    """
    Updates or inserts a specific annotation identified by annotation_id on a frame.
    """
    existing_anns = get_annotations_for_frame(video_id, frame_name)
    updated_list = []
    found = False

    for ann in existing_anns:
        ann_dict = ann if isinstance(ann, dict) else ann.dict() if hasattr(ann, 'dict') else dict(ann)
        if ann_dict.get("id") == annotation_id:
            ann_dict.update(updated_data)
            ann_dict["id"] = annotation_id
            found = True
        updated_list.append(ann_dict)

    if not found:
        new_ann = dict(updated_data)
        new_ann["id"] = annotation_id
        updated_list.append(new_ann)

    return save_annotations_for_frame(video_id, frame_name, updated_list)

def get_all_classes() -> list[str]:
    """
    Reads storage/classes.json and returns a sorted list of all unique class label strings.
    If classes.json does not exist, returns [].
    If classes.json exists but is unreadable/corrupt, logs error and raises HTTP 500 error.
    """
    if not CLASSES_FILE.exists():
        return []

    try:
        with open(CLASSES_FILE, "r") as f:
            classes = json.load(f)
    except Exception as e:
        logger.exception(f"Failed to read CLASSES_FILE: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read classes.json."
        )

    # Normalize labels: strip leading/trailing whitespace
    labels = [label.strip() for label in classes.keys()]
    return sorted(labels)

def get_dataset_status() -> dict:
    """
    Scans the storage directory, reads the metadata for each valid video,
    and aggregates overall dataset statistics.
    Skip directories that lack metadata.json or have corrupt JSON files.
    """
    total_videos = 0
    total_frames = 0
    skipped_frames = 0
    effective_total_frames = 0
    annotated_frames = 0
    
    videos_list = []
    
    if STORAGE_DIR.exists():
        pattern = re.compile(r"^vid_(\d+)$")
        for item in STORAGE_DIR.iterdir():
            if not item.is_dir():
                continue
                
            if not pattern.match(item.name):
                continue
                
            metadata_path = item / "metadata.json"
            if not metadata_path.exists() or not metadata_path.is_file():
                logger.warning(f"Skipping '{item.name}' because metadata.json is missing.")
                continue
            
            try:
                with open(metadata_path, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
            except Exception as e:
                logger.warning(f"Skipping '{item.name}' because metadata.json is corrupted.")
                continue

            # Check for required fields in metadata
            video_id = metadata.get("video_id")
            filename = metadata.get("filename")
            v_total_frames = metadata.get("total_frames", 0)
            v_annotated_frames = metadata.get("annotated_frames", 0)
            v_skipped_frames = len(metadata.get("skipped_frames", []))
            v_effective_total_frames = max(0, v_total_frames - v_skipped_frames)
            status_str = metadata.get("status", "uploaded")
            
            if not video_id:
                video_id = item.name
            
            if filename is None:
                filename = "unknown"
            
            # Calculate completion rate for this video using effective_total_frames
            if v_effective_total_frames > 0:
                v_completion_rate = min(100.0, round((v_annotated_frames / v_effective_total_frames) * 100, 2))
            else:
                v_completion_rate = 100.0 if v_total_frames > 0 else 0.0

            # If completion rate is 100% and not extracting, status should reflect completed
            if v_completion_rate >= 100.0 and status_str not in ["uploaded", "extracting"]:
                status_str = "completed"
                
            # Add new fields for rich frontend synchronization
            v_original_total_frames = metadata.get("original_total_frames", v_total_frames)
            v_motion_profile = metadata.get("motion_profile", "N/A")
            v_reduction_ratio = metadata.get("reduction_ratio", 1.0)
            v_extraction_summary = metadata.get("extraction_summary", None)
            
            # Check if source video file is present or deleted
            video_files = [f for f in item.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS]
            v_video_deleted = metadata.get("video_deleted", False) or (len(video_files) == 0)

            videos_list.append({
                "video_id": video_id,
                "filename": filename,
                "total_frames": v_total_frames,
                "skipped_frames": v_skipped_frames,
                "effective_total_frames": v_effective_total_frames,
                "original_total_frames": v_original_total_frames,
                "annotated_frames": v_annotated_frames,
                "completion_rate": v_completion_rate,
                "status": status_str,
                "motion_profile": v_motion_profile,
                "reduction_ratio": v_reduction_ratio,
                "extraction_summary": v_extraction_summary,
                "video_deleted": v_video_deleted
            })
            
            # Add to aggregates
            total_videos += 1
            total_frames += v_total_frames
            skipped_frames += v_skipped_frames
            effective_total_frames += v_effective_total_frames
            annotated_frames += v_annotated_frames

    # Sort videos list by video_id
    videos_list.sort(key=lambda x: x["video_id"])
    
    # Calculate overall metrics using effective_total_frames
    remaining_frames = max(0, effective_total_frames - annotated_frames)
    if effective_total_frames > 0:
        overall_completion_rate = min(100.0, round((annotated_frames / effective_total_frames) * 100, 2))
    else:
        overall_completion_rate = 100.0 if total_frames > 0 else 0.0
        
    return {
        "total_videos": total_videos,
        "total_frames": total_frames,
        "skipped_frames": skipped_frames,
        "effective_total_frames": effective_total_frames,
        "annotated_frames": annotated_frames,
        "remaining_frames": remaining_frames,
        "overall_completion_rate": overall_completion_rate,
        "videos": videos_list
    }

def get_annotations_for_frame(video_id: str, frame_name: str) -> list[dict]:
    """
    Retrieves annotations for a specific frame.
    Attempts to read rich metadata from annotations_metadata.json first.
    If not present or frame not in metadata, falls back to reading YOLO format from
    storage/<video_id>/labels/<frame_name_no_ext>.txt and converting to pixel space.
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    # 1. Try reading from annotations_metadata.json first to preserve rich metadata
    try:
        meta_data = get_annotations_metadata(video_id)
        if "frames" in meta_data and frame_name in meta_data["frames"]:
            return meta_data["frames"][frame_name]
    except Exception as e:
        logger.warning(f"Failed to read rich annotations metadata for {video_id}: {e}")


    # 1. Read metadata.json to get width and height
    metadata_path = video_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="metadata.json is missing for this video."
        )

    try:
        with open(metadata_path, "r") as f:
            metadata = json.load(f)
    except Exception as e:
        logger.error(f"Failed to read metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read video metadata."
        )

    frame_width = metadata.get("frame_width")
    frame_height = metadata.get("frame_height")

    if not frame_width or not frame_height:
        return []

    # 2. Read label file
    safe_frame_name = Path(frame_name).name
    frame_name_no_ext = Path(safe_frame_name).stem
    labels_dir = video_dir / "labels"
    label_file_path = labels_dir / f"{frame_name_no_ext}.txt"

    if not label_file_path.exists() or not label_file_path.is_file():
        return []

    # 3. Read classes map to resolve labels
    classes = {}
    if CLASSES_FILE.exists():
        try:
            with open(CLASSES_FILE, "r") as f:
                classes = json.load(f)
        except Exception as e:
            logger.error(f"Failed to read CLASSES_FILE: {e}")

    # Reverse classes dictionary: class_id -> label
    id_to_label = {v: k for k, v in classes.items()}

    annotations = []
    try:
        with open(label_file_path, "r") as f:
            lines = f.readlines()
            
        for line in lines:
            parts = line.strip().split()
            if len(parts) != 5:
                continue
                
            class_id_str, x_center_str, y_center_str, w_str, h_str = parts
            class_id = int(class_id_str)
            x_center = float(x_center_str)
            y_center = float(y_center_str)
            w = float(w_str)
            h = float(h_str)

            # Convert normalized coordinates to absolute pixels
            xmin = int(round((x_center - w / 2.0) * frame_width))
            ymin = int(round((y_center - h / 2.0) * frame_height))
            xmax = int(round((x_center + w / 2.0) * frame_width))
            ymax = int(round((y_center + h / 2.0) * frame_height))

            # Retrieve label name matching class_id
            raw_label = id_to_label.get(class_id, "unknown")
            # Capitalize first letter cleanly
            label = raw_label[0].upper() + raw_label[1:] if raw_label else "Unknown"

            annotations.append({
                "label": label,
                "bbox": [xmin, ymin, xmax, ymax]
            })
            
    except Exception as e:
        logger.error(f"Failed to parse label file {label_file_path}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read annotations from disk."
        )

    return annotations


def calculate_iou(boxA: list[int] | list[float], boxB: list[int] | list[float]) -> float:
    """
    Calculates Intersection over Union (IoU) between two bounding boxes [xmin, ymin, xmax, ymax].
    """
    if len(boxA) != 4 or len(boxB) != 4:
        return 0.0
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    
    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    
    unionArea = float(boxAArea + boxBArea - interArea)
    if unionArea == 0:
        return 0.0
    return interArea / unionArea


def run_yolo_fallback(frame: np.ndarray, label: str, last_bbox: list[int], video_id: str) -> list[int] | None:
    """
    Attempts to run YOLO fallback on a frame.
    Looks for a detection of class `label` that overlaps with `last_bbox` above the TRACKING_IOU_THRESHOLD.
    """
    from app.config import TRACKING_IOU_THRESHOLD
    
    # Check potential model weights locations:
    # 1. Staged model weights in storage/vid_XXX/weights/best.pt
    # 2. General model weights in storage/yolo_model.pt
    # 3. Fallback to default pretrained yolov8n.pt
    model_paths = [
        STORAGE_DIR / video_id / "weights" / "best.pt",
        STORAGE_DIR / "yolo_model.pt",
        STORAGE_DIR / "best.pt",
        "yolov8n.pt"
    ]
    
    model_path = None
    for path in model_paths:
        if isinstance(path, Path):
            if path.exists():
                model_path = str(path)
                break
        elif isinstance(path, str):
            model_path = path
            break
            
    if not model_path:
        logger.warning("No YOLO weights found. Skipping fallback.")
        return None
        
    try:
        from ultralytics import YOLO
        logger.info(f"Running YOLO fallback using model weights: {model_path}")
        model = YOLO(model_path)
        
        # Infer on the frame
        results = model(frame, conf=0.25, verbose=False)
        if not results or len(results) == 0:
            return None
            
        # Look up class mapping
        classes = {}
        if CLASSES_FILE.exists():
            with open(CLASSES_FILE, "r") as f:
                classes = json.load(f)
                
        target_class_id = classes.get(label.strip().lower())
        is_custom_weights = "best.pt" in model_path.lower()
        
        best_box = None
        max_iou = 0.0
        
        for box in results[0].boxes:
            cls_id = int(box.cls[0].item())
            conf = float(box.conf[0].item())
            xyxy = box.xyxy[0].cpu().numpy()
            x1, y1, x2, y2 = [int(val) for val in xyxy]
            
            iou = calculate_iou(last_bbox, [x1, y1, x2, y2])
            
            # Match condition:
            # 1. Custom model and class ID matches AND IoU >= threshold
            # 2. OR generic model (yolov8n.pt) where COCO classes don't match custom label names AND IoU >= threshold
            # 3. OR high spatial IoU overlap (>= 0.4) regardless of class ID
            class_matches = (target_class_id is not None and cls_id == target_class_id)
            spatial_match = (iou >= TRACKING_IOU_THRESHOLD)
            
            if (class_matches or not is_custom_weights or iou >= 0.4) and spatial_match:
                if iou > max_iou:
                    max_iou = iou
                    best_box = [x1, y1, x2, y2]
                    
        if best_box:
            logger.info(f"YOLO fallback successfully found match for '{label}' with IoU: {max_iou:.4f}")
        return best_box
        
    except Exception as e:
        logger.warning(f"YOLO fallback execution failed: {e}")
        return None


def verify_and_repair_metadata(video_id: str) -> bool:
    """
    Verifies consistency between metadata.json, annotations_metadata.json, and the disk files in labels/.
    Repairs missing/mismatching entries.
    Returns True if successful.
    """
    import uuid
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        logger.error(f"Cannot verify metadata: video folder '{video_id}' not found.")
        return False
        
    metadata_path = video_dir / "metadata.json"
    if not metadata_path.exists():
        logger.error(f"Cannot verify metadata: metadata.json not found for video '{video_id}'.")
        return False
        
    try:
        # 1. Load metadata.json
        with open(metadata_path, "r") as f:
            metadata = json.load(f)
            
        frame_width = metadata.get("frame_width")
        frame_height = metadata.get("frame_height")
        total_frames = metadata.get("total_frames", 0)
        
        if not frame_width or not frame_height:
            logger.error(f"Dimensions missing in metadata for video '{video_id}'.")
            return False
            
        # 2. Load annotations_metadata.json
        annotations_meta = get_annotations_metadata(video_id)
        if "frames" not in annotations_meta:
            annotations_meta["frames"] = {}
            
        # 3. Read classes map for reconstruction mapping
        classes = {}
        if CLASSES_FILE.exists():
            with open(CLASSES_FILE, "r") as f:
                classes = json.load(f)
        id_to_label = {v: k for k, v in classes.items()}
        
        labels_dir = video_dir / "labels"
        os.makedirs(labels_dir, exist_ok=True)
        
        # Get list of label files on disk
        disk_files = {f for f in os.listdir(labels_dir) if f.lower().endswith(".txt")}
        
        # Get list of annotated frames in annotations_metadata.json
        meta_frames = list(annotations_meta["frames"].keys())
        
        repaired = False
        
        # Step A: Check if a frame exists in annotations_metadata but label file is missing
        for frame_name in meta_frames:
            safe_frame_name = Path(frame_name).name
            frame_name_no_ext = Path(safe_frame_name).stem
            label_filename = f"{frame_name_no_ext}.txt"
            
            anns = annotations_meta["frames"][frame_name]
            label_file_path = labels_dir / label_filename
            
            if not anns:
                # If frame is listed in metadata but has no annotations, remove it
                annotations_meta["frames"].pop(frame_name, None)
                if label_file_path.exists():
                    os.remove(label_file_path)
                repaired = True
                continue
                
            if label_filename not in disk_files:
                # Reconstruct label file from metadata
                yolo_lines = []
                for ann in anns:
                    label = ann.get("label")
                    bbox = ann.get("bbox")
                    if label and bbox and len(bbox) == 4:
                        class_id = get_or_create_class_id(label)
                        xmin, ymin, xmax, ymax = bbox
                        x_center = (xmin + xmax) / 2.0 / frame_width
                        y_center = (ymin + ymax) / 2.0 / frame_height
                        w = (xmax - xmin) / frame_width
                        h = (ymax - ymin) / frame_height
                        yolo_lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {w:.6f} {h:.6f}")
                
                with open(label_file_path, "w") as lf:
                    lf.write("\n".join(yolo_lines) + "\n")
                logger.info(f"Metadata repair: Reconstructed missing label file '{label_filename}' from metadata.")
                repaired = True
                
        # Step B: Check if a label file exists on disk but has no entry in annotations_metadata.json
        for filename in disk_files:
            frame_stem = Path(filename).stem
            frame_name = f"{frame_stem}.jpg"
            images_dir = video_dir / "images"
            if images_dir.exists():
                candidates = [f for f in os.listdir(images_dir) if Path(f).stem == frame_stem]
                if candidates:
                    frame_name = candidates[0]
            
            label_file_path = labels_dir / filename
            
            if frame_name not in annotations_meta["frames"]:
                rich_anns = []
                try:
                    with open(label_file_path, "r") as lf:
                        lines = lf.readlines()
                    for line in lines:
                        parts = line.strip().split()
                        if len(parts) == 5:
                            class_id = int(parts[0])
                            xc, yc, w, h = [float(x) for x in parts[1:]]
                            
                            xmin = int(round((xc - w / 2.0) * frame_width))
                            ymin = int(round((yc - h / 2.0) * frame_height))
                            xmax = int(round((xc + w / 2.0) * frame_width))
                            ymax = int(round((yc + h / 2.0) * frame_height))
                            
                            raw_label = id_to_label.get(class_id, "unknown")
                            label = raw_label[0].upper() + raw_label[1:] if raw_label else "Unknown"
                            
                            rich_anns.append({
                                "id": f"ann_{uuid.uuid4().hex[:8]}",
                                "tracking_id": f"{raw_label}_001",
                                "label": label,
                                "bbox": [xmin, ymin, xmax, ymax],
                                "source": "imported",
                                "created_by": "system",
                                "propagation_state": "manual",
                                "confidence": 1.0,
                                "tracking_history": []
                            })
                    
                    if rich_anns:
                        annotations_meta["frames"][frame_name] = rich_anns
                        logger.info(f"Metadata repair: Added frame '{frame_name}' back to annotations_metadata from label file '{filename}'.")
                    else:
                        if label_file_path.exists():
                            os.remove(label_file_path)
                    repaired = True
                except Exception as parse_err:
                    logger.error(f"Failed to parse label file {label_file_path} during metadata repair: {parse_err}")
                    
        # Save annotations metadata if repaired
        if repaired:
            save_annotations_metadata(video_id, annotations_meta)
            
        # 4. Count the number of non-empty label files
        label_files = [
            f for f in os.listdir(labels_dir)
            if f.lower().endswith(".txt") and os.path.isfile(labels_dir / f) and os.path.getsize(labels_dir / f) > 0
        ]
        annotated_frames_count = len(label_files)
        
        # 5. Update metadata.json
        metadata["annotated_frames"] = annotated_frames_count
        skipped_count = len(metadata.get("skipped_frames", []))
        effective_total = max(0, total_frames - skipped_count)
        if (effective_total > 0 and annotated_frames_count >= effective_total) or (effective_total == 0 and total_frames > 0):
            metadata["status"] = "completed"
        elif metadata.get("status") == "completed" and annotated_frames_count < effective_total:
            metadata["status"] = "annotating"
            
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)
            
        logger.info(f"Metadata consistency verified for video '{video_id}'. Annotated frames count: {annotated_frames_count}")
        return True
        
    except Exception as e:
        logger.exception(f"Error during metadata consistency verification: {e}")
        return False


def delete_uploaded_video_only(video_id: str) -> dict:
    """
    Deletes ONLY the original uploaded source video file for the specified video_id.
    Preserves all extracted key frames, annotations, bounding boxes, labels, and metadata.json.
    Updates metadata.json with video_deleted = True.
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset for video ID '{video_id}' not found."
        )

    # Find video file(s) in video_dir
    video_files = [
        f for f in video_dir.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS
    ]

    if not video_files:
        # Check if already deleted
        metadata_path = video_dir / "metadata.json"
        if metadata_path.exists():
            with open(metadata_path, "r") as f:
                meta = json.load(f)
            meta["video_deleted"] = True
            with open(metadata_path, "w") as f:
                json.dump(meta, f, indent=2)
        return {
            "video_id": video_id,
            "status": "success",
            "message": "Uploaded video file was already removed. Extracted frames and annotations remain intact."
        }

    # Delete video file(s)
    deleted_count = 0
    for vf in video_files:
        try:
            vf.unlink()
            deleted_count += 1
            logger.info(f"Deleted source video file: {vf}")
        except Exception as e:
            logger.error(f"Failed to delete video file {vf}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete video file: {vf.name}"
            )

    # Update metadata.json
    metadata_path = video_dir / "metadata.json"
    if metadata_path.exists():
        try:
            with open(metadata_path, "r") as f:
                metadata = json.load(f)
            metadata["video_deleted"] = True
            with open(metadata_path, "w") as f:
                json.dump(metadata, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to update metadata.json after deleting video file: {e}")

    return {
        "video_id": video_id,
        "status": "success",
        "message": f"Successfully deleted {deleted_count} uploaded video file(s). Extracted frames and annotation data preserved."
    }

def delete_complete_dataset(video_id: str) -> dict:
    """
    Permanently deletes the entire dataset directory for video_id (video, frames, labels, metadata, stats).
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset for video ID '{video_id}' not found."
        )

    try:
        shutil.rmtree(video_dir)
        logger.info(f"Successfully deleted complete dataset folder: {video_dir}")
        return {
            "video_id": video_id,
            "status": "success",
            "message": f"Complete dataset for '{video_id}' permanently deleted."
        }
    except Exception as e:
        logger.error(f"Failed to delete dataset directory {video_dir}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete dataset directory: {e}"
        )


def reset_dataset_annotations(video_id: str) -> dict:
    """
    Resets all annotations for the given video_id.
    Deletes all label files in storage/<video_id>/labels/,
    clears annotations_metadata.json, and updates metadata.json (annotated_frames = 0, status = "annotating").
    Preserves all extracted JPEG frame images and the source video file.
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    # 1. Clear labels directory
    labels_dir = video_dir / "labels"
    if labels_dir.exists():
        try:
            for f in os.listdir(labels_dir):
                file_path = labels_dir / f
                if file_path.is_file():
                    file_path.unlink()
            logger.info(f"Cleared all label text files in {labels_dir}")
        except Exception as e:
            logger.error(f"Failed to clear labels directory: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to clear label files."
            )

    # 2. Reset annotations_metadata.json
    ann_meta_path = video_dir / "annotations_metadata.json"
    try:
        empty_ann_meta = {
            "video_id": video_id,
            "frames": {}
        }
        with open(ann_meta_path, "w", encoding="utf-8") as f:
            json.dump(empty_ann_meta, f, indent=2)
        logger.info(f"Reset annotations_metadata.json at {ann_meta_path}")
    except Exception as e:
        logger.error(f"Failed to reset annotations_metadata.json: {e}")

    # 3. Update metadata.json
    metadata_path = video_dir / "metadata.json"
    if metadata_path.exists():
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
            metadata["annotated_frames"] = 0
            metadata["status"] = "annotating"
            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
            logger.info(f"Updated metadata.json for '{video_id}': annotated_frames = 0")
        except Exception as e:
            logger.error(f"Failed to update metadata.json: {e}")

    return {
        "video_id": video_id,
        "status": "success",
        "message": f"Successfully reset all annotations for dataset '{video_id}'. Extracted frames preserved for immediate re-annotation.",
        "annotated_frames": 0
    }


def skip_frame(video_id: str, frame_name: str) -> dict:
    """
    Marks a specific frame as skipped.
    Skipped frames are excluded from dataset metrics and YOLO training exports while preserving image files.
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    # Validate frame exists
    get_frame_path(video_id, frame_name)

    metadata_path = video_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="metadata.json is missing for this video."
        )

    try:
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception as e:
        logger.error(f"Failed to read metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read video metadata."
        )

    skipped_frames = set(metadata.get("skipped_frames", []))
    skipped_frames.add(frame_name)
    metadata["skipped_frames"] = list(skipped_frames)

    # Recalculate status based on effective total frames
    total_frames = metadata.get("total_frames", 0)
    annotated_frames = metadata.get("annotated_frames", 0)
    effective_total = max(0, total_frames - len(skipped_frames))
    if (effective_total > 0 and annotated_frames >= effective_total) or (effective_total == 0 and total_frames > 0):
        metadata["status"] = "completed"
    elif metadata.get("status") == "completed" and annotated_frames < effective_total:
        metadata["status"] = "annotating"

    try:
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
        logger.info(f"Frame '{frame_name}' marked as skipped for video '{video_id}'")
    except Exception as e:
        logger.error(f"Failed to write metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update frame skip state."
        )

    return {
        "status": "success",
        "message": f"Frame '{frame_name}' excluded from AI training.",
        "video_id": video_id,
        "frame_name": frame_name,
        "skipped": True
    }


def restore_frame(video_id: str, frame_name: str) -> dict:
    """
    Restores a previously skipped frame back to the active annotation workflow.
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    # Validate frame exists
    get_frame_path(video_id, frame_name)

    metadata_path = video_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="metadata.json is missing for this video."
        )

    try:
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception as e:
        logger.error(f"Failed to read metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read video metadata."
        )

    skipped_frames = set(metadata.get("skipped_frames", []))
    if frame_name in skipped_frames:
        skipped_frames.remove(frame_name)
    metadata["skipped_frames"] = list(skipped_frames)

    # Recalculate status based on effective total frames
    total_frames = metadata.get("total_frames", 0)
    annotated_frames = metadata.get("annotated_frames", 0)
    effective_total = max(0, total_frames - len(skipped_frames))
    if (effective_total > 0 and annotated_frames >= effective_total) or (effective_total == 0 and total_frames > 0):
        metadata["status"] = "completed"
    elif metadata.get("status") == "completed" and annotated_frames < effective_total:
        metadata["status"] = "annotating"

    try:
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
        logger.info(f"Frame '{frame_name}' restored for video '{video_id}'")
    except Exception as e:
        logger.error(f"Failed to write metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update frame restore state."
        )

    return {
        "status": "success",
        "message": f"Frame '{frame_name}' restored to active annotation workflow.",
        "video_id": video_id,
        "frame_name": frame_name,
        "skipped": False
    }


def skip_frame_range(video_id: str, start_frame: str, end_frame: str) -> dict:
    """
    Marks a range of frames (from start_frame to end_frame inclusive) as skipped.
    Skipped frames are excluded from dataset metrics and YOLO training exports while preserving image files.
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

    # Get frame sequence list
    frames_data = get_frames_for_video(video_id)
    all_frames = [f["name"] for f in frames_data.get("frames", [])]
    
    if start_frame not in all_frames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Start frame '{start_frame}' not found in video frame sequence."
        )
    if end_frame not in all_frames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"End frame '{end_frame}' not found in video frame sequence."
        )

    start_idx = all_frames.index(start_frame)
    end_idx = all_frames.index(end_frame)

    if start_idx > end_idx:
        start_idx, end_idx = end_idx, start_idx
        start_frame, end_frame = end_frame, start_frame

    frames_to_skip = all_frames[start_idx : end_idx + 1]

    metadata_path = video_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="metadata.json is missing for this video."
        )

    try:
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception as e:
        logger.error(f"Failed to read metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read video metadata."
        )

    skipped_frames = set(metadata.get("skipped_frames", []))
    skipped_frames.update(frames_to_skip)
    metadata["skipped_frames"] = list(skipped_frames)

    # Recalculate status based on effective total frames
    total_frames = metadata.get("total_frames", 0)
    annotated_frames = metadata.get("annotated_frames", 0)
    effective_total = max(0, total_frames - len(skipped_frames))
    if (effective_total > 0 and annotated_frames >= effective_total) or (effective_total == 0 and total_frames > 0):
        metadata["status"] = "completed"
    elif metadata.get("status") == "completed" and annotated_frames < effective_total:
        metadata["status"] = "annotating"

    try:
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
        logger.info(f"Skipped range of {len(frames_to_skip)} frames ('{start_frame}' to '{end_frame}') for video '{video_id}'")
    except Exception as e:
        logger.error(f"Failed to write metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update frame skip range state."
        )

    return {
        "status": "success",
        "message": f"Successfully excluded {len(frames_to_skip)} frames from AI training (from '{start_frame}' to '{end_frame}').",
        "video_id": video_id,
        "start_frame": start_frame,
        "end_frame": end_frame,
        "skipped_count": len(frames_to_skip)
    }






