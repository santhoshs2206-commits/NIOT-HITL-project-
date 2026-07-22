import api from './api';

export interface ReadinessCheck {
  target_video_id?: string;
  images_exist: boolean;
  labels_exist: boolean;
  no_skipped_frames: boolean;
  matching_labels: boolean;
  yaml_generated: boolean;
  train_val_split: boolean;
  is_ready: boolean;
  total_exported: number;
  train_count: number;
  val_count: number;
  extracted_frames?: number;
  previously_trained_frames?: number;
  new_annotated_frames?: number;
  dataset_status?: string;
  num_classes: number;
  class_names: string[];
  last_updated?: string;
}

export interface TrainingStatusResponse {
  status: 'idle' | 'exporting' | 'readiness_checked' | 'training' | 'completed' | 'failed';
  target_video_id?: string;
  epoch: number;
  total_epochs: number;
  loss: number;
  map50: number;
  precision: number;
  recall: number;
  eta_seconds: number;
  eta_formatted: string;
  message: string;
  device?: string;
  readiness: ReadinessCheck;
  error?: string | null;
}

export interface DatasetSummaryItem {
  video_id: string;
  filename: string;
  dataset_status: string;
  total_frames: number;
  effective_total_frames: number;
  annotated_frames: number;
  remaining_frames: number;
  completion_rate: number;
  previously_trained_frames: number;
  num_classes: number;
  class_names: string[];
  last_updated: string;
}

export const trainingService = {
  async getAvailableDatasets(): Promise<DatasetSummaryItem[]> {
    const response = await api.get<DatasetSummaryItem[]>('/api/training/datasets');
    return response.data;
  },

  async exportDataset(videoId?: string, splitRatio: number = 0.8): Promise<TrainingStatusResponse> {
    const response = await api.post<TrainingStatusResponse>('/api/training/export', {
      video_id: videoId || null,
      split_ratio: splitRatio,
    });
    return response.data;
  },

  async finalizeDataset(videoId: string): Promise<any> {
    const response = await api.post('/api/training/finalize', {
      video_id: videoId,
    });
    return response.data;
  },

  async startTraining(
    videoId?: string,
    mode: 'scratch' | 'continue' = 'scratch',
    epochs: number = 100,
    batch: number = 8,
    imgsz: number = 640
  ): Promise<TrainingStatusResponse> {
    const response = await api.post<TrainingStatusResponse>('/api/training/start', {
      video_id: videoId || null,
      mode,
      epochs,
      batch,
      imgsz,
    });
    return response.data;
  },

  async continueTraining(
    videoId?: string,
    epochs: number = 100,
    batch: number = 8,
    imgsz: number = 640
  ): Promise<TrainingStatusResponse> {
    const response = await api.post<TrainingStatusResponse>('/api/training/continue', {
      video_id: videoId || null,
      mode: 'continue',
      epochs,
      batch,
      imgsz,
    });
    return response.data;
  },

  async getTrainingStatus(videoId?: string): Promise<TrainingStatusResponse> {
    const response = await api.get<TrainingStatusResponse>('/api/training/status', {
      params: videoId ? { video_id: videoId } : {}
    });
    return response.data;
  },
};

export default trainingService;
