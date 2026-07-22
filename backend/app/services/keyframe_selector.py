import cv2
import numpy as np
import logging

logger = logging.getLogger("underwater-hitl-backend.keyframe_selector")

def calculate_ssim(img1: np.ndarray, img2: np.ndarray) -> float:
    """
    Computes a fast approximation of the Structural Similarity Index (SSIM)
    between two grayscale images using OpenCV Gaussian filters.
    """
    C1 = 6.5025
    C2 = 58.5225

    I1 = img1.astype(np.float32)
    I2 = img2.astype(np.float32)

    # Means using Gaussian blur
    mu1 = cv2.GaussianBlur(I1, (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(I2, (11, 11), 1.5)

    mu1_sq = mu1 ** 2
    mu2_sq = mu2 ** 2
    mu1_mu2 = mu1 * mu2

    # Variances and Covariance
    sigma1_sq = cv2.GaussianBlur(I1 * I1, (11, 11), 1.5) - mu1_sq
    sigma2_sq = cv2.GaussianBlur(I2 * I2, (11, 11), 1.5) - mu2_sq
    sigma12 = cv2.GaussianBlur(I1 * I2, (11, 11), 1.5) - mu1_mu2

    # SSIM formula
    num = (2 * mu1_mu2 + C1) * (2 * sigma12 + C2)
    den = (mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2)

    ssim_map = num / den
    return float(np.mean(ssim_map))

class HybridAdaptiveKeyFrameSelector:
    """
    Evaluates video frames sequentially to adaptively select keyframes based on motion features:
    - Grayscale pixel difference
    - 2D HSV histogram comparison (Bhattacharyya distance)
    - Structural Similarity Index (SSIM)
    
    Includes First frame, Last frame, and Emergency maximum gap safeguards.
    """
    def __init__(self, composite_threshold: float, weights: dict, emergency_max_gap: int):
        self.composite_threshold = composite_threshold
        self.weights = weights
        self.emergency_max_gap = emergency_max_gap

        # Reference keyframe states
        self.last_keyframe_gray = None
        self.last_keyframe_hsv = None
        self.last_keyframe_idx = -1

        # Metric tracking across all analyzed frames (for statistics summary)
        self.scores = []
        self.pixel_diffs = []
        self.hist_diffs = []
        self.ssim_diffs = []

        # Tracking extraction trigger reasons
        self.trigger_reasons = {
            "first_frame": 0,
            "motion_threshold": 0,
            "emergency_gap": 0,
            "last_frame": 0
        }

    def should_extract(self, frame_idx: int, frame: np.ndarray, is_last_frame: bool) -> tuple[bool, str, dict]:
        """
        Determines if the current frame should be extracted as a keyframe.
        
        Args:
            frame_idx (int): 1-based index of the current frame in the video stream.
            frame (np.ndarray): The current frame image in BGR format.
            is_last_frame (bool): Flag indicating if this is the final frame of the video.
            
        Returns:
            should_extract (bool): True if the frame should be saved as a keyframe.
            reason (str): The rule triggering extraction (first_frame, motion_threshold, emergency_gap, last_frame, or "").
            metrics (dict): Dict of calculated metrics for this frame.
        """
        # Downscale frame for analysis to ensure high performance
        h, w = frame.shape[:2]
        target_w = 320
        target_h = int(h * (target_w / w))
        small_frame = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)

        # Convert colorspace
        gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(small_frame, cv2.COLOR_BGR2HSV)

        # First frame safeguard
        if self.last_keyframe_gray is None:
            self.last_keyframe_gray = gray
            self.last_keyframe_hsv = hsv
            self.last_keyframe_idx = frame_idx
            self.trigger_reasons["first_frame"] += 1
            metrics = {
                "pixel_diff": 0.0,
                "hist_diff": 0.0,
                "ssim_diff": 0.0,
                "composite_score": 0.0
            }
            return True, "first_frame", metrics

        # 1. Grayscale Pixel Difference
        diff = cv2.absdiff(gray, self.last_keyframe_gray)
        pixel_diff = float(np.mean(diff) / 255.0)

        # 2. HSV Histogram Comparison (using Bhattacharyya distance)
        # Calculate 2D histogram for H & S channels (H: 30 bins, S: 32 bins)
        hist_curr = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(hist_curr, hist_curr, 1.0, 0.0, cv2.NORM_L1)

        hist_last = cv2.calcHist([self.last_keyframe_hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(hist_last, hist_last, 1.0, 0.0, cv2.NORM_L1)

        hist_diff = float(cv2.compareHist(hist_curr, hist_last, cv2.HISTCMP_BHATTACHARYYA))

        # 3. SSIM Difference (1.0 - SSIM)
        ssim_val = calculate_ssim(gray, self.last_keyframe_gray)
        ssim_diff = max(0.0, min(1.0, 1.0 - ssim_val))

        # 4. Composite Decision Score
        w_pixel = self.weights.get("pixel", 0.30)
        w_hist = self.weights.get("histogram", 0.30)
        w_ssim = self.weights.get("ssim", 0.40)

        composite_score = (w_pixel * pixel_diff) + (w_hist * hist_diff) + (w_ssim * ssim_diff)

        # Record metrics for statistical analysis
        self.scores.append(composite_score)
        self.pixel_diffs.append(pixel_diff)
        self.hist_diffs.append(hist_diff)
        self.ssim_diffs.append(ssim_diff)

        metrics = {
            "pixel_diff": pixel_diff,
            "hist_diff": hist_diff,
            "ssim_diff": ssim_diff,
            "composite_score": composite_score
        }

        should_extract = False
        reason = ""

        # Check safeguards and threshold
        if is_last_frame:
            should_extract = True
            reason = "last_frame"
        elif frame_idx - self.last_keyframe_idx >= self.emergency_max_gap:
            should_extract = True
            reason = "emergency_gap"
        elif composite_score >= self.composite_threshold:
            should_extract = True
            reason = "motion_threshold"

        if should_extract:
            self.last_keyframe_gray = gray
            self.last_keyframe_hsv = hsv
            self.last_keyframe_idx = frame_idx
            self.trigger_reasons[reason] += 1

        return should_extract, reason, metrics

    def get_summary_statistics(self) -> dict:
        """
        Returns average metrics and counts of trigger reasons.
        """
        avg_score = float(np.mean(self.scores)) if self.scores else 0.0
        avg_pixel = float(np.mean(self.pixel_diffs)) if self.pixel_diffs else 0.0
        avg_hist = float(np.mean(self.hist_diffs)) if self.hist_diffs else 0.0
        avg_ssim = float(np.mean(self.ssim_diffs)) if self.ssim_diffs else 0.0

        return {
            "average_composite_score": avg_score,
            "pixel_diff_avg": avg_pixel,
            "hist_diff_avg": avg_hist,
            "ssim_diff_avg": avg_ssim,
            "trigger_reasons": self.trigger_reasons
        }
