import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent  # e:\NIOT project
STORAGE_DIR = BASE_DIR / "storage"
CLASSES_FILE = STORAGE_DIR / "classes.json"

# Ensure storage directory exists
os.makedirs(STORAGE_DIR, exist_ok=True)
