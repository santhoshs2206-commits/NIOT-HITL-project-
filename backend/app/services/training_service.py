import os
import shutil
import random
import json
import logging
import threading
import time
from pathlib import Path
from typing import Dict, List, Any, Optional

from app.config import BASE_DIR, STORAGE_DIR, MODELS_DIR

logger = logging.getLogger("underwater-hitl-backend.training_service")

# Path for exported YOLO dataset
DATASETS_DIR = BASE_DIR / "datasets"
YOLO_DATASET_DIR = DATASETS_DIR / "underwater_dataset"

class TrainingService:
    def __init__(self):
        self.dataset_dir = YOLO_DATASET_DIR
        self._current_job: Dict[str, Any] = {
            "status": "idle",  # idle, exporting, readiness_checked, training, completed, failed
            "epoch": 0,
            "total_epochs": 100,
            "loss": 0.0,
            "map50": 0.0,
            "precision": 0.0,
            "recall": 0.0,
            "eta_seconds": 0,
            "eta_formatted": "--",
            "message": "System ready for dataset export and YOLOv8 training.",
            "readiness": {
                "images_exist": False,
                "labels_exist": False,
                "no_skipped_frames": True,
                "matching_labels": False,
                "is_ready": False,
                "total_exported": 0,
                "train_count": 0,
                "val_count": 0,
                "num_classes": 0,
                "class_names": []
            },
            "error": None
        }
        self._stop_requested = False
        self._training_thread: Optional[threading.Thread] = None

    def get_all_training_datasets(self) -> List[Dict[str, Any]]:
        """
        Discovers and returns status & metrics for every available video dataset in storage.
        Used by the YOLO Training Page to populate dataset cards and target selection dropdown.
        """
        datasets = []
        classes_json_path = STORAGE_DIR / "classes.json"
        all_class_names = []
        if classes_json_path.exists():
            try:
                with open(classes_json_path, "r", encoding="utf-8") as f:
                    c_map = json.load(f)
                    all_class_names = list(c_map.keys())
            except Exception as e:
                logger.warning(f"Failed to read classes.json: {e}")

        for vid_folder in sorted(STORAGE_DIR.iterdir(), key=lambda p: p.name):
            if not vid_folder.is_dir() or vid_folder.name in ["models", "detections"]:
                continue

            video_id = vid_folder.name
            images_dir = vid_folder / "images"
            labels_dir = vid_folder / "labels"
            meta_path = vid_folder / "metadata.json"

            if not images_dir.exists():
                continue

            meta = {}
            if meta_path.exists():
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                except Exception as e:
                    logger.warning(f"Failed to load metadata for {video_id}: {e}")

            filename = meta.get("filename", f"{video_id}.mp4")
            total_frames = meta.get("total_frames", len(list(images_dir.glob("*.jpg"))))
            skipped_frames = meta.get("skipped_frames", [])
            effective_total = max(1, total_frames - len(skipped_frames))

            annotated_count = 0
            if labels_dir.exists():
                txt_files = list(labels_dir.glob("*.txt"))
                annotated_count = len([f for f in txt_files if f.stat().st_size > 0])

            class_names = meta.get("class_names", all_class_names or ["Fish"])
            num_classes = len(class_names) if class_names else 1

            completion_rate = min(100.0, round((annotated_count / effective_total) * 100, 1))

            status_str = meta.get("dataset_status")
            if not status_str:
                if completion_rate >= 100.0:
                    status_str = "FULLY_ANNOTATED"
                elif annotated_count > 0:
                    status_str = "READY_FOR_TRAINING"
                else:
                    status_str = "IN_PROGRESS"

            prev_trained = meta.get("previously_trained_frames", 0)
            remaining_frames = max(0, effective_total - annotated_count)
            last_updated = meta.get("last_finalized", meta.get("created_at", "Recently"))

            datasets.append({
                "video_id": video_id,
                "filename": filename,
                "dataset_status": status_str,
                "total_frames": total_frames,
                "effective_total_frames": effective_total,
                "annotated_frames": annotated_count,
                "remaining_frames": remaining_frames,
                "completion_rate": completion_rate,
                "previously_trained_frames": prev_trained,
                "num_classes": num_classes,
                "class_names": class_names,
                "last_updated": last_updated
            })

        return datasets

    def export_yolo_dataset(self, video_id: Optional[str] = None, split_ratio: float = 0.8) -> Dict[str, Any]:
        """
        Exports annotated, non-skipped frames into standard YOLO format:
        datasets/underwater_dataset/images/{train,val}
        datasets/underwater_dataset/labels/{train,val}
        data.yaml
        Runs dataset readiness validation checks for the specified video_id (or all datasets).
        """
        target_id_str = video_id if (video_id and video_id.lower() not in ["all", ""]) else "All Datasets"
        self._current_job["status"] = "exporting"
        self._current_job["target_video_id"] = target_id_str
        self._current_job["message"] = f"Exporting dataset for '{target_id_str}' and generating data.yaml..."

        try:
            # 1. Clean / prepare directory structure
            images_train = self.dataset_dir / "images" / "train"
            images_val = self.dataset_dir / "images" / "val"
            labels_train = self.dataset_dir / "labels" / "train"
            labels_val = self.dataset_dir / "labels" / "val"

            if self.dataset_dir.exists():
                shutil.rmtree(self.dataset_dir)

            os.makedirs(images_train, exist_ok=True)
            os.makedirs(images_val, exist_ok=True)
            os.makedirs(labels_train, exist_ok=True)
            os.makedirs(labels_val, exist_ok=True)

            # 2. Gather class names from storage/classes.json
            classes_json_path = STORAGE_DIR / "classes.json"
            class_map = {}
            if classes_json_path.exists():
                try:
                    with open(classes_json_path, "r", encoding="utf-8") as f:
                        class_map = json.load(f)
                except Exception as e:
                    logger.warning(f"Failed to read storage/classes.json: {e}")

            # Collect exported candidates across target storage subdirectories
            candidates = []
            total_extracted = 0

            for vid_folder in STORAGE_DIR.iterdir():
                if not vid_folder.is_dir() or vid_folder.name in ["models", "detections"]:
                    continue

                if video_id and video_id.lower() not in ["all", ""] and vid_folder.name != video_id:
                    continue

                images_dir = vid_folder / "images"
                labels_dir = vid_folder / "labels"
                meta_path = vid_folder / "metadata.json"

                if not images_dir.exists() or not labels_dir.exists():
                    continue

                skipped_frames = set()
                if meta_path.exists():
                    try:
                        with open(meta_path, "r", encoding="utf-8") as f:
                            meta = json.load(f)
                            skipped_frames = set(meta.get("skipped_frames", []))
                            total_extracted += meta.get("total_frames", 0)
                    except Exception as e:
                        logger.warning(f"Failed to load metadata for {vid_folder.name}: {e}")

                # Find valid image-label pairs
                for img_file in images_dir.glob("*.jpg"):
                    frame_name = img_file.name
                    stem = img_file.stem

                    if frame_name in skipped_frames or stem in skipped_frames:
                        continue

                    label_file = labels_dir / f"{stem}.txt"
                    if label_file.exists() and label_file.stat().st_size > 0:
                        candidates.append({
                            "video_id": vid_folder.name,
                            "img_path": img_file,
                            "label_path": label_file,
                            "stem": stem,
                            "name": frame_name
                        })

            total_exported = len(candidates)
            if total_exported == 0:
                raise ValueError(f"No valid annotated, non-skipped frame-label pairs were found for dataset '{target_id_str}'.")

            # 3. Shuffle with fixed seed for reproducible train/val split
            random.seed(42)
            random.shuffle(candidates)

            train_cutoff = int(total_exported * split_ratio)
            train_items = candidates[:train_cutoff]
            val_items = candidates[train_cutoff:]

            for idx, item in enumerate(train_items):
                dest_img_name = f"{item['video_id']}_{item['name']}"
                dest_label_name = f"{item['video_id']}_{item['stem']}.txt"
                shutil.copy2(item["img_path"], images_train / dest_img_name)
                shutil.copy2(item["label_path"], labels_train / dest_label_name)

            for idx, item in enumerate(val_items):
                dest_img_name = f"{item['video_id']}_{item['name']}"
                dest_label_name = f"{item['video_id']}_{item['stem']}.txt"
                shutil.copy2(item["img_path"], images_val / dest_img_name)
                shutil.copy2(item["label_path"], labels_val / dest_label_name)

            if class_map:
                sorted_classes = sorted(class_map.items(), key=lambda x: x[1])
                class_names = [name for name, _ in sorted_classes]
            else:
                class_names = ["Fish", "Rock", "Pipe", "Coral"]

            yaml_path = self.dataset_dir / "data.yaml"
            yaml_content = f"""path: {self.dataset_dir.as_posix()}
train: images/train
val: images/val
nc: {len(class_names)}
names:
"""
            for name in class_names:
                yaml_content += f"  - \"{name}\"\n"

            with open(yaml_path, "w", encoding="utf-8") as f:
                f.write(yaml_content)

            images_exist_check = (len(list(images_train.glob("*.jpg"))) + len(list(images_val.glob("*.jpg")))) == total_exported
            labels_exist_check = (len(list(labels_train.glob("*.txt"))) + len(list(labels_val.glob("*.txt")))) == total_exported
            matching_labels_check = images_exist_check and labels_exist_check
            yaml_generated_check = yaml_path.exists()
            train_val_split_check = len(train_items) > 0 and len(val_items) > 0

            is_ready = images_exist_check and labels_exist_check and yaml_generated_check and train_val_split_check and (len(class_names) >= 1)

            readiness_info = {
                "target_video_id": target_id_str,
                "images_exist": images_exist_check,
                "labels_exist": labels_exist_check,
                "no_skipped_frames": True,
                "matching_labels": matching_labels_check,
                "yaml_generated": yaml_generated_check,
                "train_val_split": train_val_split_check,
                "is_ready": is_ready,
                "total_exported": total_exported,
                "train_count": len(train_items),
                "val_count": len(val_items),
                "extracted_frames": total_extracted,
                "num_classes": len(class_names),
                "class_names": class_names,
                "last_updated": time.strftime("%H:%M:%S")
            }

            self._current_job.update({
                "status": "readiness_checked" if is_ready else "idle",
                "target_video_id": target_id_str,
                "message": f"Successfully exported {total_exported} frames for '{target_id_str}' ({len(train_items)} train, {len(val_items)} val). Dataset ready for YOLOv8 training.",
                "readiness": readiness_info,
                "error": None
            })

            return self._current_job

        except Exception as e:
            logger.error(f"Error during dataset export: {e}", exc_info=True)
            self._current_job.update({
                "status": "failed",
                "message": f"Export failed: {str(e)}",
                "error": str(e)
            })
            raise

    def finalize_dataset(self, video_id: str) -> Dict[str, Any]:
        """
        Finalizes currently annotated frames for video_id, marking dataset state as READY_FOR_TRAINING.
        Connects Annotation Workspace -> YOLO Training pipeline.
        """
        vid_folder = STORAGE_DIR / video_id
        if not vid_folder.exists() or not vid_folder.is_dir():
            raise FileNotFoundError(f"Video folder for {video_id} does not exist.")

        images_dir = vid_folder / "images"
        labels_dir = vid_folder / "labels"
        meta_path = vid_folder / "metadata.json"

        annotated_count = 0
        total_frames = 0
        skipped_frames = []

        if meta_path.exists():
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    total_frames = meta.get("total_frames", 0)
                    skipped_frames = meta.get("skipped_frames", [])
            except Exception as e:
                logger.warning(f"Failed to read metadata for {video_id}: {e}")

        if labels_dir.exists():
            annotated_count = len([f for f in labels_dir.glob("*.txt") if f.stat().st_size > 0])

        effective_total = max(1, total_frames - len(skipped_frames))
        status_str = "READY_FOR_TRAINING" if annotated_count > 0 else "IN_PROGRESS"
        if annotated_count >= effective_total:
            status_str = "FULLY_ANNOTATED"

        # Update metadata.json with finalized dataset tracking fields
        meta_data = {}
        if meta_path.exists():
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta_data = json.load(f)
            except Exception:
                meta_data = {}

        meta_data.update({
            "training_ready_frames": annotated_count,
            "dataset_status": status_str,
            "last_finalized": time.strftime("%Y-%m-%d %H:%M:%S")
        })

        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta_data, f, indent=2)

        logger.info(f"Finalized dataset for '{video_id}': {annotated_count} frames marked as {status_str}")

        return {
            "video_id": video_id,
            "total_frames": total_frames,
            "annotated_frames": annotated_count,
            "training_ready_frames": annotated_count,
            "remaining_frames": max(0, effective_total - annotated_count),
            "dataset_status": status_str,
            "message": f"Successfully finalized {annotated_count} annotated frames for {video_id}. Ready for training!"
        }

    def start_training(self, video_id: Optional[str] = None, mode: str = "scratch", epochs: int = 100, batch: int = 8, imgsz: int = 640) -> Dict[str, Any]:
        """
        Launches YOLOv8 background training job with support for Transfer Learning / Continued Training.
        mode: "scratch" (train from base yolov8n.pt) or "continue" (transfer learning from previous weights)
        """
        if self._current_job["status"] == "training":
            return self._current_job

        target_id_str = video_id if (video_id and video_id.lower() not in ["all", ""]) else "All Datasets"
        yaml_path = self.dataset_dir / "data.yaml"

        # 1. Export or prepare dataset for target_id_str
        try:
            logger.info(f"=== [START TRAINING INIT] Selected Dataset: '{target_id_str}' | Mode: {mode.upper()} ===")
            self.export_yolo_dataset(video_id=video_id)
        except Exception as export_err:
            logger.error(f"Dataset export failed for '{target_id_str}': {export_err}", exc_info=True)
            self._current_job.update({
                "status": "failed",
                "target_video_id": target_id_str,
                "message": f"Training halted: Dataset export failed ({str(export_err)})",
                "error": str(export_err)
            })
            return self._current_job

        # 2. Verify data.yaml actually exists before calling worker
        if not yaml_path.exists():
            err_msg = f"Dataset configuration file data.yaml was not found at '{yaml_path.as_posix()}'. Training cannot proceed."
            logger.error(err_msg)
            self._current_job.update({
                "status": "failed",
                "target_video_id": target_id_str,
                "message": f"Training halted: {err_msg}",
                "error": err_msg
            })
            return self._current_job

        self._stop_requested = False
        self._current_job.update({
            "status": "training",
            "target_video_id": target_id_str,
            "training_mode": mode,
            "epoch": 0,
            "total_epochs": epochs,
            "loss": 0.0,
            "map50": 0.0,
            "precision": 0.0,
            "recall": 0.0,
            "eta_seconds": 0,
            "eta_formatted": "Calculating...",
            "message": f"Initializing YOLOv8 model weights for '{target_id_str}' (Mode: {mode.upper()})...",
            "error": None
        })

        def worker():
            start_time = time.time()
            try:
                from ultralytics import YOLO
                import torch

                device = "0" if torch.cuda.is_available() else "cpu"

                # Select base model weights based on mode
                existing_weights = MODELS_DIR / "underwater_best.pt"
                if mode == "continue" and existing_weights.exists():
                    weights_used = str(existing_weights.as_posix())
                    logger.info(f"Transfer Learning mode: Loading existing weights from {weights_used}")
                    model = YOLO(weights_used)
                else:
                    weights_used = "yolov8n.pt"
                    logger.info("Scratch mode: Loading base yolov8n.pt weights")
                    model = YOLO("yolov8n.pt")

                # Structured Debug Logging as requested by user
                logger.info("=" * 60)
                logger.info(f"Selected Dataset: {target_id_str}")
                logger.info(f"Export Directory: {self.dataset_dir.as_posix()}")
                logger.info(f"Generated data.yaml: {yaml_path.as_posix()}")
                logger.info(f"yaml_path value: {str(yaml_path)}")
                logger.info(f"Model weights used: {weights_used}")
                logger.info(f"Training command: model.train(data='{yaml_path.as_posix()}', epochs={epochs}, batch={batch}, imgsz={imgsz}, device='{device}')")
                logger.info("Starting YOLOv8...")
                logger.info("=" * 60)

                def on_fit_epoch_end(trainer):
                    if self._stop_requested:
                        raise KeyboardInterrupt("Training stopped by user request.")

                    epoch = trainer.epoch + 1
                    total_epochs = trainer.epochs

                    metrics = getattr(trainer, "metrics", {}) or {}
                    loss_items = getattr(trainer, "loss_items", None)

                    loss_val = 0.0
                    if loss_items is not None and len(loss_items) > 0:
                        loss_val = round(float(sum(loss_items)), 4)

                    map50_val = round(float(metrics.get("metrics/mAP50(B)", 0.0)) * 100, 1)
                    prec_val = round(float(metrics.get("metrics/precision(B)", 0.0)) * 100, 1)
                    rec_val = round(float(metrics.get("metrics/recall(B)", 0.0)) * 100, 1)

                    elapsed = time.time() - start_time
                    if epoch > 0:
                        avg_sec_per_epoch = elapsed / epoch
                        rem_epochs = max(0, total_epochs - epoch)
                        eta_sec = int(avg_sec_per_epoch * rem_epochs)
                        mins = eta_sec // 60
                        secs = eta_sec % 60
                        eta_str = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"
                    else:
                        eta_sec = 0
                        eta_str = "Calculating..."

                    self._current_job.update({
                        "epoch": epoch,
                        "total_epochs": total_epochs,
                        "loss": loss_val,
                        "map50": map50_val,
                        "precision": prec_val,
                        "recall": rec_val,
                        "eta_seconds": eta_sec,
                        "eta_formatted": eta_str,
                        "message": f"Training Epoch {epoch}/{total_epochs} ({mode.upper()} mode) in progress..."
                    })

                model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

                results = model.train(
                    data=str(yaml_path),
                    epochs=epochs,
                    batch=batch,
                    imgsz=imgsz,
                    device=device,
                    workers=0,
                    project=str(BASE_DIR / "runs"),
                    name="underwater_train",
                    exist_ok=True,
                    verbose=False
                )

                os.makedirs(MODELS_DIR, exist_ok=True)
                best_weights = Path(results.save_dir) / "weights" / "best.pt"
                target_model_path = MODELS_DIR / "underwater_best.pt"

                if best_weights.exists():
                    shutil.copy2(best_weights, target_model_path)
                    logger.info(f"Successfully copied trained weights to {target_model_path}")
                else:
                    last_weights = Path(results.save_dir) / "weights" / "last.pt"
                    if last_weights.exists():
                        shutil.copy2(last_weights, target_model_path)

                # Update dataset_status to PARTIALLY_TRAINED or FULLY_TRAINED for target video
                target_vid = self._current_job.get("target_video_id")
                if target_vid and target_vid != "All Datasets":
                    v_meta_p = STORAGE_DIR / target_vid / "metadata.json"
                    if v_meta_p.exists():
                        try:
                            with open(v_meta_p, "r", encoding="utf-8") as f:
                                v_m = json.load(f)
                            v_m["dataset_status"] = "PARTIALLY_TRAINED"
                            v_m["previously_trained_frames"] = self._current_job["readiness"].get("total_exported", 0)
                            with open(v_meta_p, "w", encoding="utf-8") as f:
                                json.dump(v_m, f, indent=2)
                        except Exception as e:
                            logger.warning(f"Failed to update dataset_status for {target_vid}: {e}")

                metrics_summary = {
                    "model_name": "underwater_best.pt",
                    "training_mode": mode,
                    "target_video_id": target_vid,
                    "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "epochs_completed": epochs,
                    "final_loss": self._current_job.get("loss", 0.0),
                    "map50": self._current_job.get("map50", 0.0),
                    "precision": self._current_job.get("precision", 0.0),
                    "recall": self._current_job.get("recall", 0.0),
                    "total_images": self._current_job["readiness"].get("total_exported", 0),
                    "num_classes": self._current_job["readiness"].get("num_classes", 0),
                    "class_names": self._current_job["readiness"].get("class_names", [])
                }

                with open(MODELS_DIR / "metrics.json", "w", encoding="utf-8") as f:
                    json.dump(metrics_summary, f, indent=2)

                self._current_job.update({
                    "status": "completed",
                    "epoch": epochs,
                    "eta_seconds": 0,
                    "eta_formatted": "0s",
                    "message": f"Training Completed successfully! ({mode.upper()} mode) Model saved to storage/models/underwater_best.pt",
                    "error": None
                })

            except Exception as e:
                logger.error(f"Error during YOLOv8 training: {e}", exc_info=True)
                self._current_job.update({
                    "status": "failed",
                    "message": f"Training failed: {str(e)}",
                    "error": str(e)
                })

        self._training_thread = threading.Thread(target=worker, daemon=True)
        self._training_thread.start()

        return self._current_job

    def get_status(self, video_id: Optional[str] = None) -> Dict[str, Any]:
        """Returns current training status and readiness checklist for video_id (or active video)."""
        try:
            import torch
            device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU (Auto Detected)"
        except Exception:
            device_name = "CPU (Auto Detected)"

        self._current_job["device"] = device_name
        
        # If target video_id specified and job is idle, dynamically compute dataset summary for video_id
        if video_id and self._current_job["status"] == "idle":
            try:
                vid_folder = STORAGE_DIR / video_id
                if vid_folder.exists() and vid_folder.is_dir():
                    images_dir = vid_folder / "images"
                    labels_dir = vid_folder / "labels"
                    meta_path = vid_folder / "metadata.json"
                    
                    ann_count = 0
                    ext_count = 0
                    prev_trained = 0
                    d_status = "IN_PROGRESS"
                    
                    if images_dir.exists() and labels_dir.exists():
                        ann_count = len([f for f in labels_dir.glob("*.txt") if f.stat().st_size > 0])
                    if meta_path.exists():
                        with open(meta_path, "r", encoding="utf-8") as f:
                            meta = json.load(f)
                            ext_count = meta.get("total_frames", len(list(images_dir.glob("*.jpg"))) if images_dir.exists() else 0)
                            prev_trained = meta.get("previously_trained_frames", 0)
                            d_status = meta.get("dataset_status", "READY_FOR_TRAINING" if ann_count > 0 else "IN_PROGRESS")
                            
                    train_cnt = int(ann_count * 0.8)
                    val_cnt = ann_count - train_cnt
                    new_frames = max(0, ann_count - prev_trained)
                    
                    self._current_job["target_video_id"] = video_id
                    self._current_job["readiness"] = {
                        "target_video_id": video_id,
                        "images_exist": ann_count > 0,
                        "labels_exist": ann_count > 0,
                        "no_skipped_frames": True,
                        "matching_labels": ann_count > 0,
                        "yaml_generated": (self.dataset_dir / "data.yaml").exists(),
                        "train_val_split": train_cnt > 0 and val_cnt > 0,
                        "is_ready": ann_count > 0,
                        "total_exported": ann_count,
                        "train_count": train_cnt,
                        "val_count": val_cnt,
                        "extracted_frames": ext_count,
                        "previously_trained_frames": prev_trained,
                        "new_annotated_frames": new_frames,
                        "dataset_status": d_status,
                        "num_classes": self._current_job.get("readiness", {}).get("num_classes", 1),
                        "class_names": self._current_job.get("readiness", {}).get("class_names", []),
                        "last_updated": time.strftime("%H:%M:%S")
                    }
            except Exception as e:
                logger.warning(f"Failed to compute dynamic readiness for {video_id}: {e}")

        return self._current_job

training_service = TrainingService()
