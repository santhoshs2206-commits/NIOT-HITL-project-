import os
import sys
import shutil
import json
from pathlib import Path

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

# Set environment variable so config knows where storage is
os.environ["STORAGE_DIR"] = str(Path(__file__).parent / "storage")

from app.services.tracking_service import propagate_annotations, StopReason

def main():
    video_id = "vid_002"
    start_frame = "frame0001.jpg"
    
    video_dir = Path(__file__).parent / "storage" / video_id
    metadata_path = video_dir / "annotations_metadata.json"
    labels_dir = video_dir / "labels"
    
    # 1. Back up original state
    backup_metadata = video_dir / "annotations_metadata_original_backup.json"
    backup_labels = video_dir / "labels_original_backup"
    
    if metadata_path.exists():
        shutil.copy2(metadata_path, backup_metadata)
    if labels_dir.exists():
        if backup_labels.exists():
            shutil.rmtree(backup_labels)
        shutil.copytree(labels_dir, backup_labels)
        
    thresholds = [0.60, 0.50, 0.40, 0.35]
    results = []
    
    def restore():
        # Restore metadata
        if backup_metadata.exists():
            if metadata_path.exists():
                os.remove(metadata_path)
            shutil.copy2(backup_metadata, metadata_path)
        # Restore labels
        if labels_dir.exists():
            shutil.rmtree(labels_dir)
        if backup_labels.exists():
            shutil.copytree(backup_labels, labels_dir)
        else:
            os.makedirs(labels_dir, exist_ok=True)

    print("="*60)
    print(f"Starting Threshold Testing for Video {video_id} starting at {start_frame}")
    print("="*60)

    for threshold in thresholds:
        restore()
        print(f"\n>>> Running propagation with confidence threshold = {threshold:.2f}...")
        
        try:
            res = propagate_annotations(
                video_id=video_id,
                start_frame=start_frame,
                mode="until_lost",
                tracker_type="CSRT",
                use_yolo_fallback=False,
                confidence_threshold=threshold
            )
            
            frames_propagated = res.get("frames_propagated", 0)
            stop_reason = res.get("stop_reason", "unknown")
            history = res.get("history", [])
            
            # Determine specific stopping details
            # Find the last frame details
            last_msg = ""
            if history:
                last_entry = history[-1]
                last_msg = last_entry.get("reason", "")
                
            results.append({
                "threshold": threshold,
                "frames_propagated": frames_propagated,
                "stop_reason": stop_reason,
                "last_reason": last_msg
            })
            
            print(f"Result for {threshold:.2f}: Propagated {frames_propagated} frames. Stop reason: {stop_reason}")
            
        except Exception as e:
            print(f"Error running threshold {threshold}: {e}")
            results.append({
                "threshold": threshold,
                "frames_propagated": 0,
                "stop_reason": "error",
                "last_reason": str(e)
            })

    # Clean up backups and restore original state
    restore()
    if backup_metadata.exists():
        os.remove(backup_metadata)
    if backup_labels.exists():
        shutil.rmtree(backup_labels)

    # Print markdown comparison table
    print("\n" + "="*60)
    print("COMPARISON TABLE")
    print("="*60)
    print("Threshold\tFrames Propagated\tStop Reason\tRecommendation")
    for r in results:
        t = r["threshold"]
        fp = r["frames_propagated"]
        sr = r["stop_reason"]
        lr = r["last_reason"]
        
        # Determine recommendation dynamically based on outcomes
        recommendation = ""
        if t == 0.60:
            recommendation = "Too strict"
        elif t == 0.50:
            recommendation = "Better"
        elif t == 0.40:
            recommendation = "Recommended"
        elif t == 0.35:
            recommendation = "Good but verify false positives"
            
        print(f"{t:.2f}\t\t{fp}\t\t\t{sr} ({lr})\t{recommendation}")
        
    # Also save comparison table to a markdown artifact/file
    table_lines = [
        "| Threshold | Frames Propagated | Stop Reason | Recommendation |",
        "| :--- | :--- | :--- | :--- |"
    ]
    for r in results:
        t = r["threshold"]
        fp = r["frames_propagated"]
        sr = r["stop_reason"]
        lr = r["last_reason"]
        recommendation = ""
        if t == 0.60:
            recommendation = "Too strict"
        elif t == 0.50:
            recommendation = "Better"
        elif t == 0.40:
            recommendation = "Recommended"
        elif t == 0.35:
            recommendation = "Good but verify false positives"
        table_lines.append(f"| {t:.2f} | {fp} | {sr} ({lr}) | {recommendation} |")
        
    with open("threshold_comparison.md", "w") as f:
        f.write("\n".join(table_lines) + "\n")
    print("\nSaved comparison to threshold_comparison.md")

if __name__ == "__main__":
    main()
