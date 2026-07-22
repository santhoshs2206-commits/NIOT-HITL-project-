import os
import subprocess
import cv2
import numpy as np
import imageio_ffmpeg

def convert_to_h264(input_path: str, output_path: str):
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg_exe,
        "-y",
        "-i", input_path,
        "-c:v", "libx264",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0

print("Testing video generation & H.264 conversion...")
test_raw = "test_raw.mp4"
test_h264 = "test_h264.mp4"

# Create dummy mp4v video using OpenCV
writer = cv2.VideoWriter(test_raw, cv2.VideoWriter_fourcc(*'mp4v'), 30.0, (640, 480))
for _ in range(30):
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "TEST FRAME", (100, 240), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 0), 3)
    writer.write(img)
writer.release()

print(f"Raw OpenCV Video Created: {test_raw} ({os.path.getsize(test_raw)} bytes)")

success = convert_to_h264(test_raw, test_h264)
print(f"H.264 Conversion Success: {success} ({os.path.getsize(test_h264)} bytes)")

# Cleanup test files
os.remove(test_raw) if os.path.exists(test_raw) else None
os.remove(test_h264) if os.path.exists(test_h264) else None
