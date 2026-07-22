import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Cpu,
  Database,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Activity,
  Layers,
  ShieldCheck,
  FolderCheck,
  AlertCircle,
  Loader2,
  Award
} from 'lucide-react';
import trainingService, { type TrainingStatusResponse, type DatasetSummaryItem } from '../services/trainingService';

export const YoloTraining: React.FC = () => {
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Discover all available training datasets from backend endpoint GET /api/training/datasets
  const { data: trainingDatasets } = useQuery<DatasetSummaryItem[]>({
    queryKey: ['availableTrainingDatasets'],
    queryFn: () => trainingService.getAvailableDatasets(),
  });

  // Independent Training Target Video ID
  const [selectedVideoId, setSelectedVideoId] = useState<string>('vid_003');

  // Auto-select first discovered dataset when datasets load
  React.useEffect(() => {
    if (trainingDatasets && trainingDatasets.length > 0) {
      if (!trainingDatasets.some((d) => d.video_id === selectedVideoId)) {
        setSelectedVideoId(trainingDatasets[0].video_id);
      }
    }
  }, [trainingDatasets]);

  // Poll training status for selectedVideoId
  const { data: statusData, refetch } = useQuery<TrainingStatusResponse>({
    queryKey: ['trainingStatus', selectedVideoId],
    queryFn: () => trainingService.getTrainingStatus(selectedVideoId),
    refetchInterval: 3000,
  });

  const currentStatus: TrainingStatusResponse = statusData || {
    status: 'idle',
    target_video_id: selectedVideoId,
    epoch: 0,
    total_epochs: 100,
    loss: 0.0,
    map50: 0.0,
    precision: 0.0,
    recall: 0.0,
    eta_seconds: 0,
    eta_formatted: '--',
    message: 'System ready for dataset export and YOLOv8 training.',
    device: 'Detecting GPU...',
    readiness: {
      target_video_id: selectedVideoId,
      images_exist: false,
      labels_exist: false,
      no_skipped_frames: true,
      matching_labels: false,
      yaml_generated: false,
      train_val_split: false,
      is_ready: false,
      total_exported: 0,
      train_count: 0,
      val_count: 0,
      num_classes: 0,
      class_names: [],
    },
  };

  const isTraining = currentStatus.status === 'training';
  const isCompleted = currentStatus.status === 'completed';
  const isReadinessOk = currentStatus.readiness?.is_ready || false;

  const exportMutation = useMutation({
    mutationFn: () => trainingService.exportDataset(selectedVideoId, 0.8),
    onMutate: () => setIsExporting(true),
    onSuccess: (data) => {
      setIsExporting(false);
      queryClient.setQueryData(['trainingStatus', selectedVideoId], data);
      refetch();
    },
    onError: () => setIsExporting(false),
  });

  const startMutation = useMutation({
    mutationFn: (mode: 'scratch' | 'continue' = 'scratch') =>
      mode === 'continue'
        ? trainingService.continueTraining(selectedVideoId, 100, 8, 640)
        : trainingService.startTraining(selectedVideoId, 'scratch', 100, 8, 640),
    onMutate: () => setIsStarting(true),
    onSuccess: (data) => {
      setIsStarting(false);
      queryClient.setQueryData(['trainingStatus', selectedVideoId], data);
      refetch();
    },
    onError: () => setIsStarting(false),
  });

  // Active dataset metrics lookup
  const currentVideoMeta = trainingDatasets?.find((v) => v.video_id === selectedVideoId);
  const activeDisplayId = currentStatus.readiness?.target_video_id || currentStatus.target_video_id || selectedVideoId;
  const annotatedCount = currentStatus.readiness?.total_exported || currentVideoMeta?.annotated_frames || 0;
  const extractedCount = currentStatus.readiness?.extracted_frames || currentVideoMeta?.total_frames || 0;
  const trainCount = currentStatus.readiness?.train_count || Math.floor(annotatedCount * 0.8);
  const valCount = currentStatus.readiness?.val_count || (annotatedCount - trainCount);
  const numClasses = currentStatus.readiness?.num_classes || currentVideoMeta?.num_classes || currentStatus.readiness?.class_names?.length || 0;
  const prevTrained = currentStatus.readiness?.previously_trained_frames || currentVideoMeta?.previously_trained_frames || 0;
  const newFrames = currentStatus.readiness?.new_annotated_frames || Math.max(0, annotatedCount - prevTrained);

  // Calculate percentage
  const totalEp = currentStatus.total_epochs || 100;
  const currEp = currentStatus.epoch || 0;
  const progressPct = totalEp > 0 ? Math.min(100, Math.round((currEp / totalEp) * 100)) : 0;

  const lossVal = typeof currentStatus.loss === 'number' ? currentStatus.loss.toFixed(2) : '0.00';
  const map50Val = typeof currentStatus.map50 === 'number' ? currentStatus.map50 : 0;
  const precVal = typeof currentStatus.precision === 'number' ? currentStatus.precision : 0;
  const recVal = typeof currentStatus.recall === 'number' ? currentStatus.recall : 0;

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-navy-panel p-6 rounded-xl border border-navy-border shadow-lg">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-ocean-cyan/10 border border-ocean-cyan/30 rounded-lg text-ocean-cyan">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-100 tracking-tight">YOLOv8 Training Pipeline</h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Train custom underwater object detection models directly from human-verified HITL datasets
              </p>
            </div>
          </div>
        </div>

        {/* GPU Status Badge */}
        <div className="flex items-center space-x-2 bg-navy-card px-4 py-2.5 rounded-lg border border-navy-border">
          <Zap className="w-4 h-4 text-amber-400 animate-pulse" />
          <div className="text-xs">
            <span className="text-slate-400 block font-medium">Hardware Accelerator</span>
            <span className="text-slate-100 font-semibold">{currentStatus.device || 'NVIDIA GPU'}</span>
          </div>
        </div>
      </div>

      {/* Available Training Datasets Grid */}
      <div className="bg-navy-panel p-6 rounded-xl border border-navy-border space-y-4 shadow-lg">
        <div className="flex items-center justify-between border-b border-navy-border/60 pb-3">
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-ocean-cyan" />
            <h2 className="font-semibold text-slate-100 text-base">Available Training Datasets</h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Discovered {trainingDatasets?.length || 0} datasets in storage
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {trainingDatasets?.map((vid) => {
            const isSelected = selectedVideoId === vid.video_id;
            const statusText = vid.dataset_status || 'READY_FOR_TRAINING';
            const isFully = statusText === 'FULLY_ANNOTATED';
            const isReady = statusText === 'READY_FOR_TRAINING' || statusText === 'PARTIALLY_TRAINED';

            return (
              <div
                key={vid.video_id}
                onClick={() => {
                  setSelectedVideoId(vid.video_id);
                  queryClient.invalidateQueries({ queryKey: ['trainingStatus', vid.video_id] });
                }}
                className={`p-4 rounded-xl border transition-all cursor-pointer space-y-3 ${
                  isSelected
                    ? 'bg-[#0b172a] border-sky-500/80 shadow-lg shadow-sky-950/50 ring-1 ring-sky-500/40'
                    : 'bg-navy-card hover:bg-[#070e1c] border-navy-border/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-sm text-slate-100 flex items-center space-x-2">
                    <span>{vid.video_id}</span>
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                    isFully
                      ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
                      : isReady
                      ? 'bg-sky-950/80 text-sky-400 border-sky-800/60'
                      : 'bg-slate-900 text-slate-400 border-slate-700'
                  }`}>
                    {statusText.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="text-xs space-y-1.5 text-slate-400 font-mono">
                  <div className="flex justify-between">
                    <span>Annotation Progress:</span>
                    <span className="text-slate-200 font-bold">{vid.annotated_frames} / {vid.total_frames}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.round((vid.annotated_frames / (vid.total_frames || 1)) * 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between pt-1 text-[11px]">
                    <span>Classes: <strong className="text-amber-400 font-bold">{vid.num_classes}</strong></span>
                    <span className="text-slate-400">Updated: <strong className="text-sky-300">{vid.last_updated}</strong></span>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedVideoId(vid.video_id);
                    queryClient.invalidateQueries({ queryKey: ['trainingStatus', vid.video_id] });
                  }}
                  className={`w-full py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    isSelected
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
                      : 'bg-navy-panel hover:bg-navy-border text-slate-300 border border-navy-border'
                  }`}
                >
                  {isSelected ? 'Active Training Target' : 'Select Dataset'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Dataset & Training Configuration */}
        <div className="lg:col-span-1 space-y-6">
          {/* Active Dataset Summary Card */}
          <div className="bg-navy-panel p-5 rounded-xl border border-navy-border space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-navy-border/60 pb-3">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-ocean-cyan" />
                <h2 className="font-semibold text-slate-100 text-sm tracking-wide">Active Dataset</h2>
              </div>
              
              {/* Target Video Selector Dropdown */}
              <select
                value={selectedVideoId}
                onChange={(e) => {
                  const newId = e.target.value;
                  setSelectedVideoId(newId);
                  queryClient.invalidateQueries({ queryKey: ['trainingStatus', newId] });
                }}
                className="bg-[#070d19] text-xs font-mono font-bold text-sky-300 border border-sky-500/50 rounded-lg px-2.5 py-1 focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="" disabled>Select Dataset...</option>
                {trainingDatasets?.map((v) => (
                  <option key={v.video_id} value={v.video_id}>
                    {v.video_id} ({v.annotated_frames} / {v.total_frames} annotated - {v.dataset_status})
                  </option>
                ))}
                <option value="All Datasets">All Datasets Combined</option>
              </select>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center py-1.5 border-b border-navy-border/40">
                <span className="text-slate-400">Target Video ID</span>
                <span className="text-emerald-400 font-mono font-bold flex items-center space-x-1 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>🟢 {activeDisplayId} (Current)</span>
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-navy-border/40">
                <span className="text-slate-400">Annotated Frames</span>
                <span className="text-ocean-cyan font-bold font-mono text-xs">
                  {annotatedCount} frames
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-navy-border/40">
                <span className="text-slate-400">Extracted Frames</span>
                <span className="text-slate-200 font-mono">
                  {extractedCount} frames
                </span>
              </div>
              {prevTrained > 0 && (
                <div className="flex justify-between py-1.5 border-b border-navy-border/40">
                  <span className="text-slate-400">Previously Trained</span>
                  <span className="text-sky-400 font-mono font-bold">
                    {prevTrained} frames
                  </span>
                </div>
              )}
              {newFrames > 0 && (
                <div className="flex justify-between py-1.5 border-b border-navy-border/40">
                  <span className="text-slate-400">New Annotated Frames</span>
                  <span className="text-amber-400 font-mono font-bold">
                    {newFrames} frames
                  </span>
                </div>
              )}
              <div className="flex justify-between py-1.5 border-b border-navy-border/40">
                <span className="text-slate-400">Unique Object Classes</span>
                <span className="text-amber-400 font-bold font-mono">
                  {numClasses} classes
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-navy-border/40">
                <span className="text-slate-400">Training Set (80%)</span>
                <span className="text-emerald-400 font-mono font-medium">
                  {trainCount} images
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Validation Set (20%)</span>
                <span className="text-sky-400 font-mono font-medium">
                  {valCount} images
                </span>
              </div>
            </div>

            {/* Class Tags */}
            {currentStatus.readiness?.class_names && currentStatus.readiness.class_names.length > 0 && (
              <div className="pt-2 border-t border-navy-border/40">
                <span className="text-[11px] text-slate-400 block mb-2 font-medium">Exported Classes:</span>
                <div className="flex flex-wrap gap-1.5">
                  {currentStatus.readiness.class_names.map((cls) => (
                    <span
                      key={cls}
                      className="px-2 py-0.5 bg-navy-card border border-navy-border rounded text-[11px] text-slate-300 font-mono"
                    >
                      {cls}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Model Hyperparameters Preset */}
          <div className="bg-navy-panel p-5 rounded-xl border border-navy-border space-y-4">
            <div className="flex items-center space-x-2 border-b border-navy-border/60 pb-3">
              <Layers className="w-4 h-4 text-ocean-cyan" />
              <h2 className="font-semibold text-slate-100 text-sm tracking-wide">Model Parameters</h2>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-navy-card p-2.5 rounded-lg border border-navy-border/60">
                <span className="text-slate-400 block text-[10px]">Architecture</span>
                <span className="text-slate-100 font-bold text-sm">YOLOv8n</span>
              </div>
              <div className="bg-navy-card p-2.5 rounded-lg border border-navy-border/60">
                <span className="text-slate-400 block text-[10px]">Epochs</span>
                <span className="text-slate-100 font-bold text-sm">100</span>
              </div>
              <div className="bg-navy-card p-2.5 rounded-lg border border-navy-border/60">
                <span className="text-slate-400 block text-[10px]">Batch Size</span>
                <span className="text-slate-100 font-bold text-sm">8</span>
              </div>
              <div className="bg-navy-card p-2.5 rounded-lg border border-navy-border/60">
                <span className="text-slate-400 block text-[10px]">Image Resolution</span>
                <span className="text-slate-100 font-bold text-sm">640 x 640</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Readiness Verification & Live Training Progress */}
        <div className="lg:col-span-2 space-y-6">
          {/* Training Readiness Check Panel */}
          <div className="bg-navy-panel p-6 rounded-xl border border-navy-border space-y-5">
            <div className="flex items-center justify-between border-b border-navy-border/60 pb-3">
              <div className="flex items-center space-x-2">
                <FolderCheck className="w-5 h-5 text-ocean-cyan" />
                <h2 className="font-semibold text-slate-100 text-base">Training Readiness Verification</h2>
              </div>

              {isReadinessOk ? (
                <span className="flex items-center space-x-1 text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded-full">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Verified Ready</span>
                </span>
              ) : (
                <span className="flex items-center space-x-1 text-xs font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2.5 py-1 rounded-full">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Pending Export</span>
                </span>
              )}
            </div>

            {/* Verification Checklist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center space-x-2.5 bg-navy-card p-3 rounded-lg border border-navy-border/60">
                {currentStatus.readiness?.images_exist || isReadinessOk ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                )}
                <span className={currentStatus.readiness?.images_exist || isReadinessOk ? 'text-slate-200' : 'text-slate-400'}>
                  Annotated Images Exported ({annotatedCount} frames)
                </span>
              </div>

              <div className="flex items-center space-x-2.5 bg-navy-card p-3 rounded-lg border border-navy-border/60">
                {currentStatus.readiness?.labels_exist || isReadinessOk ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                )}
                <span className={currentStatus.readiness?.labels_exist || isReadinessOk ? 'text-slate-200' : 'text-slate-400'}>
                  YOLO Format .txt Labels Matched
                </span>
              </div>

              <div className="flex items-center space-x-2.5 bg-navy-card p-3 rounded-lg border border-navy-border/60">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span className="text-slate-200">
                  Skipped Frames Automatically Excluded
                </span>
              </div>

              <div className="flex items-center space-x-2.5 bg-navy-card p-3 rounded-lg border border-navy-border/60">
                {currentStatus.readiness?.yaml_generated || isReadinessOk ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                )}
                <span className={currentStatus.readiness?.yaml_generated || isReadinessOk ? 'text-slate-200' : 'text-slate-400'}>
                  data.yaml Configuration Generated
                </span>
              </div>

              <div className="flex items-center space-x-2.5 bg-navy-card p-3 rounded-lg border border-navy-border/60 sm:col-span-2">
                {currentStatus.readiness?.train_val_split || isReadinessOk ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                )}
                <span className={currentStatus.readiness?.train_val_split || isReadinessOk ? 'text-slate-200' : 'text-slate-400'}>
                  80% Train / 20% Val Split Completed
                </span>
              </div>
            </div>

            {/* Action Buttons: Export, Scratch, Continue */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => exportMutation.mutate()}
                disabled={isExporting || isTraining}
                className="flex-1 flex items-center justify-center space-x-2 bg-navy-card hover:bg-navy-border text-ocean-cyan border border-ocean-cyan/40 px-4 py-3 rounded-lg font-medium text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Exporting...</span>
                  </>
                ) : (
                  <>
                    <FolderCheck className="w-4 h-4" />
                    <span>Export Dataset</span>
                  </>
                )}
              </button>

              <button
                onClick={() => startMutation.mutate('scratch')}
                disabled={isStarting || isTraining}
                className="flex-1 flex items-center justify-center space-x-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-3 rounded-lg font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-sky-600/20"
                title="Train a brand-new model from scratch using yolov8n.pt base weights"
              >
                {isStarting || isTraining ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Training Active...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Train From Scratch</span>
                  </>
                )}
              </button>

              <button
                onClick={() => startMutation.mutate('continue')}
                disabled={isStarting || isTraining}
                className="flex-1 flex items-center justify-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-4 py-3 rounded-lg font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-600/20"
                title="Continue training from previous best weights (Transfer Learning)"
              >
                {isStarting || isTraining ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Fine-Tuning...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Continue Training</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Live Training Progress Panel */}
          <div className="bg-navy-panel p-6 rounded-xl border border-navy-border space-y-6">
            <div className="flex items-center justify-between border-b border-navy-border/60 pb-3">
              <div className="flex items-center space-x-2">
                <Activity className="w-5 h-5 text-ocean-cyan" />
                <h2 className="font-semibold text-slate-100 text-base">Real-Time Training Dashboard</h2>
              </div>
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-300 font-mono">
                  ETA: {currentStatus.eta_formatted || '--'}
                </span>
              </div>
            </div>

            {/* Epoch Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-300">
                  Epoch Progress ({currEp} / {totalEp})
                </span>
                <span className="text-ocean-cyan font-mono">{progressPct}%</span>
              </div>
              <div className="w-full h-3 bg-navy-card rounded-full overflow-hidden border border-navy-border/60 p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-ocean-cyan rounded-full transition-all duration-500 shadow-sm"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400 italic pt-1">{currentStatus.message}</p>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-navy-card p-4 rounded-xl border border-navy-border/80">
                <span className="text-xs text-slate-400 block font-medium">Training Loss</span>
                <span className="text-2xl font-bold text-rose-400 mt-1 block font-mono">
                  {lossVal}
                </span>
              </div>

              <div className="bg-navy-card p-4 rounded-xl border border-navy-border/80">
                <span className="text-xs text-slate-400 block font-medium">mAP @ 50</span>
                <span className="text-2xl font-bold text-emerald-400 mt-1 block font-mono">
                  {map50Val}%
                </span>
              </div>

              <div className="bg-navy-card p-4 rounded-xl border border-navy-border/80">
                <span className="text-xs text-slate-400 block font-medium">Precision</span>
                <span className="text-2xl font-bold text-sky-400 mt-1 block font-mono">
                  {precVal}%
                </span>
              </div>

              <div className="bg-navy-card p-4 rounded-xl border border-navy-border/80">
                <span className="text-xs text-slate-400 block font-medium">Recall</span>
                <span className="text-2xl font-bold text-amber-400 mt-1 block font-mono">
                  {recVal}%
                </span>
              </div>
            </div>

            {/* Completion Banner */}
            {isCompleted && (
              <div className="bg-emerald-950/40 border border-emerald-500/50 p-4 rounded-xl flex items-center space-x-3">
                <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400 flex-shrink-0">
                  <Award className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-slate-100 font-semibold text-sm">YOLO Training Completed!</h4>
                  <p className="text-slate-300 text-xs mt-0.5">
                    Trained model automatically saved to{' '}
                    <code className="text-emerald-400 bg-navy-card px-1.5 py-0.5 rounded font-mono">
                      storage/models/underwater_best.pt
                    </code>
                    . The Object Detection Portal will now use this weights file for inference.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default YoloTraining;
