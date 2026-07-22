import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent  # e:\NIOT project
STORAGE_DIR = BASE_DIR / "storage"
CLASSES_FILE = STORAGE_DIR / "classes.json"
DETECTION_STORAGE_DIR = STORAGE_DIR / "detections"
MODELS_DIR = STORAGE_DIR / "models"

# Ensure storage directories exist
os.makedirs(STORAGE_DIR, exist_ok=True)
os.makedirs(DETECTION_STORAGE_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# Emergency maximum frame gap before forcing a key-frame
EMERGENCY_MAX_GAP = 100

# Configuration mapping for Hybrid Adaptive Key Frame Extraction Motion Profiles
# composite_threshold: the threshold value the weighted score must exceed to trigger a key-frame
# weights: the relative importance of pixel difference, HSV histogram, and SSIM metrics (should sum to 1.0)
PROFILE_CONFIGS = {
    "Very Fast": {
        "description": "Extremely high sensitivity. Captures minute details. Best for rapidly moving fish or highly dynamic environments.",
        "composite_threshold": 0.015,
        "weights": {
            "pixel": 0.30,
            "histogram": 0.30,
            "ssim": 0.40
        }
    },
    "Fast": {
        "description": "High sensitivity. Captures active movements. Best for active marine life and general exploration.",
        "composite_threshold": 0.035,
        "weights": {
            "pixel": 0.30,
            "histogram": 0.30,
            "ssim": 0.40
        }
    },
    "Moderate": {
        "description": "Balanced sensitivity. Recommended for most subsea videos.",
        "composite_threshold": 0.075,
        "weights": {
            "pixel": 0.30,
            "histogram": 0.30,
            "ssim": 0.40
        }
    },
    "Slow": {
        "description": "Low sensitivity. Ignores minor changes. Best for seabed scanning or coral reef monitoring.",
        "composite_threshold": 0.150,
        "weights": {
            "pixel": 0.20,
            "histogram": 0.30,
            "ssim": 0.50
        }
    },
    "Very Slow": {
        "description": "Very low sensitivity. Only major transitions. Best for static cameras or stationary underwater structures.",
        "composite_threshold": 0.300,
        "weights": {
            "pixel": 0.20,
            "histogram": 0.30,
            "ssim": 0.50
        }
    }
}

# Object Tracking Configurations
TRACKING_DEFAULT_METHOD = "CSRT"          # Default tracker type
TRACKING_CONFIDENCE_THRESHOLD = 0.15      # Min match score to continue tracking (adjusted for underwater light/water distortion)
TRACKING_TEMPLATE_UPDATE_THRESHOLD = 0.75 # Score above which we update the reference template patch to handle rotation/scale
TRACKING_IOU_THRESHOLD = 0.3              # Overlap threshold for YOLO fallback matching


