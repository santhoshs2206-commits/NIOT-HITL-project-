import os
import uuid
import shutil
import threading
import logging
import cv2
from pathlib import Path
from typing import Dict, List, Any, Optional
from app.config import DETECTION_STORAGE_DIR
from app.services.model_loader import model_loader
from app.services.video_processor import video_processor

logger = logging.getLogger("underwater-hitl-backend")

class DetectionService:
    def __init__(self):
        self.uploads_dir = DETECTION_STORAGE_DIR / "uploads"
        self.jobs_dir = DETECTION_STORAGE_DIR / "jobs"
        os.makedirs(self.uploads_dir, exist_ok=True)
        os.makedirs(self.jobs_dir, exist_ok=True)

        # In-memory registry for jobs: job_id -> status_dict
        self._jobs: Dict[str, Dict[str, Any]] = {}

    def handle_video_upload(self, file_name: str, file_bytes: bytes) -> Dict[str, Any]:
        upload_id = f"upload_{uuid.uuid4().hex[:8]}"
        file_ext = Path(file_name).suffix.lower() or ".mp4"
        saved_filename = f"{upload_id}{file_ext}"
        saved_path = self.uploads_dir / saved_filename

        with open(saved_path, "wb") as f:
            f.write(file_bytes)

        # Probe video using OpenCV
        cap = cv2.VideoCapture(str(saved_path))
        if not cap.isOpened():
            raise ValueError(f"Invalid video file or unsupported format: {file_name}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
        duration_sec = total_frames / fps if fps > 0 else 0.0

        cap.release()

        mins = int(duration_sec // 60)
        secs = int(duration_sec % 60)
        duration_str = f"{mins:02d}:{secs:02d}"
        filesize_mb = round(len(file_bytes) / (1024 * 1024), 2)

        metadata = {
            "upload_id": upload_id,
            "filename": file_name,
            "saved_path": str(saved_path),
            "duration": duration_str,
            "duration_sec": round(duration_sec, 2),
            "resolution": f"{width}x{height}",
            "width": width,
            "height": height,
            "fps": round(fps, 2),
            "total_frames": total_frames,
            "filesize": f"{filesize_mb} MB",
            "filesize_mb": filesize_mb
        }

        return metadata

    def start_detection_job(self, upload_id: str, saved_path_str: str, settings: Dict[str, Any]) -> str:
        job_id = f"job_{uuid.uuid4().hex[:8]}"
        job_output_dir = self.jobs_dir / job_id
        os.makedirs(job_output_dir, exist_ok=True)

        model_name = settings.get("model_name", "underwater_best.pt")
        model_info = model_loader.get_model_info(model_name)

        # Initialize job state
        self._jobs[job_id] = {
            "job_id": job_id,
            "upload_id": upload_id,
            "status": "processing",
            "current_stage": "Loading Model...",
            "current_frame": 0,
            "total_frames": 100,
            "fps": 0.0,
            "eta_seconds": 0,
            "output_dir": str(job_output_dir),
            "results": None,
            "error": None
        }

        input_video_path = Path(saved_path_str)

        def update_cb(status_dict: Dict[str, Any]):
            if job_id in self._jobs:
                self._jobs[job_id].update(status_dict)

        def worker():
            try:
                video_processor.process_video_job(
                    job_id=job_id,
                    input_video_path=input_video_path,
                    output_dir=job_output_dir,
                    settings=settings,
                    model_info=model_info,
                    update_status_cb=update_cb
                )
            except Exception as e:
                logger.error(f"Error executing detection job {job_id}: {e}", exc_info=True)
                self._jobs[job_id].update({
                    "status": "failed",
                    "error": str(e)
                })

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

        return job_id

    def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._jobs.get(job_id)

    def get_job_results(self, job_id: str) -> Optional[Dict[str, Any]]:
        job = self._jobs.get(job_id)
        if job and job.get("results"):
            return job["results"]
        
        # Check disk if server restarted
        job_output_dir = self.jobs_dir / job_id
        json_path = job_output_dir / "results.json"
        if json_path.exists():
            import json
            with open(json_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    def get_job_file_path(self, job_id: str, filename: str) -> Optional[Path]:
        job_output_dir = self.jobs_dir / job_id
        file_path = job_output_dir / filename
        if file_path.exists():
            return file_path
        return None

detection_service = DetectionService()
