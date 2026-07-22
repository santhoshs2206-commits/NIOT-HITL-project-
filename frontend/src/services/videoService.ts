import api from './api';
import type { 
  VideoUploadResponse, 
  FrameExtractionResponse,
  ExtractionProgressResponse,
  FramesListResponse,
  AnnotationItem,
  SaveAnnotationsResponse,
  DatasetStatusResponse,
  PropagationRequest,
  PropagationResponse
} from '../types/api';

export const uploadVideo = async (file: File): Promise<VideoUploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<VideoUploadResponse>('/upload-video', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    timeout: 600000, // 10 minutes timeout for uploads
  });
  return response.data;
};

export const extractFrames = async (videoId: string, motionProfile?: string): Promise<FrameExtractionResponse> => {
  const url = motionProfile 
    ? `/extract-frames/${videoId}?motion_profile=${encodeURIComponent(motionProfile)}`
    : `/extract-frames/${videoId}`;
  const response = await api.post<FrameExtractionResponse>(url, null, {
    timeout: 600000, // 10 minutes timeout for frame extraction
  });
  return response.data;
};

export const getExtractionProgress = async (videoId: string): Promise<ExtractionProgressResponse> => {
  const response = await api.get<ExtractionProgressResponse>(`/extraction-progress/${videoId}`);
  return response.data;
};

export const getFramesList = async (videoId: string): Promise<FramesListResponse> => {
  const response = await api.get<FramesListResponse>(`/frames/${videoId}`);
  return response.data;
};

export const getFrameImageUrl = (videoId: string, frameName: string): string => {
  const base = api.defaults.baseURL || 'http://127.0.0.1:8000';
  return `${base}/frame/${videoId}/${frameName}`;
};

export const getAnnotations = async (videoId: string, frameName: string): Promise<AnnotationItem[]> => {
  const response = await api.get<{ annotations: AnnotationItem[] }>(`/annotations/${videoId}/${frameName}`);
  return response.data.annotations;
};

export const saveAnnotations = async (
  videoId: string,
  frameName: string,
  annotations: AnnotationItem[]
): Promise<SaveAnnotationsResponse> => {
  const response = await api.post<SaveAnnotationsResponse>(`/annotations/${videoId}/${frameName}`, {
    annotations
  });
  return response.data;
};

export const updateSingleAnnotation = async (
  videoId: string,
  frameName: string,
  annotationId: string,
  annotation: AnnotationItem
): Promise<SaveAnnotationsResponse> => {
  const response = await api.put<SaveAnnotationsResponse>(`/annotations/${videoId}/${frameName}/${annotationId}`, annotation);
  return response.data;
};

export const getClasses = async (): Promise<string[]> => {
  const response = await api.get<string[]>('/classes');
  return response.data;
};

export const getDatasetStatus = async (): Promise<DatasetStatusResponse> => {
  const response = await api.get<DatasetStatusResponse>('/dataset-status');
  return response.data;
};

export const propagateAnnotations = async (
  videoId: string,
  request: PropagationRequest
): Promise<PropagationResponse> => {
  const response = await api.post<PropagationResponse>(`/annotations/propagate/${videoId}`, request);
  return response.data;
};

export const deleteUploadedVideoOnly = async (videoId: string): Promise<{ status: string; message: string }> => {
  const response = await api.delete<{ status: string; message: string }>(`/videos/${videoId}/video-only`);
  return response.data;
};

export const deleteCompleteDataset = async (videoId: string): Promise<{ status: string; message: string }> => {
  const response = await api.delete<{ status: string; message: string }>(`/videos/${videoId}/complete-dataset`);
  return response.data;
};

export const resetAnnotations = async (videoId: string): Promise<{ video_id: string; status: string; message: string; annotated_frames: number }> => {
  const response = await api.post<{ video_id: string; status: string; message: string; annotated_frames: number }>(`/reset-annotations/${videoId}`);
  return response.data;
};

export const skipFrame = async (videoId: string, frameName: string): Promise<{ status: string; message: string; skipped: boolean }> => {
  const response = await api.post<{ status: string; message: string; skipped: boolean }>(`/videos/${videoId}/frames/${frameName}/skip`);
  return response.data;
};

export const restoreFrame = async (videoId: string, frameName: string): Promise<{ status: string; message: string; skipped: boolean }> => {
  const response = await api.post<{ status: string; message: string; skipped: boolean }>(`/videos/${videoId}/frames/${frameName}/restore`);
  return response.data;
};

export const skipFrameRange = async (
  videoId: string,
  startFrame: string,
  endFrame: string
): Promise<{ status: string; message: string; start_frame: string; end_frame: string; skipped_count: number }> => {
  const response = await api.post<{ status: string; message: string; start_frame: string; end_frame: string; skipped_count: number }>(
    `/videos/${videoId}/skip-range`,
    { start_frame: startFrame, end_frame: endFrame }
  );
  return response.data;
};
