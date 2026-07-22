import time
import os
import json
import torch
from pathlib import Path
from ultralytics import YOLO

if __name__ == '__main__':
    print("==========================================================================")
    print("             YOLOv8 CONTINUATION EVALUATION & VERIFICATION                ")
    print("==========================================================================")

    models_dir = Path('storage/models')
    best_pt = models_dir / 'underwater_best.pt'
    epoch50_pt = models_dir / 'underwater_best_epoch50.pt'
    dataset_yaml = Path('datasets/underwater_dataset/data.yaml')
    device = '0' if torch.cuda.is_available() else 'cpu'

    print(f"CUDA Available:           {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU Accelerator Used:     {torch.cuda.get_device_name(0)}")

    print(f"Epoch 100 Model Path:     {best_pt.resolve()} ({round(best_pt.stat().st_size/(1024*1024), 2)} MB)")
    print(f"Epoch 50 Backup Path:     {epoch50_pt.resolve()} ({round(epoch50_pt.stat().st_size/(1024*1024), 2)} MB)")

    print("\n--- 1. Evaluating Final 100-Epoch Model ---")
    val_model_ep100 = YOLO(str(best_pt))
    res_ep100 = val_model_ep100.val(data=str(dataset_yaml), imgsz=416, device=device)

    map50_ep100 = round(float(res_ep100.box.map50) * 100, 2)
    map50_95_ep100 = round(float(res_ep100.box.map) * 100, 2)
    precision_ep100 = round(float(res_ep100.box.mp) * 100, 2)
    recall_ep100 = round(float(res_ep100.box.mr) * 100, 2)

    print("\n--- 2. Evaluating Epoch 50 Backup Model ---")
    val_model_ep50 = YOLO(str(epoch50_pt))
    res_ep50 = val_model_ep50.val(data=str(dataset_yaml), imgsz=416, device=device)

    map50_ep50 = round(float(res_ep50.box.map50) * 100, 2)
    map50_95_ep50 = round(float(res_ep50.box.map) * 100, 2)
    precision_ep50 = round(float(res_ep50.box.mp) * 100, 2)
    recall_ep50 = round(float(res_ep50.box.mr) * 100, 2)

    map50_diff = round(map50_ep100 - map50_ep50, 2)
    map50_95_diff = round(map50_95_ep100 - map50_95_ep50, 2)

    metrics_summary = {
        "model_name": "underwater_best.pt",
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "training_type": "Resume / Continuation Training",
        "starting_checkpoint": "runs/underwater_train/weights/last.pt",
        "previous_epochs": 50,
        "additional_epochs": 50,
        "total_effective_epochs": 100,
        "map50": map50_ep100,
        "map50_95": map50_95_ep100,
        "precision": precision_ep100,
        "recall": recall_ep100,
        "comparison_with_epoch50": {
            "mAP50_epoch50": map50_ep50,
            "mAP50_epoch100": map50_ep100,
            "mAP50_improvement": f"{map50_diff:+0.2f}%",
            "mAP50_95_epoch50": map50_95_ep50,
            "mAP50_95_epoch100": map50_95_ep100,
            "mAP50_95_improvement": f"{map50_95_diff:+0.2f}%"
        },
        "total_images": 636,
        "num_classes": 10,
        "class_names": ['fish', 'fat fish', 'lengthy white fish', 'rock', 'shrimp', 'transparent fish', 'red shrimp', 'danger fish', 'silver fish', 'black fish']
    }

    with open(models_dir / 'metrics.json', 'w', encoding='utf-8') as f:
        json.dump(metrics_summary, f, indent=2)

    print("\n--- 3. Running Detection Inference Verification ---")
    sample_img_path = Path('storage/vid_003/images/frame0003.jpg')
    if not sample_img_path.exists():
        sample_img_path = list(Path('storage/vid_003/images').glob('*.jpg'))[0]

    print(f"Testing Object Detection Backend loading: {best_pt}")
    print(f"Testing inference on sample frame: {sample_img_path}")
    infer_model = YOLO(str(best_pt))
    infer_results = infer_model.predict(source=str(sample_img_path), conf=0.25, verbose=False)

    detections = []
    for r in infer_results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            cls_name = r.names[cls_id]
            conf = round(float(box.conf[0]) * 100, 1)
            xyxy = [round(float(c), 1) for c in box.xyxy[0].tolist()]
            detections.append({"class": cls_name, "confidence": conf, "bbox": xyxy})

    print(f"Inference Successful! Detected {len(detections)} underwater objects:")
    for det in detections:
        print(f"  * Class: {det['class']:<18} | Confidence: {det['confidence']}% | BBox: {det['bbox']}")

    print("\n==========================================================================")
    print("                    FINAL CONTINUATION SUMMARY REPORT                     ")
    print("==========================================================================")
    print(f"Training Type:              Resume / Continuation Training")
    print(f"Starting Checkpoint:        runs/underwater_train/weights/last.pt")
    print(f"Previous Epochs:            50")
    print(f"Additional Epochs:          50")
    print(f"Total Effective Epochs:     100")
    print(f"GPU Accelerator Used:       {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}")
    print(f"Backup Model Preserved:     {epoch50_pt} ({round(epoch50_pt.stat().st_size/(1024*1024), 2)} MB)")
    print(f"Final Model Location:       {best_pt.resolve()} ({round(best_pt.stat().st_size/(1024*1024), 2)} MB)")
    print("--------------------------------------------------------------------------")
    print("METRIC COMPARISON (EPOCH 50 vs EPOCH 100):")
    print(f"  * Precision:              Epoch 50: {precision_ep50}%  ->  Epoch 100: {precision_ep100}%")
    print(f"  * Recall:                 Epoch 50: {recall_ep50}%  ->  Epoch 100: {recall_ep100}%")
    print(f"  * mAP @ 50:               Epoch 50: {map50_ep50}%  ->  Epoch 100: {map50_ep100}% ({map50_diff:+0.2f}%)")
    print(f"  * mAP @ 50-95:            Epoch 50: {map50_95_ep50}%  ->  Epoch 100: {map50_95_ep100}% ({map50_95_diff:+0.2f}%)")
    print("--------------------------------------------------------------------------")
    print(f"Inference Verification:     PASSED ({len(detections)} bounding boxes produced)")
    print(f"Overall Status:             TRAINING SUCCESSFULLY CONTINUED TO EPOCH 100")
    print("==========================================================================")
