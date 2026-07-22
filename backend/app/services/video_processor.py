import time
import os
import cv2
import numpy as np
import logging
from pathlib import Path
from typing import Dict, List, Any, Callable
from app.services.model_loader import model_loader, FallbackUnderwaterDetector
from app.services.result_exporter import result_exporter

logger = logging.getLogger("underwater-hitl-backend")

# Class BGR color mapping for bounding box rendering
CLASS_COLORS = {
    "fish": (255, 240, 0),       # Cyan / Bright Yellow
    "rock": (140, 140, 140),     # Gray / Slate
    "pipe": (0, 165, 255),       # Orange / Amber
    "coral": (180, 105, 255),    # Magenta / Violet
    "shrimp": (50, 205, 50),     # Emerald Green
    "default": (255, 240, 0)
}

def format_timestamp(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"

class VideoProcessor:
    def process_video_job(
        self,
        job_id: str,
        input_video_path: Path,
        output_dir: Path,
        settings: Dict[str, Any],
        model_info: Dict[str, Any],
        update_status_cb: Callable[[Dict[str, Any]], None]
    ):
        """
        Executes frame-by-frame object detection, bounding box rendering, video creation, and result exporting.
        """
        start_time = time.time()

        # Step 1: Stage: Loading Model
        update_status_cb({
            "status": "processing",
            "current_stage": "Loading Model...",
            "current_frame": 0,
            "total_frames": 100,
            "fps": 0.0,
            "eta_seconds": 0
        })

        model_name = settings.get("model_name", "underwater_best.pt")
        detector = model_loader.load_model(model_name)
        conf_thresh = float(settings.get("confidence_threshold", 0.25))
        iou_thresh = float(settings.get("iou_threshold", 0.45))
        max_det = int(settings.get("max_detections", 100))

        # Step 2: Stage: Reading Video
        update_status_cb({
            "status": "processing",
            "current_stage": "Reading Video...",
            "current_frame": 0,
            "total_frames": 100,
            "fps": 0.0,
            "eta_seconds": 0
        })

        cap = cv2.VideoCapture(str(input_video_path))
        if not cap.isOpened():
            update_status_cb({
                "status": "failed",
                "error": f"Failed to open video file: {input_video_path.name}"
            })
            return

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps_in = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
        duration_sec = total_frames / fps_in

        processed_video_path = output_dir / "processed.mp4"
        
        # Select OpenCV VideoWriter codec (try mp4v, fallback to avc1/XVID if needed)
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(str(processed_video_path), fourcc, fps_in, (width, height))

        # Metrics trackers
        frame_idx = 0
        all_frame_detections = []
        class_counts: Dict[str, int] = {}
        total_detections_count = 0
        total_confidence_sum = 0.0
        frames_with_objects_count = 0
        timeline_events = []

        last_status_update = 0.0

        # Step 3 & 4: Detection & Rendering Loop
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame_idx += 1
            current_time = time.time()

            # Run inference
            raw_detections = []
            if isinstance(detector, FallbackUnderwaterDetector):
                raw_detections = detector.predict(frame, conf_thresh, iou_thresh, max_det)
            else:
                # Ultralytics model predict call
                results = detector.predict(frame, conf=conf_thresh, iou=iou_thresh, max_det=max_det, verbose=False)
                if len(results) > 0:
                    res = results[0]
                    names = res.names
                    for box in res.boxes:
                        cls_id = int(box.cls[0].item())
                        cls_name = names.get(cls_id, f"Class_{cls_id}")
                        conf = float(box.conf[0].item())
                        xyxy = box.xyxy[0].cpu().numpy().tolist()
                        raw_detections.append({
                            "class": cls_name.capitalize(),
                            "confidence": round(conf, 2),
                            "bbox": [int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3])]
                        })

            if raw_detections:
                frames_with_objects_count += 1

            # Render bounding boxes onto frame
            rendered_frame = frame.copy()
            frame_dets_list = []

            for det in raw_detections:
                cls_name = det["class"]
                conf = det["confidence"]
                x_min, y_min, x_max, y_max = det["bbox"]

                total_detections_count += 1
                total_confidence_sum += conf
                class_counts[cls_name] = class_counts.get(cls_name, 0) + 1

                # Timeline logging (sample key events)
                if frame_idx % int(max(1, fps_in // 2)) == 0:
                    timestamp_str = format_timestamp(frame_idx / fps_in)
                    timeline_events.append({
                        "frame": frame_idx,
                        "timestamp": timestamp_str,
                        "timestamp_sec": round(frame_idx / fps_in, 2),
                        "label": cls_name,
                        "confidence": conf
                    })

                # Select color
                color = CLASS_COLORS.get(cls_name.lower(), CLASS_COLORS["default"])

                # Draw bounding box
                cv2.rectangle(rendered_frame, (x_min, y_min), (x_max, y_max), color, 2)

                # Draw label badge background & text
                label_str = f"{cls_name} {int(conf * 100)}%"
                (text_w, text_h), baseline = cv2.getTextSize(label_str, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                cv2.rectangle(
                    rendered_frame,
                    (x_min, max(0, y_min - text_h - 6)),
                    (x_min + text_w + 8, max(0, y_min)),
                    color,
                    -1
                )
                cv2.putText(
                    rendered_frame,
                    label_str,
                    (x_min + 4, max(text_h + 2, y_min - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (10, 15, 25),
                    1,
                    cv2.LINE_AA
                )

                frame_dets_list.append({
                    "class": cls_name,
                    "confidence": conf,
                    "bbox": [x_min, y_min, x_max, y_max]
                })

            out.write(rendered_frame)

            all_frame_detections.append({
                "frame": frame_idx,
                "timestamp": round(frame_idx / fps_in, 2),
                "detections": frame_dets_list
            })

            # Update live progress every ~15 frames or 0.2s
            if current_time - last_status_update > 0.2 or frame_idx == total_frames:
                elapsed = max(0.01, current_time - start_time)
                processing_fps = round(frame_idx / elapsed, 1)
                remaining_frames = max(0, total_frames - frame_idx)
                eta_sec = int(remaining_frames / processing_fps) if processing_fps > 0 else 0

                stage = "Running Detection..." if frame_idx < total_frames * 0.8 else "Drawing Bounding Boxes..."

                update_status_cb({
                    "status": "processing",
                    "current_stage": stage,
                    "current_frame": frame_idx,
                    "total_frames": total_frames,
                    "fps": processing_fps,
                    "eta_seconds": eta_sec
                })
                last_status_update = current_time

        cap.release()
        out.release()

        # Convert OpenCV output video to web-standard H.264 MP4 format for HTML5 video tag rendering
        try:
            import subprocess
            import imageio_ffmpeg
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
            h264_temp_path = output_dir / "processed_h264.mp4"
            cmd = [
                ffmpeg_exe, "-y",
                "-i", str(processed_video_path),
                "-c:v", "libx264",
                "-preset", "fast",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                str(h264_temp_path)
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0 and h264_temp_path.exists() and h264_temp_path.stat().st_size > 0:
                os.replace(h264_temp_path, processed_video_path)
                logger.info(f"Successfully converted processed video {processed_video_path.name} to web-standard H.264 format.")
        except Exception as conv_err:
            logger.warning(f"Could not convert video to H.264 with ffmpeg: {conv_err}")

        # Step 5: Stage: Saving Output Video & Exporting Reports
        update_status_cb({
            "status": "processing",
            "current_stage": "Saving Output Video...",
            "current_frame": total_frames,
            "total_frames": total_frames,
            "fps": round(total_frames / max(0.01, time.time() - start_time), 1),
            "eta_seconds": 0
        })

        total_elapsed = round(time.time() - start_time, 2)
        overall_processing_fps = round(total_frames / max(0.01, total_elapsed), 1)
        avg_confidence = round((total_confidence_sum / max(1, total_detections_count)) * 100, 1)
        detection_ratio_pct = round((frames_with_objects_count / max(1, total_frames)) * 100, 1)

        # Deduplicate timeline events to clean highlights
        cleaned_timeline = []
        seen_events = set()
        for evt in timeline_events:
            key = (evt["timestamp"], evt["label"])
            if key not in seen_events:
                seen_events.add(key)
                cleaned_timeline.append(evt)

        # Structure complete results data
        results_data = {
            "job_id": job_id,
            "video_metadata": {
                "filename": input_video_path.name,
                "resolution": f"{width}x{height}",
                "duration_sec": round(duration_sec, 2),
                "duration_str": format_timestamp(duration_sec),
                "fps": round(fps_in, 2),
                "total_frames": total_frames,
                "filesize_mb": round(input_video_path.stat().st_size / (1024 * 1024), 2)
            },
            "model_info": model_info,
            "settings": settings,
            "summary": {
                "total_detections": total_detections_count,
                "total_frames": total_frames,
                "frames_with_objects": frames_with_objects_count,
                "detection_ratio_pct": detection_ratio_pct,
                "average_confidence": avg_confidence,
                "processing_time_sec": total_elapsed,
                "processing_fps": overall_processing_fps,
                "class_counts": class_counts
            },
            "timeline": cleaned_timeline,
            "frame_detections": all_frame_detections
        }

        # Export result files
        json_path = output_dir / "results.json"
        csv_path = output_dir / "detections.csv"
        report_path = output_dir / "report.txt"

        result_exporter.export_json(json_path, results_data)
        result_exporter.export_csv(csv_path, all_frame_detections, fps_in)
        result_exporter.export_summary_report(report_path, results_data)

        # Step 6: Mark Completed
        update_status_cb({
            "status": "completed",
            "current_stage": "Completed",
            "current_frame": total_frames,
            "total_frames": total_frames,
            "fps": overall_processing_fps,
            "eta_seconds": 0,
            "results": results_data
        })

video_processor = VideoProcessor()
