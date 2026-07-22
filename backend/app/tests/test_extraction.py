import pytest
import numpy as np
import cv2
import json
from unittest.mock import MagicMock, patch
from app.services.keyframe_selector import calculate_ssim, HybridAdaptiveKeyFrameSelector
from app.services import video_service
from app.config import PROFILE_CONFIGS, EMERGENCY_MAX_GAP

def test_calculate_ssim_identical():
    # Create dummy grayscale images
    img1 = np.ones((100, 100), dtype=np.uint8) * 128
    img2 = np.ones((100, 100), dtype=np.uint8) * 128
    
    ssim = calculate_ssim(img1, img2)
    assert abs(ssim - 1.0) < 1e-4

def test_calculate_ssim_different():
    img1 = np.ones((100, 100), dtype=np.uint8) * 128
    img2 = np.ones((100, 100), dtype=np.uint8) * 0  # Black image
    
    ssim = calculate_ssim(img1, img2)
    assert ssim < 0.5  # Structurally different

def test_selector_first_frame():
    weights = {"pixel": 0.3, "histogram": 0.3, "ssim": 0.4}
    selector = HybridAdaptiveKeyFrameSelector(
        composite_threshold=0.075,
        weights=weights,
        emergency_max_gap=10
    )
    
    dummy_frame = np.random.randint(0, 256, (240, 320, 3), dtype=np.uint8)
    
    should_extract, reason, metrics = selector.should_extract(1, dummy_frame, is_last_frame=False)
    
    assert should_extract is True
    assert reason == "first_frame"
    assert metrics["composite_score"] == 0.0

def test_selector_emergency_gap():
    weights = {"pixel": 0.3, "histogram": 0.3, "ssim": 0.4}
    selector = HybridAdaptiveKeyFrameSelector(
        composite_threshold=0.9,  # High threshold
        weights=weights,
        emergency_max_gap=5
    )
    
    frame1 = np.ones((240, 320, 3), dtype=np.uint8) * 100
    selector.should_extract(1, frame1, is_last_frame=False)
    
    # Identical frames from index 2 to 5 should not trigger motion threshold
    for i in range(2, 6):
        should_extract, reason, _ = selector.should_extract(i, frame1, is_last_frame=False)
        assert should_extract is False
        
    # Frame 6 triggers the emergency gap since 6 - 1 = 5
    should_extract, reason, _ = selector.should_extract(6, frame1, is_last_frame=False)
    assert should_extract is True
    assert reason == "emergency_gap"

def test_selector_motion_threshold():
    weights = {"pixel": 0.5, "histogram": 0.5, "ssim": 0.0}
    # Low threshold to trigger on motion
    selector = HybridAdaptiveKeyFrameSelector(
        composite_threshold=0.05,
        weights=weights,
        emergency_max_gap=100
    )
    
    # First frame (black)
    frame1 = np.zeros((240, 320, 3), dtype=np.uint8)
    selector.should_extract(1, frame1, is_last_frame=False)
    
    # Second frame (white), should trigger motion threshold
    frame2 = np.ones((240, 320, 3), dtype=np.uint8) * 255
    should_extract, reason, metrics = selector.should_extract(2, frame2, is_last_frame=False)
    
    assert should_extract is True
    assert reason == "motion_threshold"
    assert metrics["composite_score"] > 0.05

def test_selector_last_frame():
    weights = {"pixel": 0.3, "histogram": 0.3, "ssim": 0.4}
    selector = HybridAdaptiveKeyFrameSelector(
        composite_threshold=0.9,  # High threshold
        weights=weights,
        emergency_max_gap=100
    )
    
    frame = np.ones((240, 320, 3), dtype=np.uint8) * 128
    selector.should_extract(1, frame, is_last_frame=False)
    
    # Frame 2 is identical, but is_last_frame is True
    should_extract, reason, _ = selector.should_extract(2, frame, is_last_frame=True)
    
    assert should_extract is True
    assert reason == "last_frame"

@patch('app.services.video_service.cv2.VideoCapture')
@patch('app.services.video_service.cv2.imwrite')
@patch('app.services.video_service.STORAGE_DIR')
def test_extract_frames_for_video_service(mock_storage_dir, mock_imwrite, mock_videocapture, tmp_path):
    video_id = "vid_001"
    video_dir = tmp_path / video_id
    images_dir = video_dir / "images"
    labels_dir = video_dir / "labels"
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)
    
    # Create mock video file
    video_file = video_dir / "video.mp4"
    video_file.write_text("dummy content")
    
    # Mock STORAGE_DIR checks
    mock_storage_dir.exists.return_value = True
    mock_storage_dir.__truediv__.side_effect = lambda x: tmp_path / x if x == video_id else tmp_path
    
    # Mock video capture reading 3 frames
    mock_cap = MagicMock()
    mock_videocapture.return_value = mock_cap
    mock_cap.isOpened.return_value = True
    
    mock_cap.get.side_effect = lambda prop: {
        cv2.CAP_PROP_FRAME_WIDTH: 640.0,
        cv2.CAP_PROP_FRAME_HEIGHT: 480.0,
        cv2.CAP_PROP_FPS: 30.0,
        cv2.CAP_PROP_FRAME_COUNT: 3.0
    }.get(prop, 0.0)
    
    # Frame BGR data
    frame_bgr = np.zeros((480, 640, 3), dtype=np.uint8)
    
    # Frame 1, Frame 2, Frame 3, EOF
    mock_cap.read.side_effect = [
        (True, frame_bgr),
        (True, frame_bgr),
        (True, frame_bgr),
        (False, None)
    ]
    
    mock_imwrite.return_value = True
    
    # Execute extraction service call
    result = video_service.extract_frames_for_video(video_id, "Moderate")
    
    assert result["video_id"] == video_id
    assert result["frames_extracted"] == 2  # Frame 1 (first) and Frame 3 (last)
    assert result["original_total_frames"] == 3
    assert result["status"] == "annotating"
    assert result["motion_profile"] == "Moderate"
    assert "extraction_summary" in result
    
    summary = result["extraction_summary"]
    assert summary["reduction_ratio"] == 1.5
    assert summary["trigger_reasons"]["first_frame"] == 1
    assert summary["trigger_reasons"]["last_frame"] == 1
