import time
import os
import shutil
import json
import torch
from pathlib import Path
from ultralytics import YOLO

if __name__ == '__main__':
    print("=== Step 4 & 5: Executing Real YOLOv8 Training ===")
    device = '0' if torch.cuda.is_available() else 'cpu'
    print(f"CUDA Available: {torch.cuda.is_available()} | Device: {device}")
    if torch.cuda.is_available():
        print(f"GPU Name: {torch.cuda.get_device_name(0)}")

    start_train_time = time.time()

    model = YOLO('yolov8n.pt')
    results = model.train(
        data='datasets/underwater_dataset/data.yaml',
        epochs=50,
        imgsz=416,
        batch=16,
        workers=0,
        cache='ram',
        device=device,
        val=False,
        project='runs',
        name='underwater_train',
        exist_ok=True,
        verbose=True
    )

    elapsed_time = time.time() - start_train_time
    mins = int(elapsed_time // 60)
    secs = int(elapsed_time % 60)
    duration_str = f"{mins}m {secs}s"

    print("\n=== Step 6 & 7: Model Saving & Official Evaluation ===")
    save_dir = Path(results.save_dir)
    best_pt = save_dir / 'weights' / 'best.pt'
    results_csv = save_dir / 'results.csv'
    models_dir = Path('storage/models')
    os.makedirs(models_dir, exist_ok=True)

    target_pt = models_dir / 'underwater_best.pt'
    target_csv = models_dir / 'results.csv'

    if best_pt.exists():
        shutil.copy2(best_pt, target_pt)
        print(f"✓ Saved best weights to {target_pt}")

    if results_csv.exists():
        shutil.copy2(results_csv, target_csv)
        print(f"✓ Saved results log to {target_csv}")

    # Official validation evaluation on val dataset split
    print("\nEvaluating final model accuracy on validation split...")
    val_model = YOLO(str(target_pt))
    val_res = val_model.val(data='datasets/underwater_dataset/data.yaml', imgsz=416, device=device)

    map50 = round(float(val_res.box.map50) * 100, 2)
    map50_95 = round(float(val_res.box.map) * 100, 2)
    precision = round(float(val_res.box.mp) * 100, 2)
    recall = round(float(val_res.box.mr) * 100, 2)

    metrics_summary = {
        "model_name": "underwater_best.pt",
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "training_duration": duration_str,
        "epochs_completed": 50,
        "map50": map50,
        "map50_95": map50_95,
        "precision": precision,
        "recall": recall,
        "total_images": 636,
        "num_classes": 10,
        "class_names": ['fish', 'fat fish', 'lengthy white fish', 'rock', 'shrimp', 'transparent fish', 'red shrimp', 'danger fish', 'silver fish', 'black fish']
    }

    metrics_json_path = models_dir / 'metrics.json'
    with open(metrics_json_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_summary, f, indent=2)

    print("\n================ FINAL EXECUTION REPORT ================")
    print(f"Dataset Total Images: {metrics_summary['total_images']} (508 Train, 128 Val)")
    print(f"Training Duration:    {duration_str}")
    print(f"Precision:            {precision}%")
    print(f"Recall:               {recall}%")
    print(f"mAP50:                {map50}%")
    print(f"mAP50-95:             {map50_95}%")
    print(f"Saved Model Path:     {target_pt.resolve()}")
    print(f"Model File Size:      {round(target_pt.stat().st_size / (1024*1024), 2)} MB")
    print(f"GPU Used:             {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}")
    print(f"Training Status:      COMPLETED SUCCESSFULLY")
    print("=======================================================")
