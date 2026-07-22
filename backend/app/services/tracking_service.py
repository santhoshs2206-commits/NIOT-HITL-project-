import os
import shutil
import logging
import time
import uuid
from enum import Enum
from pathlib import Path
import numpy as np
import cv2

from app.config import (
    STORAGE_DIR,
    TRACKING_DEFAULT_METHOD,
    TRACKING_CONFIDENCE_THRESHOLD,
    TRACKING_TEMPLATE_UPDATE_THRESHOLD,
    TRACKING_IOU_THRESHOLD,
)
from app.services import video_service

logger = logging.getLogger("underwater-hitl-backend.tracking_service")


class StopReason(str, Enum):
    ALL_OBJECTS_LOST = "all_objects_lost"
    MANUAL_ANNOTATION = "manual_annotation_encountered"
    FRAME_LIMIT = "frame_limit_reached"
    END_OF_VIDEO = "end_of_video"
    NO_ANNOTATIONS = "no_annotations"
    USER_CANCELLED = "user_cancelled"
    ERROR = "error"


class AnnotationSource(str, Enum):
    MANUAL = "manual"
    TRACKING = "tracking"
    YOLO = "yolo"
    IMPORTED = "imported"


class PropagationState(str, Enum):
    MANUAL = "manual"
    TRACKED = "tracked"
    RETRACKED = "retracked"
    VERIFIED = "verified"
    REJECTED = "rejected"


class TrackerFactory:
    """
    Factory class to create OpenCV trackers with fallback options.
    """
    @staticmethod
    def create_tracker(tracker_type: str = "CSRT") -> tuple[any, str]:
        tracker_type = tracker_type.upper()
        
        # Build variations to search for case-insensitive matches (especially for OpenCV 5)
        variations = [tracker_type, tracker_type.title(), tracker_type.capitalize()]
        if tracker_type == "VIT":
            variations.insert(0, "Vit")
        elif tracker_type == "NANO":
            variations.insert(0, "Nano")
        elif tracker_type == "DASIARMPN" or tracker_type == "DASIAMRPN":
            variations.insert(0, "DaSiamRPN")

        for var in variations:
            creator_name = f"Tracker{var}_create"
            logger.info(f"Stage 4: Checking availability of tracker '{var}' (creator name: '{creator_name}')...")
            
            # Check if the requested tracker is available directly in cv2
            if hasattr(cv2, creator_name):
                try:
                    logger.info(f"Stage 4: Creating tracker '{var}' directly from cv2 module")
                    return getattr(cv2, creator_name)(), var
                except Exception as e:
                    logger.warning(f"Failed to create tracker {var} via {creator_name}: {e}")

            # Check if cv2 has legacy module containing the tracker
            if hasattr(cv2, "legacy"):
                legacy_cv = getattr(cv2, "legacy")
                if hasattr(legacy_cv, creator_name):
                    try:
                        logger.info(f"Stage 4: Creating tracker '{var}' from cv2.legacy module")
                        return getattr(legacy_cv, creator_name)(), f"Legacy {var}"
                    except Exception as e:
                        logger.warning(f"Failed to create legacy tracker {var}: {e}")

        # Fallback to TrackerMIL which is standard and available in OpenCV 5.x
        logger.info(f"Stage 4: Tracker '{tracker_type}' not available in this OpenCV build. Falling back to MIL.")
        if hasattr(cv2, "TrackerMIL_create"):
            return cv2.TrackerMIL_create(), "MIL"
        elif hasattr(cv2, "legacy") and hasattr(cv2.legacy, "TrackerMIL_create"):
            return cv2.legacy.TrackerMIL_create(), "Legacy MIL"
        
        raise RuntimeError("No suitable OpenCV tracking algorithm (including MIL fallback) found in this build.")


def compute_confidence(patch: np.ndarray, template: np.ndarray) -> float:
    """
    Computes a similarity confidence score [0, 1] using template matching
    between a tracked image patch and the reference template patch.
    """
    if patch is None or template is None or patch.size == 0 or template.size == 0:
        return 0.0
    
    h, w = template.shape[:2]
    try:
        # Resize current patch to match the reference template dimensions
        resized_patch = cv2.resize(patch, (w, h))
        res = cv2.matchTemplate(resized_patch, template, cv2.TM_CCOEFF_NORMED)
        score = float(res[0][0])
        return max(0.0, min(1.0, score))
    except Exception as e:
        logger.error(f"Error computing template similarity score: {e}")
        return 0.0


def get_next_tracking_id(video_id: str, label: str, excluded_ids: set[str] = None) -> str:
    """
    Scans existing annotations in annotations_metadata.json to find the next 
    sequential tracking ID for a given label (e.g. fish_001, fish_002),
    excluding any IDs in excluded_ids.
    """
    metadata = video_service.get_annotations_metadata(video_id)
    max_num = 0
    clean_label = label.strip().lower().replace(" ", "_")
    prefix = f"{clean_label}_"
    
    # Collect all known tracking IDs including excluded ones
    all_known_tids = set()
    if excluded_ids:
        all_known_tids.update(t.lower() for t in excluded_ids)
        
    for frame_name, annotations in metadata.get("frames", {}).items():
        for ann in annotations:
            tid = ann.get("tracking_id")
            if tid:
                all_known_tids.add(tid.lower())
                
    for tid in all_known_tids:
        if tid.startswith(prefix):
            try:
                num_part = tid[len(prefix):]
                num = int(num_part)
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
                    
    next_num = max_num + 1
    return f"{clean_label}_{next_num:03d}"


class ObjectTracker:
    """
    Wraps an OpenCV tracker instance and manages state for a single annotated target,
    including appearance template updates and normalized similarity confidence scores.
    """
    def __init__(self, tracker_type: str, frame: np.ndarray, bbox: list[int], label: str, tracking_id: str, ann_id: str = None, template_update_threshold: float = TRACKING_TEMPLATE_UPDATE_THRESHOLD):
        """
        Initializes the tracker.
        bbox is in [xmin, ymin, xmax, ymax] format (pixel coordinates)
        """
        self.label = label
        self.tracking_id = tracking_id
        self.ann_id = ann_id or f"ann_{uuid.uuid4().hex[:8]}"
        self.template_update_threshold = template_update_threshold
        
        xmin, ymin, xmax, ymax = bbox
        fh, fw = frame.shape[:2]
        
        # Ensure coordinates are within image bounds
        x = max(0, min(fw - 1, xmin))
        y = max(0, min(fh - 1, ymin))
        w = max(1, min(fw - x, xmax - xmin))
        h = max(1, min(fh - y, ymax - ymin))
        
        # Create the tracker and capture its actual running type
        self.tracker, self.tracker_type = TrackerFactory.create_tracker(tracker_type)
        logger.info(f"Stage 5: Initializing OpenCV tracker {self.tracker_type} (requested: {tracker_type}) for '{tracking_id}' with bbox {bbox} (clipped to: x={x}, y={y}, w={w}, h={h})")
        
        self.tracker.init(frame, (x, y, w, h))
        
        self.template = frame[y:y+h, x:x+w].copy()
        self.last_bbox = [x, y, x + w, y + h]
        self.confidence = 1.0
        self.source = AnnotationSource.TRACKING
        self.propagation_state = PropagationState.TRACKED

    def update(self, frame: np.ndarray) -> tuple[bool, list[int], float, bool]:
        """
        Updates the tracker on the current frame.
        Returns:
          success: bool indicating if tracking succeeded
          bbox: [xmin, ymin, xmax, ymax] updated bounding box
          confidence: float similarity confidence score
          template_updated: bool indicating if the template was updated
        """
        success, cv_bbox = self.tracker.update(frame)
        logger.info(f"Stage 7: OpenCV tracker updated for '{self.tracking_id}' (success: {success}, raw bbox: {cv_bbox if success else 'None'})")
        
        if not success:
            return False, self.last_bbox, 0.0, False
            
        x, y, w, h = [int(val) for val in cv_bbox]
        fh, fw = frame.shape[:2]
        
        # Clip coordinates to frame boundaries
        x = max(0, min(fw - 1, x))
        y = max(0, min(fh - 1, y))
        w = max(1, min(fw - x, w))
        h = max(1, min(fh - y, h))
        
        current_patch = frame[y:y+h, x:x+w]
        confidence = compute_confidence(current_patch, self.template)
        logger.info(f"Stage 8: Template matching confidence computed for '{self.tracking_id}': {confidence:.4f}")
        
        new_bbox = [x, y, x + w, y + h]
        self.last_bbox = new_bbox
        self.confidence = confidence
        
        template_updated = False
        if confidence >= self.template_update_threshold:
            logger.info(f"Template UPDATED for '{self.tracking_id}' as confidence {confidence:.4f} >= threshold {self.template_update_threshold}")
            self.template = current_patch.copy()
            template_updated = True
        else:
            logger.info(f"Template NOT updated for '{self.tracking_id}' (confidence {confidence:.4f} < threshold {self.template_update_threshold})")
            
        return True, new_bbox, confidence, template_updated

    def reinitialize(self, frame: np.ndarray, bbox: list[int], source: AnnotationSource = AnnotationSource.YOLO, propagation_state: PropagationState = PropagationState.RETRACKED):
        """
        Reinitializes the tracker with a new bounding box (e.g. from YOLO fallback or manual edit).
        """
        xmin, ymin, xmax, ymax = bbox
        fh, fw = frame.shape[:2]
        
        x = max(0, min(fw - 1, xmin))
        y = max(0, min(fh - 1, ymin))
        w = max(1, min(fw - x, xmax - xmin))
        h = max(1, min(fh - y, ymax - ymin))
        
        self.tracker, self.tracker_type = TrackerFactory.create_tracker(self.tracker_type)
        self.tracker.init(frame, (x, y, w, h))
        
        self.template = frame[y:y+h, x:x+w].copy()
        self.last_bbox = [x, y, x + w, y + h]
        self.confidence = 1.0
        self.source = source
        self.propagation_state = propagation_state


def refine_bbox_foreground_extent(frame: np.ndarray, bbox: list[int], padding: int = 4) -> list[int]:
    """
    Refines a bounding box by trimming surrounding background ocean water using gradient + intensity thresholding,
    ensuring the bounding box tightly fits the visible organism without preserving excess empty background.
    """
    if bbox is None or len(bbox) != 4:
        return bbox
    xmin, ymin, xmax, ymax = [int(v) for v in bbox]
    fh, fw = frame.shape[:2]
    
    xmin = max(0, min(fw - 1, xmin))
    ymin = max(0, min(fh - 1, ymin))
    xmax = max(xmin + 10, min(fw, xmax))
    ymax = max(ymin + 10, min(fh, ymax))
    
    patch = frame[ymin:ymax, xmin:xmax]
    if patch is None or patch.size == 0:
        return [xmin, ymin, xmax, ymax]
        
    ph, pw = patch.shape[:2]
    if ph < 15 or pw < 15:
        return [xmin, ymin, xmax, ymax]
        
    try:
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # 1. Morphological Gradient Saliency (edge content on creature vs uniform water)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        grad = cv2.morphologyEx(blur, cv2.MORPH_GRADIENT, kernel)
        _, mask1 = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # 2. Otsu thresholding on intensity difference from boundary background mean
        bg_val = float(np.median(np.concatenate([gray[0, :], gray[-1, :], gray[:, 0], gray[:, -1]])))
        diff = cv2.absdiff(gray, int(bg_val))
        _, mask2 = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        combined_mask = cv2.bitwise_or(mask1, mask2)
        coords = cv2.findNonZero(combined_mask)
        if coords is None:
            return [xmin, ymin, xmax, ymax]
            
        fx, fy, fw_box, fh_box = cv2.boundingRect(coords)
        
        # Only trim if foreground object occupies at least 25% of patch area
        if fw_box >= pw * 0.25 and fh_box >= ph * 0.25:
            new_xmin = max(0, xmin + fx - padding)
            new_ymin = max(0, ymin + fy - padding)
            new_xmax = min(fw, xmin + fx + fw_box + padding)
            new_ymax = min(fh, ymin + fy + fh_box + padding)
            return [new_xmin, new_ymin, new_xmax, new_ymax]
    except Exception as e:
        logger.warning(f"Foreground extent refinement skipped: {e}")
        
    return [xmin, ymin, xmax, ymax]


def validate_bbox(bbox: list[int], width: int, height: int) -> list[int] | None:
    """
    Validates a bounding box. Clips to frame boundaries and ensures width/height are positive.
    Returns the clipped box [xmin, ymin, xmax, ymax] or None if invalid.
    """
    if len(bbox) != 4:
        return None
    xmin, ymin, xmax, ymax = [int(val) for val in bbox]
    
    # Clip to bounds
    xmin = max(0, min(width - 1, xmin))
    ymin = max(0, min(height - 1, ymin))
    xmax = max(0, min(width, xmax))
    ymax = max(0, min(height, ymax))
    
    if xmax <= xmin or ymax <= ymin:
        return None
        
    return [xmin, ymin, xmax, ymax]


def propagate_annotations(
    video_id: str,
    start_frame: str,
    mode: str = "until_lost",
    tracker_type: str = "CSRT",
    use_yolo_fallback: bool = False,
    session_id: str | None = None,
    confidence_threshold: float | None = None
) -> dict:
    """
    Propagates object annotations forward starting from start_frame using OpenCV tracking
    and optional YOLO detection recovery. Employs a transactional rollback on failure.
    """
    logger.info(f"Starting propagation for video '{video_id}' from '{start_frame}' (mode: {mode}, tracker: {tracker_type}, YOLO fallback: {use_yolo_fallback}, confidence_threshold: {confidence_threshold})")
    
    video_dir = STORAGE_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise FileNotFoundError(f"Video folder for {video_id} does not exist.")
        
    # Get frame sequence list
    frames_data = video_service.get_frames_for_video(video_id)
    frames_list = [f["name"] for f in frames_data.get("frames", [])]
    
    try:
        start_idx = frames_list.index(start_frame)
    except ValueError:
        raise ValueError(f"Start frame '{start_frame}' not found in the frame list for video '{video_id}'.")
        
    # Get the frame limits based on propagation mode
    limit = None
    if mode == "10":
        limit = 10
    elif mode == "25":
        limit = 25
    elif mode == "50":
        limit = 50
    elif mode == "until_lost":
        limit = None
    else:
        # Check if mode is numeric string
        try:
            limit = int(mode)
        except ValueError:
            logger.warning(f"Unknown propagation mode '{mode}', defaulting to until_lost.")
            limit = None

    # Load starting frame annotations
    start_annotations = video_service.get_annotations_for_frame(video_id, start_frame)
    logger.info(f"Stage 2: Loaded starting frame annotations for '{start_frame}': {len(start_annotations)} targets found.")
    rich_metadata = video_service.get_annotations_metadata(video_id)
    start_rich_anns = rich_metadata.get("frames", {}).get(start_frame, [])
    
    if not start_annotations:
        logger.warning(f"No annotations found on starting frame '{start_frame}'.")
        return {
            "frames_propagated": 0,
            "stop_reason": StopReason.NO_ANNOTATIONS,
            "failure_frame": start_frame,
            "objects_tracked": 0,
            "session_id": "",
            "history": []
        }

    # Set up transaction rollback directories
    if not session_id:
        session_id = f"prop_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    backup_dir = video_dir / "_propagation_backups" / session_id
    logger.info(f"Stage 3: Setting up rollback transaction backup directory: '{backup_dir}'")
    backup_metadata_path = backup_dir / "annotations_metadata.json"
    backup_labels_dir = backup_dir / "labels"
    
    os.makedirs(backup_labels_dir, exist_ok=True)
    
    # Back up annotations_metadata.json
    metadata_path = video_service.get_annotations_metadata_path(video_id)
    if metadata_path.exists():
        shutil.copy2(metadata_path, backup_metadata_path)
    
    # Back up all labels
    labels_dir = video_dir / "labels"
    if labels_dir.exists():
        for item in os.listdir(labels_dir):
            shutil.copy2(labels_dir / item, backup_labels_dir / item)
            
    rollback_triggered = False
    
    # Determine confidence threshold to use
    threshold = confidence_threshold if confidence_threshold is not None else TRACKING_CONFIDENCE_THRESHOLD

    tracking_history = []

    try:
        # Check CSRT availability and print status clearly as requested by user
        has_csrt = hasattr(cv2, "TrackerCSRT_create") or (hasattr(cv2, "legacy") and hasattr(cv2.legacy, "TrackerCSRT_create"))
        print("\nInitializing tracker...")
        logger.info("Initializing tracker...")
        if has_csrt:
            print("\n[OK] CSRT Available\n")
            logger.info("✓ CSRT Available")
        else:
            print("\nCSRT Not Available\n")
            logger.info("CSRT Not Available")
        print(f"Using: {tracker_type}\n")
        logger.info(f"Using: {tracker_type}")

        # Load the starting frame image
        first_frame_path = video_service.get_frame_path(video_id, start_frame)
        logger.info(f"Stage 4: Loading starting frame image '{first_frame_path}'")
        first_frame_img = cv2.imread(str(first_frame_path))
        if first_frame_img is None:
            raise ValueError(f"Failed to read image '{start_frame}'.")
            
        frame_h, frame_w = first_frame_img.shape[:2]
        
        # Initialize trackers
        active_trackers = []
        matched_r_ann_ids = set()
        
        # Map simple annotations to rich details if present, or assign persistent tracking IDs
        assigned_ids = set()
        for i, ann in enumerate(start_annotations):
            label = ann["label"]
            bbox = ann["bbox"]
            
            # Clip and validate starting box
            valid_bbox = validate_bbox(bbox, frame_w, frame_h)
            if not valid_bbox:
                logger.warning(f"Ignoring invalid starting bounding box: {bbox}")
                continue
                
            # Try to match with existing rich tracking ID from metadata
            tracking_id = None
            ann_id = None
            matched_r_ann = None
            for r_ann in start_rich_anns:
                # If overlap is high and labels match, use its tracking ID and unique ID
                if r_ann.get("label") == label and video_service.calculate_iou(r_ann.get("bbox", []), bbox) > 0.8:
                    tracking_id = r_ann.get("tracking_id")
                    ann_id = r_ann.get("id")
                    matched_r_ann = r_ann
                    break
            
            if matched_r_ann:
                matched_r_ann_ids.add(matched_r_ann.get("id"))
            
            if not tracking_id:
                tracking_id = get_next_tracking_id(video_id, label, excluded_ids=assigned_ids)
                
            assigned_ids.add(tracking_id)
            
            # Create tracker, passing matched ann_id if available
            tracker = ObjectTracker(
                tracker_type, 
                first_frame_img, 
                valid_bbox, 
                label, 
                tracking_id, 
                ann_id=ann_id,
                template_update_threshold=TRACKING_TEMPLATE_UPDATE_THRESHOLD
            )
            active_trackers.append(tracker)

        # High-visibility Start AI Tracking Debug Logging
        init_log = (
            f"\n====================================================\n"
            f"AI TRACKING INITIALIZATION\n"
            f"Start Frame: {start_frame}\n"
            f"Requested Tracker: {tracker_type}\n"
            f"YOLO Fallback: {'ENABLED' if use_yolo_fallback else 'DISABLED'}\n"
            f"Confidence Threshold: {threshold:.2f}\n"
            f"Active Targets ({len(active_trackers)}):\n"
        )
        for trk in active_trackers:
            init_log += (
                f"  - Target ID: {trk.tracking_id} | Class: {trk.label}\n"
                f"    Input BBox [xmin, ymin, xmax, ymax]: {trk.last_bbox}\n"
                f"    OpenCV Init BBox (x, y, w, h): ({trk.last_bbox[0]}, {trk.last_bbox[1]}, {trk.last_bbox[2]-trk.last_bbox[0]}, {trk.last_bbox[3]-trk.last_bbox[1]})\n"
                f"    Active Tracker Engine: {trk.tracker_type}\n"
            )
        init_log += "====================================================\n"
        print(init_log)
        logger.info(init_log)
        updated_start_rich = []
        for tracker in active_trackers:
            updated_start_rich.append({
                "id": tracker.ann_id,
                "tracking_id": tracker.tracking_id,
                "label": tracker.label,
                "bbox": tracker.last_bbox,
                "source": AnnotationSource.MANUAL,
                "created_by": "user",
                "propagation_state": PropagationState.MANUAL,
                "confidence": 1.0,
                "session_id": session_id,
                "timestamp": float(time.time()),
                "propagated_from": start_frame
            })
        
        # If some original annotations on start_frame didn't initialize trackers, keep them only if
        # they are genuine user-created manual annotations (not tracker-generated ones).
        # This prevents accumulation of stale tracking annotations across multiple propagation restarts.
        for r_ann in start_rich_anns:
            r_id = r_ann.get("id")
            if r_id and r_id in matched_r_ann_ids:
                continue
            # Only preserve genuine user-created manual annotations; skip tracker-generated ones
            is_user_manual = (
                r_ann.get("created_by") == "user" and
                (r_ann.get("source") == AnnotationSource.MANUAL or
                 r_ann.get("propagation_state") == PropagationState.MANUAL)
            )
            if not is_user_manual:
                continue
            # Check for overlap with active trackers to prevent duplicate annotations of the same class
            overlaps = False
            for tracker in active_trackers:
                if tracker.label == r_ann.get("label"):
                    if video_service.calculate_iou(r_ann.get("bbox", []), tracker.last_bbox) > 0.5:
                        overlaps = True
                        break
            if not overlaps:
                updated_start_rich.append(r_ann)
                
        # Save start frame annotations again to finalize tracking IDs
        video_service.save_annotations_for_frame(video_id, start_frame, updated_start_rich)

        if not active_trackers:
            logger.warning("No active trackers initialized.")
            return {
                "frames_propagated": 0,
                "stop_reason": StopReason.NO_ANNOTATIONS,
                "failure_frame": start_frame,
                "objects_tracked": 0,
                "session_id": session_id,
                "history": []
            }

        # Define the set of active tracking IDs for this session to ensure track isolation
        start_tracking_ids = {tracker.tracking_id for tracker in active_trackers}

        frames_propagated = 0
        stop_reason = None
        failure_frame = None
        tracking_history = []
        
        # Propagation loop through subsequent frames
        for idx in range(start_idx + 1, len(frames_list)):
            next_frame_name = frames_list[idx]
            
            # Check frame limit
            if limit is not None and frames_propagated >= limit:
                stop_reason = StopReason.FRAME_LIMIT
                failure_frame = next_frame_name
                break
                
            # Check if all objects are lost
            if not active_trackers:
                stop_reason = StopReason.ALL_OBJECTS_LOST
                failure_frame = next_frame_name
                break
                           # Identify genuine manual annotations drawn by the user on this frame
            next_metadata = video_service.get_annotations_metadata(video_id)
            next_rich_anns = next_metadata.get("frames", {}).get(next_frame_name, [])
            manual_anns = []
            for ann in next_rich_anns:
                is_manual = (
                    (ann.get("source") == AnnotationSource.MANUAL or
                     ann.get("propagation_state") == PropagationState.MANUAL or
                     ann.get("source") == "manual" or
                     ann.get("propagation_state") == "manual") and
                    ann.get("created_by") == "user"
                )
                if is_manual:
                    manual_anns.append(ann)

            # Match manual annotations to active trackers matching priority rules (tracking_id -> annotation_id -> IoU -> class)
            tracker_to_manual = {}
            matched_ann_ids = set()
            
            # Pass 1: Match by tracking_id
            for tracker in active_trackers:
                if tracker in tracker_to_manual:
                    continue
                for ann in manual_anns:
                    if id(ann) in matched_ann_ids:
                        continue
                    tid = ann.get("tracking_id")
                    if tid and tid == tracker.tracking_id:
                        tracker_to_manual[tracker] = ann
                        matched_ann_ids.add(id(ann))
                        logger.info(f"Matched manual annotation to tracker '{tracker.tracking_id}' by tracking_id")
                        break
                        
            # Pass 2: Match by annotation_id
            for tracker in active_trackers:
                if tracker in tracker_to_manual:
                    continue
                for ann in manual_anns:
                    if id(ann) in matched_ann_ids:
                        continue
                    ann_id = ann.get("id")
                    if ann_id and ann_id == tracker.ann_id:
                        tracker_to_manual[tracker] = ann
                        matched_ann_ids.add(id(ann))
                        logger.info(f"Matched manual annotation to tracker '{tracker.tracking_id}' by annotation_id '{ann_id}'")
                        break
                        
            # Pass 3: Match by IoU
            for tracker in active_trackers:
                if tracker in tracker_to_manual:
                    continue
                best_ann = None
                best_iou = 0.0
                for ann in manual_anns:
                    if id(ann) in matched_ann_ids:
                        continue
                    iou = video_service.calculate_iou(ann.get("bbox", []), tracker.last_bbox)
                    if iou > best_iou:
                        best_iou = iou
                        best_ann = ann
                if best_ann and best_iou > 0.1:
                    tracker_to_manual[tracker] = best_ann
                    matched_ann_ids.add(id(best_ann))
                    logger.info(f"Matched manual annotation to tracker '{tracker.tracking_id}' by IoU ({best_iou:.4f})")
                    
            # Pass 4: Match by class
            for tracker in active_trackers:
                if tracker in tracker_to_manual:
                    continue
                for ann in manual_anns:
                    if id(ann) in matched_ann_ids:
                        continue
                    if ann.get("label") == tracker.label:
                        tracker_to_manual[tracker] = ann
                        matched_ann_ids.add(id(ann))
                        logger.info(f"Matched manual annotation to tracker '{tracker.tracking_id}' by class '{tracker.label}'")
                        break

            # Align matched manual annotations metadata with matched tracker
            for tracker, ann in tracker_to_manual.items():
                ann["tracking_id"] = tracker.tracking_id
                ann["id"] = tracker.ann_id
                
            # Load frame image
            frame_path = video_service.get_frame_path(video_id, next_frame_name)
            logger.info(f"Stage 6: Loading subsequent frame image '{frame_path}' for tracking")
            frame_img = cv2.imread(str(frame_path))
            if frame_img is None:
                raise ValueError(f"Failed to read image '{next_frame_name}'.")
                
            frame_h, frame_w = frame_img.shape[:2]
            
            # Update trackers on this frame
            frame_predictions = []
            failed_trackers = []
            
            for tracker in active_trackers:
                if tracker in tracker_to_manual:
                    # Bypassed normal OpenCV tracking; consume manual annotation directly
                    ann = tracker_to_manual[tracker]
                    valid_box = validate_bbox(ann["bbox"], frame_w, frame_h)
                    if valid_box:
                        tracker.reinitialize(frame_img, valid_box, source=AnnotationSource.MANUAL, propagation_state=PropagationState.MANUAL)
                        frame_predictions.append((tracker, valid_box, 1.0))
                        
                        history_entry = {
                            "frame": next_frame_name,
                            "tracker": tracker.tracker_type,
                            "tracker_success": True,
                            "confidence": 1.0,
                            "template_updated": True,
                            "decision": "continue",
                            "reason": "manual_annotation"
                        }
                        tracking_history.append(history_entry)
                        logger.info(f"Consumed manual annotation for tracker '{tracker.tracking_id}' on frame '{next_frame_name}'")
                    else:
                        logger.warning(f"Invalid manual annotation box {ann['bbox']} for '{tracker.tracking_id}'")
                        failed_trackers.append(tracker)
                else:
                    # Update tracker normally using OpenCV
                    success, new_bbox, confidence, template_updated = tracker.update(frame_img)
                    
                    # Check tracker confidence and status using resolved threshold
                    is_confident = (success and confidence >= threshold)
                    
                    # Decision and reason
                    decision = "continue" if is_confident else "stop"
                    reason = None
                    if not success:
                        reason = "tracker_lost"
                    elif confidence < threshold:
                        reason = "confidence_low"
                    
                    # Save to history with EXACT format specified by the user
                    history_entry = {
                        "frame": next_frame_name,
                        "tracker": tracker.tracker_type,
                        "tracker_success": success,
                        "confidence": round(confidence, 4),
                        "template_updated": template_updated,
                        "decision": decision
                    }
                    if reason:
                        history_entry["reason"] = reason
                    tracking_history.append(history_entry)
                    
                    # Log detailed frame-by-frame tracing information as requested by the user
                    log_msg = (
                        f"\n------------------------------------\n"
                        f"Frame Index: {idx} | Frame Name: {next_frame_name}\n"
                        f"Target ID: {tracker.tracking_id} | Class: {tracker.label}\n"
                        f"Tracker Engine: {tracker.tracker_type}\n"
                        f"OpenCV Update Success: {success}\n"
                        f"Updated BBox [xmin,ymin,xmax,ymax]: {new_bbox}\n"
                        f"Similarity Confidence Score: {confidence:.4f} (Threshold: {threshold:.2f})\n"
                        f"Template Updated: {'Yes' if template_updated else 'No'}\n"
                        f"Decision: {'Continue' if is_confident else 'Stop'}\n"
                        f"Reason: {reason if reason else 'N/A'}\n"
                        f"------------------------------------"
                    )
                    print(log_msg)
                    logger.info(log_msg)
                    
                    if is_confident:
                        valid_box = validate_bbox(new_bbox, frame_w, frame_h)
                        if valid_box:
                            # 1. Continuous YOLO Re-Fitting (Every N=3 frames or when YOLO fallback enabled)
                            yolo_correction_box = None
                            should_run_yolo = use_yolo_fallback or (frames_propagated % 3 == 0)
                            if should_run_yolo:
                                y_box = video_service.run_yolo_fallback(
                                    frame_img, tracker.label, tracker.last_bbox, video_id
                                )
                                if y_box:
                                    yolo_correction_box = validate_bbox(y_box, frame_w, frame_h)

                            if yolo_correction_box:
                                valid_box = yolo_correction_box
                                tracker.reinitialize(frame_img, valid_box, source=AnnotationSource.YOLO, propagation_state=PropagationState.TRACKED)
                                logger.info(f"Continuous YOLO Re-Fitting (N=3) updated tight bbox for '{tracker.tracking_id}' on '{next_frame_name}': {valid_box}")
                            else:
                                # 2. Active Foreground Extent Refinement (Trims empty background ocean water)
                                trimmed_box = refine_bbox_foreground_extent(frame_img, valid_box)
                                if trimmed_box:
                                    valid_box = validate_bbox(trimmed_box, frame_w, frame_h) or valid_box

                            # 3. Detailed Bounding Box Evolution Metrics
                            curr_w = valid_box[2] - valid_box[0]
                            curr_h = valid_box[3] - valid_box[1]
                            aspect_ratio = round(curr_w / float(curr_h), 2) if curr_h > 0 else 0.0
                            step_iou = round(video_service.calculate_iou(tracker.last_bbox, valid_box), 4)

                            evolution_log = (
                                f"[BBOX EVOLUTION] Frame: {next_frame_name} | "
                                f"Tracker BBox: {new_bbox} | "
                                f"YOLO BBox: {yolo_correction_box if yolo_correction_box else 'N/A'} | "
                                f"Final Saved BBox: {valid_box} | "
                                f"Width: {curr_w} | Height: {curr_h} | "
                                f"Aspect Ratio: {aspect_ratio} | IoU: {step_iou}"
                            )
                            print(evolution_log)
                            logger.info(evolution_log)

                            frame_predictions.append((tracker, valid_box, confidence))
                        else:
                            failed_trackers.append(tracker)
                    else:
                        failed_trackers.append(tracker)
                        
            # Handle failed trackers using YOLO fallback
            for tracker in failed_trackers:
                recovered = False
                if use_yolo_fallback:
                    yolo_box = video_service.run_yolo_fallback(
                        frame_img, tracker.label, tracker.last_bbox, video_id
                    )
                    if yolo_box:
                        valid_yolo_box = validate_bbox(yolo_box, frame_w, frame_h)
                        if valid_yolo_box:
                            # Re-initialize tracker from YOLO detection
                            tracker.reinitialize(frame_img, valid_yolo_box)
                            frame_predictions.append((tracker, valid_yolo_box, 1.0))
                            recovered = True
                            logger.info(f"YOLO fallback recovered track '{tracker.tracking_id}' on frame '{next_frame_name}'")
                            
                            history_entry_yolo = {
                                "frame": next_frame_name,
                                "tracker": tracker.tracker_type,
                                "tracker_success": True,
                                "confidence": 1.0,
                                "template_updated": True,
                                "decision": "continue",
                                "reason": "recovered_by_yolo"
                            }
                            tracking_history.append(history_entry_yolo)
                            
                if not recovered:
                    if tracker in active_trackers:
                        active_trackers.remove(tracker)
                    logger.info(f"Track '{tracker.tracking_id}' lost on frame '{next_frame_name}'")

            # Save the frame annotations if we have predictions
            if frame_predictions:
                # Merge logic:
                # 1. Keep annotations that are manual, or belong to other tracking IDs not in start_tracking_ids.
                # 2. For active tracking IDs that succeeded on this frame, update them if they exist, or append them.
                # 3. For active tracking IDs that did NOT succeed (lost on this frame), they are excluded (deleted).
                merged_rich_anns = []
                for ann in next_rich_anns:
                    tid = ann.get("tracking_id")
                    if (ann.get("source") == AnnotationSource.MANUAL or 
                        ann.get("propagation_state") == PropagationState.MANUAL or 
                        tid not in start_tracking_ids):
                        merged_rich_anns.append(ann)
                        
                for tracker, box, conf in frame_predictions:
                    existing_ann = None
                    for ann in merged_rich_anns:
                        if ann.get("tracking_id") == tracker.tracking_id:
                            existing_ann = ann
                            break
                            
                    if existing_ann:
                        existing_ann["bbox"] = box
                        existing_ann["confidence"] = round(conf, 4)
                        existing_ann["source"] = tracker.source
                        existing_ann["propagation_state"] = tracker.propagation_state
                        existing_ann["tracker"] = tracker.tracker_type
                        existing_ann["timestamp"] = float(time.time())
                    else:
                        merged_rich_anns.append({
                            "id": tracker.ann_id,
                            "tracking_id": tracker.tracking_id,
                            "label": tracker.label,
                            "bbox": box,
                            "source": tracker.source,
                            "created_by": "tracker",
                            "tracker": tracker.tracker_type,
                            "tracker_version": "5.0",
                            "propagation_state": tracker.propagation_state,
                            "confidence": round(conf, 4),
                            "session_id": session_id,
                            "timestamp": float(time.time()),
                            "propagated_from": start_frame
                        })
                    
                logger.info(f"Stage 9: Saving {len(frame_predictions)} predictions to '{next_frame_name}'")
                video_service.save_annotations_for_frame(video_id, next_frame_name, merged_rich_anns)
                frames_propagated += 1
            else:
                # If no trackers succeeded on this frame
                stop_reason = StopReason.ALL_OBJECTS_LOST
                failure_frame = next_frame_name
                break
                
        # Loop finished naturally (end of video)
        if not stop_reason:
            stop_reason = StopReason.END_OF_VIDEO
            failure_frame = None

        # Verify metadata consistency before deleting backups
        logger.info("Verifying metadata consistency after propagation run...")
        consistency_ok = video_service.verify_and_repair_metadata(video_id)
        if not consistency_ok:
            raise RuntimeError("Consistency check failed after annotation propagation. Triggering rollback.")
            
        # Commit: Cleanup backup directory safely handling Windows file locking locks
        try:
            for _ in range(3):
                try:
                    if backup_dir.exists():
                        shutil.rmtree(backup_dir)
                    break
                except Exception:
                    time.sleep(0.1)
            else:
                if backup_dir.exists():
                    shutil.rmtree(backup_dir, ignore_errors=True)
        except Exception as cleanup_err:
            logger.warning(f"Failed to cleanup backup directory {backup_dir}: {cleanup_err}")
            
        # Cleanup parent backups folder if empty
        try:
            parent_backup = backup_dir.parent
            if parent_backup.exists() and not os.listdir(parent_backup):
                os.rmdir(parent_backup)
        except Exception:
            pass

        logger.info(f"Propagation session '{session_id}' completed successfully. Frames propagated: {frames_propagated}, Stop reason: {stop_reason}")
        return {
            "frames_propagated": frames_propagated,
            "stop_reason": stop_reason,
            "failure_frame": failure_frame,
            "objects_tracked": len(start_annotations),
            "session_id": session_id,
            "history": tracking_history
        }
        
    except Exception as err:
        logger.exception(f"Exception encountered during propagation loop: {err}")
        rollback_triggered = True
        
        # Rollback metadata file
        if metadata_path.exists():
            os.remove(metadata_path)
        if backup_metadata_path.exists():
            shutil.copy2(backup_metadata_path, metadata_path)
            
        # Rollback labels directory
        if labels_dir.exists():
            shutil.rmtree(labels_dir)
        os.makedirs(labels_dir, exist_ok=True)
        if backup_labels_dir.exists():
            for item in os.listdir(backup_labels_dir):
                shutil.copy2(backup_labels_dir / item, labels_dir / item)
                
        # Clean up backup directories
        try:
            shutil.rmtree(backup_dir)
            parent_backup = backup_dir.parent
            if parent_backup.exists() and not os.listdir(parent_backup):
                os.rmdir(parent_backup)
        except Exception:
            pass
            
        return {
            "frames_propagated": 0,
            "stop_reason": StopReason.ERROR,
            "failure_frame": start_frame,
            "objects_tracked": 0,
            "session_id": session_id,
            "error_detail": str(err),
            "history": tracking_history
        }
