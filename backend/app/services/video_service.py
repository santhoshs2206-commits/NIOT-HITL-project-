import os
import re
import json
import shutil
import logging
from pathlib import Path
import cv2
from fastapi import UploadFile, HTTPException, status
from app.config import STORAGE_DIR, CLASSES_FILE

logger = logging.getLogger("underwater-hitl-backend.video_service")

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

def extract_frames_for_video(video_id: str) -> dict:
    """
    Extracts all frames from the uploaded video in storage/<video_id>/video.*
    Saves them as frame0001.jpg, frame0002.jpg, etc. under storage/<video_id>/images/
    Updates metadata.json.
    """
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

    # Initialize OpenCV capture
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logger.error(f"Failed to open video file: {video_path}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The video file is invalid, corrupt, or cannot be opened."
        )

    frames_extracted = 0
    frame_width = 0
    frame_height = 0

    try:
        # We can also get width and height from capture properties
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        while True:
            success, frame = cap.read()
            if not success:
                break
                
            frames_extracted += 1
            frame_filename = f"frame{frames_extracted:04d}.jpg"
            frame_path = images_dir / frame_filename
            
            # Save frame using cv2.imwrite
            # If width or height is 0, fetch it from the frame directly
            if frame_width == 0 or frame_height == 0:
                frame_height, frame_width, _ = frame.shape
                
            success_write = cv2.imwrite(str(frame_path), frame)
            if not success_write:
                logger.error(f"Failed to write frame to {frame_path}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to save extracted frame {frames_extracted}."
                )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error during frame extraction: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error during frame extraction: {str(e)}"
        )
    finally:
        cap.release()
        cv2.destroyAllWindows()

    if frames_extracted == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No frames could be extracted from the video file."
        )

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

    metadata["total_frames"] = frames_extracted
    metadata["annotated_frames"] = metadata.get("annotated_frames", 0)
    metadata["frame_width"] = frame_width
    metadata["frame_height"] = frame_height
    metadata["status"] = "annotating"

    try:
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)
        logger.info(f"Updated metadata.json for {video_id} with {frames_extracted} frames.")
    except Exception as e:
        logger.error(f"Failed to update metadata.json: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update video metadata after extraction."
        )

    return {
        "video_id": video_id,
        "frames_extracted": frames_extracted,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "status": "annotating"
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

    labels_dir = video_dir / "labels"
    frames_list = []
    
    for filename in image_files:
        # Check if corresponding label file exists
        frame_name_no_ext = Path(filename).stem
        label_file = labels_dir / f"{frame_name_no_ext}.txt"
        annotated = label_file.exists() and label_file.is_file()
        
        frames_list.append({
            "name": filename,
            "annotated": annotated
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

def save_annotations_for_frame(video_id: str, frame_name: str, annotations: list[dict]) -> dict:
    """
    Saves annotations for a specific frame in YOLO format.
    Validates existence of the video directory and the frame file.
    Converts coordinates from pixel space [xmin, ymin, xmax, ymax] to normalized YOLO space.
    Saves to storage/<video_id>/labels/<frame_name_no_ext>.txt.
    Recalculates annotated_frames and updates metadata.json.
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
    else:
        # Ensure labels directory exists
        os.makedirs(labels_dir, exist_ok=True)
        
        yolo_lines = []
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

    if total_frames > 0 and annotated_frames == total_frames:
        metadata["status"] = "completed"
    else:
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
            status_str = metadata.get("status", "uploaded")
            
            if not video_id:
                video_id = item.name
            
            if filename is None:
                filename = "unknown"
            
            # Calculate completion rate for this video
            if v_total_frames > 0:
                v_completion_rate = round((v_annotated_frames / v_total_frames) * 100, 2)
            else:
                v_completion_rate = 0.0
                
            videos_list.append({
                "video_id": video_id,
                "filename": filename,
                "total_frames": v_total_frames,
                "annotated_frames": v_annotated_frames,
                "completion_rate": v_completion_rate,
                "status": status_str
            })
            
            # Add to aggregates
            total_videos += 1
            total_frames += v_total_frames
            annotated_frames += v_annotated_frames

    # Sort videos list by video_id
    videos_list.sort(key=lambda x: x["video_id"])
    
    # Calculate overall metrics
    remaining_frames = total_frames - annotated_frames
    if total_frames > 0:
        overall_completion_rate = round((annotated_frames / total_frames) * 100, 2)
    else:
        overall_completion_rate = 0.0
        
    return {
        "total_videos": total_videos,
        "total_frames": total_frames,
        "annotated_frames": annotated_frames,
        "remaining_frames": remaining_frames,
        "overall_completion_rate": overall_completion_rate,
        "videos": videos_list
    }

def get_annotations_for_frame(video_id: str, frame_name: str) -> list[dict]:
    """
    Retrieves annotations for a specific frame.
    Reads YOLO format from storage/<video_id>/labels/<frame_name_no_ext>.txt.
    Converts back from normalized YOLO space to pixel space [xmin, ymin, xmax, ymax].
    Maps class IDs back to labels using classes.json.
    """
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video ID '{video_id}' not found."
        )

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

