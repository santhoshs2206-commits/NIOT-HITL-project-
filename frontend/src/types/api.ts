export interface VideoUploadResponse {
  video_id: string;
  filename: string;
  status: string;
}

export interface FrameExtractionResponse {
  video_id: string;
  frames_extracted: number;
  frame_width: number;
  frame_height: number;
  status: string;
}

export interface FrameInfo {
  name: string;
  annotated: boolean;
}

export interface FramesListResponse {
  video_id: string;
  total_frames: number;
  frames: FrameInfo[];
}

export interface AnnotationItem {
  label: string;
  bbox: [number, number, number, number]; // [xmin, ymin, xmax, ymax]
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
  annotated_frames: number;
  completion_rate: number;
  status: string;
}

export interface DatasetStatusResponse {
  total_videos: number;
  total_frames: number;
  annotated_frames: number;
  remaining_frames: number;
  overall_completion_rate: number;
  videos: VideoStatusItem[];
}
