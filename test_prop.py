import requests
import json
import time

url = "http://127.0.0.1:8000/annotations/propagate/vid_002"
payload = {
    "start_frame": "frame0001.jpg",
    "mode": "until_lost",
    "tracker_type": "CSRT",
    "yolo_fallback": False,
    "session_id": None
}

print("Triggering propagation request...")
t0 = time.time()
try:
    response = requests.post(url, json=payload, timeout=60)
    duration = time.time() - t0
    print(f"Status Code: {response.status_code}")
    print(f"Time Taken: {duration:.2f}s")
    print("Response JSON:")
    print(json.dumps(response.json(), indent=2))
except Exception as e:
    print(f"Error calling API: {e}")
