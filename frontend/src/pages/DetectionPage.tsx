import React, { useState, useEffect, useRef } from 'react';
import { Scan, AlertCircle, ArrowLeft } from 'lucide-react';
import type {
  ModelInfo,
  VideoMetadata,
  DetectionSettings,
  DetectionProgress as ProgressType,
  DetectionResults
} from '../types/detection';
import { detectionService } from '../services/detectionService';
import DetectionUpload from '../components/detection/DetectionUpload';
import DetectionProgress from '../components/detection/DetectionProgress';
import DetectionViewer from '../components/detection/DetectionViewer';
import DetectionStatistics from '../components/detection/DetectionStatistics';
import DetectionTimeline from '../components/detection/DetectionTimeline';
import DetectionDownload from '../components/detection/DetectionDownload';

export const DetectionPage: React.FC = () => {
  // Active Detection Model state (Read-only)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);

  // Video Upload & Inference Settings state
  const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [settings, setSettings] = useState<DetectionSettings>({
    confidence_threshold: 0.25,
    iou_threshold: 0.45,
    max_detections: 100,
    model_name: 'underwater_best.pt'
  });

  // Processing & Results state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressType | null>(null);
  const [results, setResults] = useState<DetectionResults | null>(null);
  const [seekTimestamp, setSeekTimestamp] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<any>(null);

  // Automatically load active trained model metadata on initialization
  useEffect(() => {
    fetchActiveModel();
  }, []);

  const fetchActiveModel = async () => {
    try {
      const activeModel = await detectionService.getActiveModel();
      setModelInfo(activeModel);
      if (activeModel?.model_name) {
        setSettings((prev) => ({ ...prev, model_name: activeModel.model_name }));
      }
    } catch (err) {
      console.warn('Could not fetch active model metadata from backend, using default underwater model specs.');
    }
  };

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setErrorMessage(null);
    try {
      const meta = await detectionService.uploadVideo(file);
      setVideoMeta(meta);
    } catch (err: any) {
      setErrorMessage(err.response?.data?.detail || 'Failed to upload video.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartDetection = async () => {
    if (!videoMeta) return;

    setErrorMessage(null);
    setResults(null);
    setProgress(null);

    try {
      const res = await detectionService.startDetection(
        videoMeta.upload_id,
        videoMeta.saved_path,
        settings
      );
      setActiveJobId(res.job_id);
      startPollingStatus(res.job_id);
    } catch (err: any) {
      setErrorMessage(err.response?.data?.detail || 'No trained detection model available. Please complete the training workflow before running object detection.');
    }
  };

  const startPollingStatus = (jobId: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      try {
        const prog = await detectionService.getStatus(jobId);
        setProgress(prog);

        if (prog.status === 'completed') {
          clearInterval(pollTimerRef.current);
          fetchResults(jobId);
        } else if (prog.status === 'failed') {
          clearInterval(pollTimerRef.current);
          if (prog.error) {
            setErrorMessage(prog.error);
          }
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 500);
  };

  const fetchResults = async (jobId: string) => {
    try {
      const resData = await detectionService.getResults(jobId);
      setResults(resData);
    } catch (err: any) {
      setErrorMessage('Failed to load detection results analytics.');
    }
  };

  const handleReset = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setActiveJobId(null);
    setProgress(null);
    setResults(null);
    setVideoMeta(null);
    setSeekTimestamp(null);
    setErrorMessage(null);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-navy-panel border border-navy-border p-6 rounded-2xl shadow-xl">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-sky-500/20 border border-ocean-cyan/40 flex items-center justify-center text-ocean-cyan shadow-lg shadow-cyan-500/10">
            <Scan className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-100 tracking-tight">
              Object Detection Portal
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Automated AI underwater marine species & structure detection module
            </p>
          </div>
        </div>

        {activeJobId && (
          <button
            onClick={handleReset}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-navy-card border border-navy-border text-slate-300 hover:text-white hover:border-ocean-cyan flex items-center space-x-2 transition-colors self-start md:self-auto"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>New Detection Session</span>
          </button>
        )}
      </div>

      {/* Global Error Notification */}
      {errorMessage && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 flex items-center space-x-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Stage 1: Upload & Settings */}
      {!activeJobId && (
        <DetectionUpload
          modelInfo={modelInfo}
          videoMeta={videoMeta}
          settings={settings}
          onUpload={handleUpload}
          onSettingsChange={setSettings}
          onStartDetection={handleStartDetection}
          isUploading={isUploading}
        />
      )}

      {/* Stage 2: Live Processing Progress */}
      {activeJobId && progress && progress.status === 'processing' && (
        <DetectionProgress progress={progress} />
      )}

      {/* Stage 3: Completed Results & Video Viewer */}
      {activeJobId && results && (
        <div className="space-y-6">
          {/* Main Video Viewer & Comparison Mode */}
          <DetectionViewer jobId={activeJobId} seekTimestamp={seekTimestamp} />

          {/* Results Analytics & Class Breakdown */}
          <DetectionStatistics summary={results.summary} />

          {/* Timestamp Detection Timeline */}
          <DetectionTimeline
            events={results.timeline}
            onSeek={(ts) => setSeekTimestamp(ts)}
          />

          {/* Export & Downloads */}
          <DetectionDownload jobId={activeJobId} />
        </div>
      )}
    </div>
  );
};

export default DetectionPage;
