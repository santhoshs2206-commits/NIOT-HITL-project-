export interface ModelInfo {
  model_name: string;
  status: string;
  training_date: string;
  num_classes: number;
  classes: string[];
  version: string;
  framework?: string;
  device?: string;
  description?: string;
}

export interface VideoMetadata {
  upload_id: string;
  filename: string;
  saved_path: string;
  duration: string;
  duration_sec: number;
  resolution: string;
  width: number;
  height: number;
  fps: number;
  total_frames: number;
  filesize: string;
  filesize_mb: number;
}

export interface DetectionSettings {
  confidence_threshold: number;
  iou_threshold: number;
  max_detections: number;
  device?: string;
  model_name?: string;
}

export interface DetectionProgress {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  current_stage: string;
  current_frame: number;
  total_frames: number;
  fps: number;
  eta_seconds: number;
  error?: string;
}

export interface DetectionEvent {
  frame: number;
  timestamp: string;
  timestamp_sec: number;
  label: string;
  confidence: number;
}

export interface BoundingBoxDetection {
  class: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface FrameDetection {
  frame: number;
  timestamp: number;
  detections: BoundingBoxDetection[];
}

export interface DetectionSummary {
  total_detections: number;
  total_frames: number;
  frames_with_objects: number;
  detection_ratio_pct: number;
  average_confidence: number;
  processing_time_sec: number;
  processing_fps: number;
  class_counts: Record<string, number>;
}

export interface DetectionResults {
  job_id: string;
  video_metadata: VideoMetadata;
  model_info: ModelInfo;
  settings: DetectionSettings;
  summary: DetectionSummary;
  timeline: DetectionEvent[];
  frame_detections: FrameDetection[];
}
