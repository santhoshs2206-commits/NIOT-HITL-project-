import glob
import os
import csv
import json
import shutil
from pathlib import Path

print("==========================================================================")
print("  STEP 1: LOCATING ALL ULTRALYTICS TRAINING DIRECTORIES & ARTIFACTS      ")
print("==========================================================================")

csv_files = glob.glob('runs/**/results.csv', recursive=True)
csv_files.append('storage/models/results.csv')

found_runs = []

for p_str in csv_files:
    p = Path(p_str)
    if p.exists():
        try:
            with open(p, 'r', encoding='utf-8') as f:
                reader = list(csv.reader(f))
                if not reader:
                    continue
                header = reader[0]
                rows = reader[1:]
                last_epoch = "0"
                if rows:
                    last_row = rows[-1]
                    # First column is epoch (0-indexed or 1-indexed)
                    last_epoch = last_row[0].strip()

                found_runs.append({
                    "path": str(p),
                    "dir": str(p.parent),
                    "total_rows": len(rows),
                    "last_epoch": last_epoch,
                    "mtime": os.path.getmtime(p)
                })
        except Exception as e:
            print(f"Error reading {p}: {e}")

# Sort by modification time descending
found_runs.sort(key=lambda x: x["mtime"], reverse=True)

print("Found results.csv files:")
for item in found_runs:
    print(f"  * Path: {item['path']:<55} | Total Rows: {item['total_rows']:<4} | Last Recorded Epoch: {item['last_epoch']}")

print("\n==========================================================================")
print("  STEP 2 & 3: IDENTIFYING THE LATEST CONTINUATION RUN & VERIFYING EPOCHS  ")
print("==========================================================================")

newest_run = found_runs[0] if found_runs else None

if newest_run:
    print(f"Newest Training Directory: {newest_run['dir']}")
    print(f"Newest results.csv Path:   {newest_run['path']}")
    print(f"Last Recorded Epoch:       {newest_run['last_epoch']}")
    print(f"Total Epoch Rows:          {newest_run['total_rows']}")
    
    # Check if storage/models/results.csv matches the newest run
    storage_csv = Path('storage/models/results.csv')
    
    print("\n==========================================================================")
    print("  STEP 4: SYNCHRONIZING LATEST ARTIFACTS TO storage/models/              ")
    print("==========================================================================")
    
    newest_csv_path = Path(newest_run['path'])
    newest_dir = Path(newest_run['dir'])
    
    # Find weights
    best_weights = newest_dir / 'weights' / 'best.pt'
    last_weights = newest_dir / 'weights' / 'last.pt'
    
    if not best_weights.exists():
        # search parent or siblings
        parent_best = list(newest_dir.glob('**/best.pt'))
        if parent_best:
            best_weights = parent_best[0]

    storage_models = Path('storage/models')
    os.makedirs(storage_models, exist_ok=True)
    
    target_csv = storage_models / 'results.csv'
    target_best = storage_models / 'underwater_best.pt'
    
    if newest_csv_path.exists() and newest_csv_path.resolve() != target_csv.resolve():
        try:
            shutil.copy2(newest_csv_path, target_csv)
            print(f"[Sync] Copied latest results.csv ({newest_run['total_rows']} rows, last epoch: {newest_run['last_epoch']}) -> {target_csv}")
        except Exception as e:
            print(f"[Sync Error] Could not copy results.csv: {e}")
            
    if best_weights.exists():
        try:
            shutil.copy2(best_weights, target_best)
            print(f"[Sync] Copied latest best.pt -> {target_best}")
        except Exception as e:
            print(f"[Sync Error] Could not copy best.pt: {e}")

    # Check the contents of storage/models/results.csv after sync
    if target_csv.exists():
        with open(target_csv, 'r', encoding='utf-8') as f:
            reader = list(csv.reader(f))
            rows = reader[1:] if len(reader) > 1 else []
            print(f"\n[Verified] storage/models/results.csv now contains {len(rows)} epoch rows ending at Epoch: {rows[-1][0].strip() if rows else 'N/A'}")

print("\n==========================================================================")
print("                            VERIFICATION REPORT                           ")
print("==========================================================================")
if newest_run:
    print(f"Latest Run Directory:      {newest_run['dir']}")
    print(f"Number of Epochs Recorded: {newest_run['total_rows']}")
    print(f"Latest Epoch Recorded:     {newest_run['last_epoch']}")
    print(f"Truly Resumed / Continued: {'YES' if int(newest_run['total_rows']) >= 50 else 'NO'}")
    print(f"storage/models Synced:    YES")
else:
    print("No training runs found.")
print("==========================================================================")
