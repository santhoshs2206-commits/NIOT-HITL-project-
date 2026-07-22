import os
import json
import shutil
import pytest
import numpy as np
import cv2
from unittest.mock import MagicMock, patch

from app.config import (
    TRACKING_CONFIDENCE_THRESHOLD,
    TRACKING_TEMPLATE_UPDATE_THRESHOLD,
    TRACKING_IOU_THRESHOLD,
)
from app.services import video_service
from app.services.tracking_service import (
    StopReason,
    AnnotationSource,
    PropagationState,
    TrackerFactory,
    ObjectTracker,
    compute_confidence,
    get_next_tracking_id,
    validate_bbox,
    propagate_annotations,
)

# Mock OpenCV Tracker
class MockCVTracker:
    def __init__(self, success=True, init_bbox=None, update_bbox=None, bbox=None):
        self.success = success
        self.init_bbox = init_bbox
        # Set update_bbox, falling back to bbox parameter if present
        self.update_bbox = update_bbox if update_bbox is not None else bbox
        if self.update_bbox is None and bbox is None:
            self.update_bbox = (15, 25, 20, 30)

    def init(self, image, bbox):
        self.init_bbox = bbox

    def update(self, image):
        # Use update_bbox if set, otherwise fallback to init_bbox
        bbox = self.update_bbox if self.update_bbox is not None else self.init_bbox
        return self.success, bbox


def test_validate_bbox():
    # Valid box
    assert validate_bbox([10, 20, 30, 40], 100, 100) == [10, 20, 30, 40]
    # Out of bounds clamping
    assert validate_bbox([-10, -5, 120, 110], 100, 100) == [0, 0, 100, 100]
    # Zero area / negative size
    assert validate_bbox([30, 30, 20, 20], 100, 100) is None
    # Invalid length
    assert validate_bbox([10, 20, 30], 100, 100) is None


def test_compute_confidence():
    # Match identical patches with noise to ensure non-zero variance
    np.random.seed(42)
    patch_img = np.random.randint(0, 255, (50, 50, 3), dtype=np.uint8)
    template_img = patch_img.copy()
    
    score = compute_confidence(patch_img, template_img)
    assert abs(score - 1.0) < 1e-4

    # Different random patches
    different_patch = np.random.randint(0, 255, (50, 50, 3), dtype=np.uint8)
    score_diff = compute_confidence(different_patch, template_img)
    assert score_diff < 0.5


@patch('app.services.tracking_service.TrackerFactory.create_tracker')
def test_object_tracker_lifecycle(mock_create):
    mock_tracker = MockCVTracker(success=True, update_bbox=(15, 25, 20, 30))
    mock_create.return_value = (mock_tracker, "MIL")

    frame = np.ones((100, 100, 3), dtype=np.uint8) * 128
    # Start box [10, 20, 30, 50] (w=20, h=30)
    tracker = ObjectTracker("MIL", frame, [10, 20, 30, 50], "fish", "fish_001")

    assert tracker.label == "fish"
    assert tracker.tracking_id == "fish_001"
    assert tracker.last_bbox == [10, 20, 30, 50]

    # Mock template matching for update
    with patch('app.services.tracking_service.compute_confidence') as mock_conf:
        mock_conf.return_value = 0.95  # Above update threshold (0.90)
        success, bbox, conf, template_updated = tracker.update(frame)
        
        assert success is True
        assert bbox == [15, 25, 35, 55]  # xmin=15, ymin=25, xmax=15+20=35, ymax=25+30=55
        assert conf == 0.95
        # Template should have updated (check mock_conf was called)
        assert mock_conf.called


@patch('app.services.tracking_service.TrackerFactory.create_tracker')
def test_object_tracker_template_no_update(mock_create):
    mock_tracker = MockCVTracker(success=True, update_bbox=(15, 25, 20, 30))
    mock_create.return_value = (mock_tracker, "MIL")

    frame = np.ones((100, 100, 3), dtype=np.uint8) * 128
    tracker = ObjectTracker("MIL", frame, [10, 20, 30, 50], "fish", "fish_001")

    # Mock template matching to be below update threshold (0.90) but above tracking threshold (0.60)
    with patch('app.services.tracking_service.compute_confidence') as mock_conf:
        mock_conf.return_value = 0.80
        # Save current template reference
        old_template = tracker.template.copy()
        
        success, bbox, conf, template_updated = tracker.update(frame)
        assert success is True
        assert conf == 0.80
        # Template should NOT have updated, so it should be equal to old template
        assert np.array_equal(tracker.template, old_template)


@patch('app.services.video_service.get_annotations_metadata')
def test_get_next_tracking_id(mock_get_meta):
    # Mock existing annotations
    mock_get_meta.return_value = {
        "frames": {
            "frame0001.jpg": [
                {"label": "fish", "tracking_id": "fish_001"},
                {"label": "coral", "tracking_id": "coral_001"}
            ],
            "frame0002.jpg": [
                {"label": "fish", "tracking_id": "fish_002"}
            ]
        }
    }
    
    assert get_next_tracking_id("vid_001", "fish") == "fish_003"
    assert get_next_tracking_id("vid_001", "coral") == "coral_002"
    assert get_next_tracking_id("vid_001", "shark") == "shark_001"


@patch('app.services.video_service.get_frames_for_video')
@patch('app.services.video_service.get_annotations_for_frame')
@patch('app.services.video_service.get_annotations_metadata')
@patch('app.services.video_service.save_annotations_for_frame')
@patch('app.services.video_service.get_frame_path')
@patch('app.services.video_service.verify_and_repair_metadata')
@patch('app.services.tracking_service.TrackerFactory.create_tracker')
@patch('cv2.imread')
def test_propagate_annotations_until_lost(
    mock_imread, mock_create, mock_verify, mock_get_path, mock_save, mock_get_meta, mock_get_anns, mock_get_frames, tmp_path
):
    video_id = "vid_001"
    video_dir = tmp_path / video_id
    video_dir.mkdir(parents=True, exist_ok=True)
    (video_dir / "labels").mkdir(exist_ok=True)

    # Set up global storage dir patch to use our temp path
    with patch('app.services.tracking_service.STORAGE_DIR', tmp_path), \
         patch('app.services.video_service.STORAGE_DIR', tmp_path):

        # Mock frame list
        mock_get_frames.return_value = {
            "frames": [
                {"name": "frame0001.jpg", "annotated": True},
                {"name": "frame0002.jpg", "annotated": False},
                {"name": "frame0003.jpg", "annotated": False}
            ]
        }

        # Mock starting annotations
        mock_get_anns.return_value = [
            {"label": "fish", "bbox": [10, 10, 30, 30]}
        ]

        mock_get_meta.return_value = {
            "frames": {
                "frame0001.jpg": [
                    {"label": "fish", "bbox": [10, 10, 30, 30], "tracking_id": "fish_001"}
                ]
            }
        }

        # Mock imread to return a dummy image (height=100, width=100)
        mock_imread.return_value = np.ones((100, 100, 3), dtype=np.uint8) * 128

        # Mock cv tracker to succeed on frame 2 and fail on frame 3
        mock_tracker = MockCVTracker(success=True, bbox=(12, 12, 20, 20))
        mock_create.return_value = (mock_tracker, "MIL")

        mock_verify.return_value = True

        # Run propagation
        result = propagate_annotations(video_id, "frame0001.jpg", mode="until_lost", tracker_type="MIL")

        assert result["frames_propagated"] == 2
        assert result["stop_reason"] == StopReason.END_OF_VIDEO
        assert result["failure_frame"] is None
        assert result["objects_tracked"] == 1
        assert mock_save.call_count >= 2  # Saves on frame0001 (re-save with track_id) and frame0002, frame0003


@patch('app.services.video_service.get_frames_for_video')
@patch('app.services.video_service.get_annotations_for_frame')
@patch('app.services.video_service.get_annotations_metadata')
@patch('app.services.video_service.save_annotations_for_frame')
@patch('app.services.video_service.get_frame_path')
@patch('app.services.video_service.verify_and_repair_metadata')
@patch('app.services.tracking_service.TrackerFactory.create_tracker')
@patch('cv2.imread')
def test_propagate_annotations_limit_mode(
    mock_imread, mock_create, mock_verify, mock_get_path, mock_save, mock_get_meta, mock_get_anns, mock_get_frames, tmp_path
):
    video_id = "vid_001"
    video_dir = tmp_path / video_id
    video_dir.mkdir(parents=True, exist_ok=True)

    with patch('app.services.tracking_service.STORAGE_DIR', tmp_path), \
         patch('app.services.video_service.STORAGE_DIR', tmp_path):

        # Mock 5 frames
        mock_get_frames.return_value = {
            "frames": [
                {"name": "frame0001.jpg", "annotated": True},
                {"name": "frame0002.jpg", "annotated": False},
                {"name": "frame0003.jpg", "annotated": False},
                {"name": "frame0004.jpg", "annotated": False},
                {"name": "frame0005.jpg", "annotated": False}
            ]
        }

        mock_get_anns.return_value = [
            {"label": "fish", "bbox": [10, 10, 30, 30]}
        ]
        mock_get_meta.return_value = {}

        mock_imread.return_value = np.ones((100, 100, 3), dtype=np.uint8) * 128
        mock_create.return_value = (MockCVTracker(success=True, bbox=(12, 12, 20, 20)), "MIL")
        mock_verify.return_value = True

        # Run with limit = 2 frames
        result = propagate_annotations(video_id, "frame0001.jpg", mode="2", tracker_type="MIL")

        # Reached frame limit (propagates to frame 2 and frame 3, stops before frame 4)
        assert result["frames_propagated"] == 2
        assert result["stop_reason"] == StopReason.FRAME_LIMIT
        assert result["failure_frame"] == "frame0004.jpg"


@patch('app.services.video_service.get_frames_for_video')
@patch('app.services.video_service.get_annotations_for_frame')
@patch('app.services.video_service.get_annotations_metadata')
@patch('app.services.video_service.save_annotations_for_frame')
@patch('app.services.video_service.get_frame_path')
@patch('app.services.video_service.verify_and_repair_metadata')
@patch('app.services.tracking_service.TrackerFactory.create_tracker')
@patch('cv2.imread')
def test_propagate_consumes_manual_annotations(
    mock_imread, mock_create, mock_verify, mock_get_path, mock_save, mock_get_meta, mock_get_anns, mock_get_frames, tmp_path
):
    video_id = "vid_001"
    video_dir = tmp_path / video_id
    video_dir.mkdir(parents=True, exist_ok=True)

    with patch('app.services.tracking_service.STORAGE_DIR', tmp_path), \
         patch('app.services.video_service.STORAGE_DIR', tmp_path):

        mock_get_frames.return_value = {
            "frames": [
                {"name": "frame0001.jpg", "annotated": True},
                {"name": "frame0002.jpg", "annotated": False},
                {"name": "frame0003.jpg", "annotated": True}
            ]
        }

        mock_get_anns.return_value = [
            {"label": "fish", "bbox": [10, 10, 30, 30]}
        ]

        # Get metadata calls.
        # First call: for starting frame.
        # Second call: for checking frame0002.
        # Third call: for checking frame0003 (contains manual annotation).
        mock_get_meta.side_effect = [
            # Startup
            {"frames": {"frame0001.jpg": [{"label": "fish", "bbox": [10, 10, 30, 30], "tracking_id": "fish_001"}]}},
            # Checking frame0002
            {"frames": {}},
            # Checking frame0003 (has manual annotation)
            {"frames": {"frame0003.jpg": [{"label": "fish", "bbox": [12, 12, 32, 32], "source": "manual", "created_by": "user"}]}}
        ]

        mock_imread.return_value = np.ones((100, 100, 3), dtype=np.uint8) * 128
        mock_create.return_value = (MockCVTracker(success=True, bbox=(12, 12, 20, 20)), "MIL")
        mock_verify.return_value = True

        result = propagate_annotations(video_id, "frame0001.jpg", mode="until_lost", tracker_type="MIL")

        # Now it propagates all the way to frame0003, consuming the manual annotation
        assert result["frames_propagated"] == 2
        assert result["stop_reason"] == StopReason.END_OF_VIDEO
        assert result["failure_frame"] is None


@patch('app.services.video_service.get_frames_for_video')
@patch('app.services.video_service.get_annotations_for_frame')
@patch('app.services.video_service.get_annotations_metadata')
@patch('app.services.video_service.save_annotations_for_frame')
@patch('app.services.video_service.get_frame_path')
@patch('app.services.video_service.verify_and_repair_metadata')
@patch('app.services.tracking_service.TrackerFactory.create_tracker')
@patch('cv2.imread')
def test_propagation_rollback_on_failure(
    mock_imread, mock_create, mock_verify, mock_get_path, mock_save, mock_get_meta, mock_get_anns, mock_get_frames, tmp_path
):
    video_id = "vid_001"
    video_dir = tmp_path / video_id
    video_dir.mkdir(parents=True, exist_ok=True)
    labels_dir = video_dir / "labels"
    labels_dir.mkdir(exist_ok=True)
    
    # Write pre-existing labels on disk
    (labels_dir / "frame0001.txt").write_text("0 0.5 0.5 0.2 0.2")
    (labels_dir / "frame0002.txt").write_text("0 0.5 0.5 0.2 0.2")
    
    # Write metadata
    metadata_file = video_dir / "annotations_metadata.json"
    metadata_file.write_text(json.dumps({"video_id": video_id, "frames": {"frame0001.jpg": []}}))

    with patch('app.services.tracking_service.STORAGE_DIR', tmp_path), \
         patch('app.services.video_service.STORAGE_DIR', tmp_path):

        mock_get_frames.return_value = {
            "frames": [
                {"name": "frame0001.jpg", "annotated": True},
                {"name": "frame0002.jpg", "annotated": True},
                {"name": "frame0003.jpg", "annotated": False}
            ]
        }

        mock_get_anns.return_value = [
            {"label": "fish", "bbox": [10, 10, 30, 30]}
        ]
        
        mock_get_meta.return_value = {"frames": {"frame0001.jpg": []}}

        mock_imread.return_value = np.ones((100, 100, 3), dtype=np.uint8) * 128
        
        # Mock tracker updates successfully on frame 2, then throws error on frame 3
        mock_tracker = MagicMock()
        mock_tracker.update.side_effect = [
            (True, (11, 11, 20, 20)),
            Exception("Simulated tracking crash!")
        ]
        mock_create.return_value = (mock_tracker, "MIL")

        result = propagate_annotations(video_id, "frame0001.jpg", mode="until_lost", tracker_type="MIL")

        # Should rollback completely
        assert result["stop_reason"] == StopReason.ERROR
        assert result["frames_propagated"] == 0
        
        # Verify backups deleted and original content restored
        assert not (video_dir / "_propagation_backups").exists()
        assert metadata_file.exists()
        assert (labels_dir / "frame0002.txt").read_text() == "0 0.5 0.5 0.2 0.2"


@patch('app.services.video_service.CLASSES_FILE')
def test_verify_and_repair_metadata(mock_classes_file, tmp_path):
    video_id = "vid_001"
    video_dir = tmp_path / video_id
    video_dir.mkdir(parents=True, exist_ok=True)
    labels_dir = video_dir / "labels"
    labels_dir.mkdir(exist_ok=True)
    images_dir = video_dir / "images"
    images_dir.mkdir(exist_ok=True)

    # Mock classes.json
    classes_path = tmp_path / "classes.json"
    classes_path.write_text(json.dumps({"fish": 0}))
    mock_classes_file.exists.return_value = True
    mock_classes_file.parent = tmp_path
    mock_classes_file.__str__.return_value = str(classes_path)

    # 1. Setup metadata.json
    metadata_json = {
        "video_id": video_id,
        "frame_width": 100,
        "frame_height": 100,
        "total_frames": 2,
        "annotated_frames": 0,
        "status": "annotating"
    }
    with open(video_dir / "metadata.json", "w") as f:
        json.dump(metadata_json, f, indent=2)

    # 2. Setup annotations_metadata.json with a frame annotation
    annotations_metadata = {
        "video_id": video_id,
        "frames": {
            "frame0001.jpg": [
                {"label": "fish", "bbox": [10, 20, 30, 40]}
            ]
        }
    }
    with open(video_dir / "annotations_metadata.json", "w") as f:
        json.dump(annotations_metadata, f, indent=2)

    # 3. Create dummy image files on disk
    (images_dir / "frame0001.jpg").touch()
    (images_dir / "frame0002.jpg").touch()

    # The label file on disk is missing for frame0001, so calling verify_and_repair_metadata should reconstruct it.
    with patch('app.services.video_service.STORAGE_DIR', tmp_path), \
         patch('app.services.video_service.CLASSES_FILE', classes_path):
         
        success = video_service.verify_and_repair_metadata(video_id)
        assert success is True

        # Check label file was reconstructed
        label_file = labels_dir / "frame0001.txt"
        assert label_file.exists()
        
        # Read reconstructed file content
        content = label_file.read_text().strip().split()
        assert content[0] == "0"  # class id
        # Normalized coordinates: x_center = (10+30)/2/100 = 0.20, y_center = (20+40)/2/100 = 0.30
        assert abs(float(content[1]) - 0.20) < 1e-3
        assert abs(float(content[2]) - 0.30) < 1e-3
        
        # Check metadata.json updated annotated_frames count
        with open(video_dir / "metadata.json", "r") as f:
            meta = json.load(f)
        assert meta["annotated_frames"] == 1
