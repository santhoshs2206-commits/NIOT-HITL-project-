export interface VideoUploadResponse {
  video_id: string;
  filename: string;
  status: string;
}

export interface ExtractionSummary {
  extraction_time_s: number;
  average_composite_score: number;
  pixel_diff_avg: number;
  hist_diff_avg: number;
  ssim_diff_avg: number;
  trigger_reasons: {
    first_frame: number;
    motion_threshold: number;
    emergency_gap: number;
    last_frame: number;
  };
  original_fps: number;
  original_duration_s: number;
  reduction_ratio: number;
}

export interface FrameExtractionResponse {
  video_id: string;
  frames_extracted: number;
  original_total_frames: number;
  frame_width: number;
  frame_height: number;
  status: string;
  motion_profile: string;
  reduction_ratio: number;
  extraction_summary: ExtractionSummary;
}

export interface FrameInfo {
  name: string;
  annotated: boolean;
  skipped?: boolean;
}

export interface FramesListResponse {
  video_id: string;
  total_frames: number;
  frames: FrameInfo[];
}

export interface AnnotationItem {
  label: string;
  bbox: [number, number, number, number]; // [xmin, ymin, xmax, ymax]
  id?: string | null;
  tracking_id?: string | null;
  source?: string | null;
  propagation_state?: string | null;
  confidence?: number | null;
  created_by?: string | null;
  tracker?: string | null;
  tracker_version?: string | null;
}

export interface SaveAnnotationsResponse {
  video_id: string;
  frame_name: string;
  annotated_frames: number;
  status: string;
}

export interface VideoStatusItem {
  video_id: string;
  filename: string;
  total_frames: number;
  skipped_frames?: number;
  effective_total_frames?: number;
  original_total_frames: number;
  annotated_frames: number;
  completion_rate: number;
  status: string;
  motion_profile: string;
  reduction_ratio: number;
  extraction_summary?: ExtractionSummary;
  video_deleted?: boolean;
}

export interface DatasetStatusResponse {
  total_videos: number;
  total_frames: number;
  skipped_frames?: number;
  effective_total_frames?: number;
  annotated_frames: number;
  remaining_frames: number;
  overall_completion_rate: number;
  videos: VideoStatusItem[];
}

export type StopReason = 
  | 'completed'
  | 'limit_reached'
  | 'all_objects_lost'
  | 'manual_annotation_encountered'
  | 'user_cancelled'
  | 'end_of_video'
  | 'no_annotations'
  | 'error';

export interface PropagationRequest {
  start_frame: string;
  mode: string;
  tracker_type: string;
  yolo_fallback: boolean;
  session_id?: string | null;
}

export interface PropagationResponse {
  frames_propagated: number;
  stop_reason: StopReason;
  failure_frame: string | null;
  objects_tracked: number;
  session_id: string;
  error_detail?: string;
}

export interface ExtractionProgressResponse {
  video_id: string;
  status: 'idle' | 'reading_video' | 'extracting' | 'generating_metadata' | 'completed' | 'error';
  stage: string;
  frames_processed: number;
  total_video_frames: number;
  frames_extracted: number;
  frames_ignored: number;
  progress_percent: number;
  current_fps: number;
  eta_seconds: number;
  current_frame_filename: string;
  latest_extracted_frames: string[];
  frame_width: number;
  frame_height: number;
  video_fps: number;
  video_duration_s: number;
  reduction_ratio: number;
}

