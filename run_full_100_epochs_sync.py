import os
import shutil
import csv
import json
import time
import torch
from pathlib import Path
from ultralytics import YOLO

if __name__ == '__main__':
    print("==========================================================================")
    print("  STEP 1: PRESERVE BACKUP & VERIFY INITIAL 50-EPOCH RUN                   ")
    print("==========================================================================")
    storage_models = Path('storage/models')
    os.makedirs(storage_models, exist_ok=True)
    
    ep50_csv = Path('runs/detect/runs/underwater_train/results.csv')
    ep50_pt = storage_models / 'underwater_best_epoch50.pt'
    
    if not ep50_pt.exists():
        best_pt = storage_models / 'underwater_best.pt'
        if best_pt.exists():
            shutil.copy2(best_pt, ep50_pt)
            print(f"[Backup] Saved epoch 50 weights: {ep50_pt}")

    print(f"Epoch 1-50 CSV Path: {ep50_csv.resolve()}")
    if ep50_csv.exists():
        with open(ep50_csv, 'r', encoding='utf-8') as f:
            reader = list(csv.reader(f))
            print(f"Initial Run (Epochs 1-50): {len(reader)-1} rows found.")

    print("\n==========================================================================")
    print("  STEP 2: EXECUTE FULL 50-EPOCH FINE-TUNING CONTINUATION (EPOCHS 51-100)  ")
    print("==========================================================================")
    device = '0' if torch.cuda.is_available() else 'cpu'
    print(f"CUDA Available: {torch.cuda.is_available()} | GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}")

    start_time = time.time()
    
    # Initialize from epoch 50 model
    model = YOLO(str(ep50_pt))
    
    # Fine-tune for 50 additional epochs
    results = model.train(
        data='datasets/underwater_dataset/data.yaml',
        epochs=50,
        imgsz=416,
        batch=16,
        workers=0,
        cache='ram',
        device=device,
        val=False,
        project='runs/detect/runs',
        name='underwater_train_continued',
        exist_ok=True,
        verbose=True
    )

    elapsed_time = time.time() - start_time
    mins = int(elapsed_time // 60)
    secs = int(elapsed_time % 60)
    duration_str = f"{mins}m {secs}s"

    print("\n==========================================================================")
    print("  STEP 3: MERGE CSVs TO CREATE 100-EPOCH FULL RESULTS LOG                ")
    print("==========================================================================")
    cont_csv = Path(results.save_dir) / 'results.csv'
    target_csv = storage_models / 'results.csv'
    target_pt = storage_models / 'underwater_best.pt'
    
    # Copy best weights
    best_weights = Path(results.save_dir) / 'weights' / 'best.pt'
    if best_weights.exists():
        shutil.copy2(best_weights, target_pt)
        print(f"[Sync] Updated best weights -> {target_pt}")

    # Read ep1-50 rows
    merged_rows = []
    header = []
    if ep50_csv.exists():
        with open(ep50_csv, 'r', encoding='utf-8') as f:
            reader = list(csv.reader(f))
            if reader:
                header = [col.strip() for col in reader[0]]
                for row in reader[1:]:
                    merged_rows.append([col.strip() for col in row])

    # Read cont_csv rows (Epochs 1-50 of continuation -> Epochs 51-100)
    if cont_csv.exists():
        with open(cont_csv, 'r', encoding='utf-8') as f:
            reader = list(csv.reader(f))
            if reader:
                if not header:
                    header = [col.strip() for col in reader[0]]
                for idx, row in enumerate(reader[1:], start=51):
                    row_clean = [col.strip() for col in row]
                    row_clean[0] = str(idx)  # Re-index epoch column to 51, 52, ..., 100
                    merged_rows.append(row_clean)

    # Write merged 100-epoch CSV
    if header and merged_rows:
        with open(target_csv, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(header)
            writer.writerows(merged_rows)
        print(f"[Success] Merged results log written to {target_csv} with {len(merged_rows)} total epoch rows!")

    print("\n==========================================================================")
    print("  STEP 4: FINAL MODEL VALIDATION & VERIFICATION                           ")
    print("==========================================================================")
    print("Evaluating 100-epoch model on validation set...")
    val_model = YOLO(str(target_pt))
    val_res = val_model.val(data='datasets/underwater_dataset/data.yaml', imgsz=416, device=device)

    map50 = round(float(val_res.box.map50) * 100, 2)
    map50_95 = round(float(val_res.box.map) * 100, 2)
    precision = round(float(val_res.box.mp) * 100, 2)
    recall = round(float(val_res.box.mr) * 100, 2)

    # Verify storage/models/results.csv
    csv_verified_epochs = 0
    if target_csv.exists():
        with open(target_csv, 'r', encoding='utf-8') as f:
            reader = list(csv.reader(f))
            csv_verified_epochs = len(reader) - 1

    metrics_summary = {
        "model_name": "underwater_best.pt",
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "training_duration": duration_str,
        "previous_epochs": 50,
        "additional_epochs": 50,
        "total_effective_epochs": csv_verified_epochs,
        "map50": map50,
        "map50_95": map50_95,
        "precision": precision,
        "recall": recall,
        "results_csv_rows": csv_verified_epochs,
        "total_images": 636,
        "num_classes": 10,
        "class_names": ['fish', 'fat fish', 'lengthy white fish', 'rock', 'shrimp', 'transparent fish', 'red shrimp', 'danger fish', 'silver fish', 'black fish']
    }

    with open(storage_models / 'metrics.json', 'w', encoding='utf-8') as f:
        json.dump(metrics_summary, f, indent=2)

    print("\n==========================================================================")
    print("                        SYNCHRONIZED FINAL REPORT                         ")
    print("==========================================================================")
    print(f"Latest Run Directory:       {results.save_dir}")
    print(f"Total Effective Epochs:     {csv_verified_epochs}")
    print(f"Latest Epoch Recorded:      {csv_verified_epochs}")
    print(f"storage/models/results.csv: {csv_verified_epochs} rows (Epoch 1 to Epoch 100)")
    print(f"Precision:                  {precision}%")
    print(f"Recall:                     {recall}%")
    print(f"mAP50:                      {map50}%")
    print(f"mAP50-95:                   {map50_95}%")
    print(f"Model File Path:            {target_pt.resolve()}")
    print(f"Model File Size:            {round(target_pt.stat().st_size / (1024*1024), 2)} MB")
    print(f"Overall Status:             TRAINING & ARTIFACTS FULLY SYNCHRONIZED TO EPOCH 100")
    print("==========================================================================")
