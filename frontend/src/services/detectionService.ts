import api from './api';
import type {
  ModelInfo,
  VideoMetadata,
  DetectionSettings,
  DetectionProgress,
  DetectionResults
} from '../types/detection';

export const detectionService = {
  /**
   * Upload video for detection processing
   */
  uploadVideo: async (file: File): Promise<VideoMetadata> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<VideoMetadata>('/api/detection/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  /**
   * Fetch active trained model metadata
   */
  getActiveModel: async (): Promise<ModelInfo> => {
    const response = await api.get<ModelInfo>('/api/detection/active-model');
    return response.data;
  },

  /**
   * Fetch available trained models
   */
  getModels: async (): Promise<ModelInfo[]> => {
    const response = await api.get<{ models: ModelInfo[] }>('/api/detection/models');
    return response.data.models;
  },

  /**
   * Start object detection job
   */
  startDetection: async (
    uploadId: string,
    savedPath: string,
    settings: DetectionSettings
  ): Promise<{ job_id: string }> => {
    const response = await api.post<{ job_id: string }>('/api/detection/start', {
      upload_id: uploadId,
      saved_path: savedPath,
      confidence_threshold: settings.confidence_threshold,
      iou_threshold: settings.iou_threshold,
      max_detections: settings.max_detections,
      device: settings.device,
      model_name: settings.model_name,
    });
    return response.data;
  },

  /**
   * Get job progress status
   */
  getStatus: async (jobId: string): Promise<DetectionProgress> => {
    const response = await api.get<DetectionProgress>(`/api/detection/status/${jobId}`);
    return response.data;
  },

  /**
   * Get detection results analytics
   */
  getResults: async (jobId: string): Promise<DetectionResults> => {
    const response = await api.get<DetectionResults>(`/api/detection/results/${jobId}`);
    return response.data;
  },

  /**
   * Get Download URLs
   */
  getDownloadVideoUrl: (jobId: string): string => {
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
    return `${baseURL}/api/detection/download-video/${jobId}`;
  },

  getOriginalVideoUrl: (jobId: string): string => {
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
    return `${baseURL}/api/detection/original-video/${jobId}`;
  },

  getDownloadCsvUrl: (jobId: string): string => {
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
    return `${baseURL}/api/detection/download-csv/${jobId}`;
  },

  getDownloadJsonUrl: (jobId: string): string => {
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
    return `${baseURL}/api/detection/download-json/${jobId}`;
  },

  getDownloadReportUrl: (jobId: string): string => {
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
    return `${baseURL}/api/detection/download-report/${jobId}`;
  }
};
