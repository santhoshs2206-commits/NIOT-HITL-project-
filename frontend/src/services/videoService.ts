import api from './api';
import type { 
  VideoUploadResponse, 
  FrameExtractionResponse,
  FramesListResponse,
  AnnotationItem,
  SaveAnnotationsResponse,
  DatasetStatusResponse
} from '../types/api';

export const uploadVideo = async (file: File): Promise<VideoUploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<VideoUploadResponse>('/upload-video', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const extractFrames = async (videoId: string): Promise<FrameExtractionResponse> => {
  const response = await api.post<FrameExtractionResponse>(`/extract-frames/${videoId}`);
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

export const getClasses = async (): Promise<string[]> => {
  const response = await api.get<string[]>('/classes');
  return response.data;
};

export const getDatasetStatus = async (): Promise<DatasetStatusResponse> => {
  const response = await api.get<DatasetStatusResponse>('/dataset-status');
  return response.data;
};
