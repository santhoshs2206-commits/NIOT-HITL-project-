import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileVideo,
  Sliders,
  CheckCircle2,
  Play,
  Database,
  Cpu
} from 'lucide-react';
import type { ModelInfo, VideoMetadata, DetectionSettings } from '../../types/detection';

interface DetectionUploadProps {
  modelInfo: ModelInfo | null;
  videoMeta: VideoMetadata | null;
  settings: DetectionSettings;
  onUpload: (file: File) => void;
  onSettingsChange: (newSettings: DetectionSettings) => void;
  onStartDetection: () => void;
  isUploading: boolean;
}

export const DetectionUpload: React.FC<DetectionUploadProps> = ({
  modelInfo,
  videoMeta,
  settings,
  onUpload,
  onSettingsChange,
  onStartDetection,
  isUploading
}) => {
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndUpload(file);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      validateAndUpload(e.target.files[0]);
    }
  };

  const validateAndUpload = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (['mp4', 'avi', 'mov'].includes(ext || '')) {
      onUpload(file);
    } else {
      alert('Please upload a valid MP4, AVI, or MOV video file.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Column 1: Read-Only Detection Model Metadata Card */}
      <div className="bg-navy-panel border border-navy-border rounded-xl p-5 shadow-lg flex flex-col justify-between">
        <div>
          <div className="flex items-center space-x-3 mb-4 pb-3 border-b border-navy-border/60">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-ocean-cyan">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-base">Detection Model</h3>
              <p className="text-xs text-slate-400">Target inference neural network</p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="bg-navy-card/80 p-3 rounded-lg border border-navy-border/50 flex justify-between items-center">
              <span className="text-slate-400">Model</span>
              <span className="font-mono font-medium text-ocean-cyan">{modelInfo?.model_name || 'underwater_best.pt'}</span>
            </div>

            <div className="bg-navy-card/80 p-3 rounded-lg border border-navy-border/50 flex justify-between items-center">
              <span className="text-slate-400">Framework</span>
              <span className="text-slate-200 font-medium">{modelInfo?.framework || 'YOLOv8'}</span>
            </div>

            <div className="bg-navy-card/80 p-3 rounded-lg border border-navy-border/50 flex justify-between items-center">
              <span className="text-slate-400">Status</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {modelInfo?.status || 'Ready'}
              </span>
            </div>

            <div className="bg-navy-card/80 p-3 rounded-lg border border-navy-border/50 flex justify-between items-center">
              <span className="text-slate-400">Compute Device</span>
              <span className="inline-flex items-center space-x-1 font-mono text-xs text-sky-400 font-medium">
                <Cpu className="w-3.5 h-3.5 mr-1" />
                {modelInfo?.device || 'CPU (Auto Detected)'}
              </span>
            </div>

            <div className="bg-navy-card/80 p-3 rounded-lg border border-navy-border/50 flex justify-between items-center">
              <span className="text-slate-400">Version</span>
              <span className="text-slate-200 font-semibold">{modelInfo?.version || 'v1.0'}</span>
            </div>

            <div className="bg-navy-card/80 p-3 rounded-lg border border-navy-border/50">
              <div className="flex justify-between items-center mb-2">
                <span className="text-slate-400">Classes</span>
                <span className="text-xs font-semibold text-slate-300">{modelInfo?.num_classes || 4} Classes</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(modelInfo?.classes || ['Fish', 'Rock', 'Pipe', 'Coral']).map((cls) => (
                  <span
                    key={cls}
                    className="px-2 py-1 rounded bg-sky-950/70 border border-sky-800/60 text-sky-300 text-xs font-medium"
                  >
                    {cls}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-navy-border/40 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Trained Underwater Classifier</span>
          <span>Read-Only Metadata</span>
        </div>
      </div>

      {/* Column 2 & 3: Video Upload & Detection Settings */}
      <div className="lg:col-span-2 space-y-6">
        {/* Upload Zone & Metadata Card */}
        <div className="bg-navy-panel border border-navy-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center space-x-3 mb-4 pb-3 border-b border-navy-border/60">
            <div className="w-10 h-10 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-base">Video Upload</h3>
              <p className="text-xs text-slate-400">Upload video file for underwater object detection (MP4, AVI, MOV)</p>
            </div>
          </div>

          {!videoMeta ? (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
                dragActive
                  ? 'border-ocean-cyan bg-cyan-500/10 scale-[0.99]'
                  : 'border-navy-border hover:border-slate-500 hover:bg-navy-card/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.avi,.mov"
                onChange={handleChange}
                className="hidden"
              />
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-navy-card border border-navy-border flex items-center justify-center text-slate-300">
                <FileVideo className="w-8 h-8 text-ocean-cyan" />
              </div>
              <p className="text-slate-200 font-medium text-sm mb-1">
                {isUploading ? 'Analyzing Video Metadata...' : 'Drag & drop underwater video here or click to browse'}
              </p>
              <p className="text-xs text-slate-500">Supports MP4, AVI, MOV (Up to 4K resolution)</p>
            </div>
          ) : (
            <div className="bg-navy-card/90 border border-ocean-cyan/30 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-lg bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-ocean-cyan">
                  <FileVideo className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-100 text-sm truncate max-w-xs">{videoMeta.filename}</h4>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
                    <span>Duration: <strong className="text-slate-200">{videoMeta.duration}</strong></span>
                    <span>Resolution: <strong className="text-slate-200">{videoMeta.resolution}</strong></span>
                    <span>FPS: <strong className="text-slate-200">{videoMeta.fps}</strong></span>
                    <span>Size: <strong className="text-slate-200">{videoMeta.filesize}</strong></span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 text-xs rounded-lg border border-navy-border text-slate-300 hover:bg-navy-panel hover:text-white transition-colors"
              >
                Change Video
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.avi,.mov"
                onChange={handleChange}
                className="hidden"
              />
            </div>
          )}
        </div>

        {/* Pure Detection Sensitivity Settings */}
        <div className="bg-navy-panel border border-navy-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center space-x-3 mb-4 pb-3 border-b border-navy-border/60">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-base">Detection Settings</h3>
              <p className="text-xs text-slate-400">Configure inference threshold parameters</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
            {/* Confidence Threshold */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <label className="text-slate-300 font-medium">Confidence Threshold</label>
                <span className="font-mono text-ocean-cyan font-semibold">{settings.confidence_threshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.95"
                step="0.05"
                value={settings.confidence_threshold}
                onChange={(e) =>
                  onSettingsChange({ ...settings, confidence_threshold: parseFloat(e.target.value) })
                }
                className="w-full h-2 bg-navy-card rounded-lg appearance-none cursor-pointer accent-ocean-cyan"
              />
              <p className="text-[11px] text-slate-500">Minimum score to classify candidate bounding boxes</p>
            </div>

            {/* IoU Threshold */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <label className="text-slate-300 font-medium">IoU Threshold</label>
                <span className="font-mono text-ocean-cyan font-semibold">{settings.iou_threshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.90"
                step="0.05"
                value={settings.iou_threshold}
                onChange={(e) =>
                  onSettingsChange({ ...settings, iou_threshold: parseFloat(e.target.value) })
                }
                className="w-full h-2 bg-navy-card rounded-lg appearance-none cursor-pointer accent-ocean-cyan"
              />
              <p className="text-[11px] text-slate-500">Non-Maximum Suppression (NMS) overlap cutoff</p>
            </div>

            {/* Max Detections */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-slate-300 font-medium text-sm block">Maximum Detections / Frame</label>
              <input
                type="number"
                min="1"
                max="500"
                value={settings.max_detections}
                onChange={(e) =>
                  onSettingsChange({ ...settings, max_detections: parseInt(e.target.value, 10) || 100 })
                }
                className="w-full bg-navy-card border border-navy-border rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-ocean-cyan font-mono"
              />
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={onStartDetection}
            disabled={!videoMeta || isUploading}
            className={`w-full py-3.5 px-6 rounded-xl font-semibold text-sm flex items-center justify-center space-x-2 transition-all duration-200 shadow-lg ${
              !videoMeta || isUploading
                ? 'bg-navy-card text-slate-500 border border-navy-border cursor-not-allowed'
                : 'bg-gradient-to-r from-cyan-500 to-sky-500 text-navy-dark hover:from-cyan-400 hover:to-sky-400 shadow-cyan-500/20 scale-[1.01]'
            }`}
          >
            <Play className="w-5 h-5 fill-current" />
            <span>Start Detection</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DetectionUpload;
