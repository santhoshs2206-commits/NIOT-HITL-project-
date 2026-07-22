import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { 
  UploadCloud, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Play, 
  Image as ImageIcon,
  Gauge,
  Clock,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { uploadVideo, extractFrames, getExtractionProgress, getFrameImageUrl } from '../services/videoService';
import type { FrameExtractionResponse, ExtractionProgressResponse } from '../types/api';

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'extracting' | 'extracted' | 'error';

const ALLOWED_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];

export const Upload: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Core States
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [selectedProfile, setSelectedProfile] = useState<string>('Moderate');
  const [extractionData, setExtractionData] = useState<FrameExtractionResponse | null>(null);

  // Live Extraction Progress State
  const [progressInfo, setProgressInfo] = useState<ExtractionProgressResponse | null>(null);
  const [autoRedirectSeconds, setAutoRedirectSeconds] = useState<number | null>(null);

  // Poll real-time extraction progress
  useEffect(() => {
    if (!videoId || (uploadState !== 'extracting' && uploadState !== 'uploaded')) return;

    let isMounted = true;
    const fetchProgress = async () => {
      try {
        const prog = await getExtractionProgress(videoId);
        if (!isMounted) return;

        setProgressInfo(prog);

        if (prog.status === 'extracting' || prog.status === 'reading_video' || prog.status === 'generating_metadata') {
          if (uploadState !== 'extracting') {
            setUploadState('extracting');
          }
        } else if (prog.status === 'completed' && prog.frames_extracted > 0) {
          setUploadState('extracted');
          if (prog.frame_width && prog.frame_height) {
            setResolution(`${prog.frame_width} x ${prog.frame_height}`);
          }
        }
      } catch (err) {
        console.error('Failed to fetch extraction progress:', err);
      }
    };

    fetchProgress();
    const intervalId = setInterval(fetchProgress, 350);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [videoId, uploadState]);

  // Handle Automatic Redirect Countdown when extraction reaches completed state
  useEffect(() => {
    if (uploadState === 'extracted' && autoRedirectSeconds === null) {
      setAutoRedirectSeconds(5);
    }
  }, [uploadState, autoRedirectSeconds]);

  useEffect(() => {
    if (autoRedirectSeconds === null || autoRedirectSeconds <= 0) return;

    const timer = setTimeout(() => {
      if (autoRedirectSeconds === 1) {
        if (videoId) {
          navigate(`/workspace?video_id=${videoId}`);
        }
      } else {
        setAutoRedirectSeconds(prev => (prev !== null ? prev - 1 : null));
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoRedirectSeconds, videoId, navigate]);

  // 1. Upload Video Mutation
  const uploadMutation = useMutation({
    mutationFn: uploadVideo,
    onSuccess: (data) => {
      setVideoId(data.video_id);
      setUploadState('uploaded');
    },
    onError: (error: any) => {
      setUploadState('error');
      setErrorMsg(error.response?.data?.detail || 'Failed to upload video file.');
    }
  });

  // 2. Extract Frames Mutation
  const extractMutation = useMutation({
    mutationFn: ({ videoId, motionProfile }: { videoId: string; motionProfile: string }) => 
      extractFrames(videoId, motionProfile),
    onSuccess: (data) => {
      setResolution(`${data.frame_width} x ${data.frame_height}`);
      setExtractionData(data);
      setUploadState('extracted');
    },
    onError: (error: any) => {
      setUploadState('error');
      setErrorMsg(error.response?.data?.detail || 'Failed to extract frames from video.');
    }
  });

  // File selection handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (selectedFile: File) => {
    const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setUploadState('error');
      setErrorMsg(`Unsupported file type. Supported extensions: ${ALLOWED_EXTENSIONS.join(', ')}`);
      return;
    }

    setFile(selectedFile);
    setErrorMsg('');
    setUploadState('uploading');
    uploadMutation.mutate(selectedFile);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const triggerBrowse = () => {
    fileInputRef.current?.click();
  };

  const handleStartExtraction = () => {
    if (!videoId || extractMutation.isPending) return;
    setUploadState('extracting');
    extractMutation.mutate({ videoId, motionProfile: selectedProfile });
  };

  const handleGoToWorkspace = () => {
    if (videoId) {
      navigate(`/workspace?video_id=${videoId}`);
    }
  };

  const handleReset = () => {
    setFile(null);
    setVideoId(null);
    setErrorMsg('');
    setExtractionData(null);
    setProgressInfo(null);
    setAutoRedirectSeconds(null);
    setSelectedProfile('Moderate');
    setUploadState('idle');
  };

  // Helper formatting for ETA
  const formatEta = (totalSecs: number): string => {
    if (totalSecs <= 0) return '00:00';
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Safe metrics getters from live progress or static extraction response
  const framesProcessed = progressInfo?.frames_processed || extractionData?.original_total_frames || 0;
  const totalVideoFrames = progressInfo?.total_video_frames || extractionData?.original_total_frames || 0;
  const framesExtracted = progressInfo?.frames_extracted || extractionData?.frames_extracted || 0;
  const framesIgnored = progressInfo?.frames_ignored || Math.max(0, framesProcessed - framesExtracted);
  const progressPercent = progressInfo?.progress_percent || (uploadState === 'extracted' ? 100 : 0);
  const currentFps = progressInfo?.current_fps || 0;
  const etaSeconds = progressInfo?.eta_seconds || 0;
  const currentFilename = progressInfo?.current_frame_filename || (framesExtracted > 0 ? `frame${framesExtracted.toString().padStart(4, '0')}.jpg` : 'Initialising...');
  const compressionRatio = progressInfo?.reduction_ratio || extractionData?.reduction_ratio || (framesExtracted > 0 ? (framesProcessed / framesExtracted).toFixed(1) : '1.0');
  const recentThumbnails = progressInfo?.latest_extracted_frames || [];

  return (
    <div className="p-8 max-w-5xl mx-auto flex flex-col justify-center min-h-[85vh]">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-100 tracking-wide flex items-center justify-center space-x-3">
          <span>Upload Underwater Footage</span>
        </h1>
        <p className="mt-2 text-slate-400 max-w-lg mx-auto text-sm">
          Add MP4, AVI, MOV, or WEBM subsea videos to extract high-value keyframes using the Hybrid Adaptive Key Frame Selector.
        </p>
      </div>

      {/* Main card panel */}
      <div className="bg-navy-panel border border-navy-border rounded-xl p-8 shadow-2xl transition-all duration-300">
        
        {/* IDLE state: Drag-and-drop zone */}
        {uploadState === 'idle' && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={triggerBrowse}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center min-h-[320px] ${
              isDragOver 
                ? 'border-ocean-cyan bg-sky-500/5 scale-[1.01]' 
                : 'border-navy-border hover:border-sky-500/50 bg-[#0c162b]/50'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="video/*"
              className="hidden"
            />
            <div className="w-16 h-16 rounded-full bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-400 mb-4 group-hover:scale-110 transition-transform">
              <UploadCloud className="w-8 h-8" />
            </div>
            <p className="text-slate-200 font-semibold text-lg">
              Drag and drop your underwater video here
            </p>
            <p className="text-slate-400 text-sm mt-1">
              or click to browse local files
            </p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              {ALLOWED_EXTENSIONS.map((ext) => (
                <span key={ext} className="text-[10px] font-bold px-2 py-0.5 bg-navy-card border border-navy-border text-slate-400 rounded uppercase tracking-wider">
                  {ext.slice(1)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* UPLOADING state */}
        {uploadState === 'uploading' && (
          <div className="text-center p-12 flex flex-col items-center justify-center min-h-[320px]">
            <Loader2 className="w-12 h-12 text-ocean-cyan animate-spin mb-4" />
            <p className="text-slate-200 font-medium text-lg">Uploading video content to storage...</p>
            <p className="text-slate-400 text-sm mt-1">{file?.name}</p>
            {file && (
              <span className="text-xs text-slate-500 mt-2 bg-[#0c162b] px-3 py-1 rounded border border-navy-border">
                File Size: {(file.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            )}
          </div>
        )}

        {/* UPLOADED state: Success message, show Video ID & extract triggers */}
        {uploadState === 'uploaded' && (
          <div className="text-center p-8 flex flex-col items-center justify-center min-h-[320px]">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-100">Video Uploaded Successfully!</h3>
            <p className="text-slate-400 text-sm mt-1 mb-6">{file?.name}</p>

            <div className="bg-[#0c162b] border border-navy-border px-6 py-3 rounded-lg mb-8 flex items-center space-x-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assigned ID:</span>
              <code className="text-ocean-cyan font-mono text-base font-semibold">{videoId}</code>
            </div>

            {/* Motion Profile Selector Card */}
            <div className="w-full max-w-3xl bg-navy-card/45 border border-navy-border/60 rounded-xl p-5 mb-8 text-left">
              <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Select Motion Sensitivity Profile
              </span>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
                {Object.entries({
                  'Very Fast': { label: 'Very Fast', desc: 'Ultra high sensitivity' },
                  'Fast': { label: 'Fast', desc: 'High sensitivity' },
                  'Moderate': { label: 'Moderate', desc: 'Recommended balance' },
                  'Slow': { label: 'Slow', desc: 'Ignore micro changes' },
                  'Very Slow': { label: 'Very Slow', desc: 'Major transitions only' }
                }).map(([profileName, { label, desc }]) => {
                  const isSelected = selectedProfile === profileName;
                  return (
                    <button
                      key={profileName}
                      type="button"
                      onClick={() => setSelectedProfile(profileName)}
                      className={`flex flex-col p-3 rounded-lg border text-left cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? 'border-sky-500 bg-sky-950/30 shadow-md shadow-sky-500/10 text-slate-100'
                          : 'border-navy-border hover:border-slate-700 bg-navy-card/20 text-slate-400'
                      }`}
                    >
                      <span className={`text-xs font-bold ${isSelected ? 'text-sky-400' : 'text-slate-300'}`}>
                        {label}
                      </span>
                      <span className="text-[9px] leading-snug mt-1 text-slate-400">
                        {desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex space-x-4">
              <button
                onClick={handleReset}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-navy-border text-slate-300 font-medium rounded-lg transition-colors text-sm"
              >
                Upload Another Video
              </button>
              <button
                onClick={handleStartExtraction}
                disabled={extractMutation.isPending}
                className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg flex items-center space-x-2 transition-all duration-200 shadow-lg shadow-sky-600/20 text-sm"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Extract Video Frames</span>
              </button>
            </div>
          </div>
        )}

        {/* EXTRACTING state: Real-Time Scientific Dashboard & Progress View */}
        {uploadState === 'extracting' && (
          <div className="p-4 space-y-6">
            
            {/* 1. Workflow Pipeline Stage Checklist */}
            <div className="bg-[#0c162b]/80 border border-navy-border rounded-xl p-4">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                Extraction Workflow Pipeline
              </span>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                
                {/* Stage 1: Upload */}
                <div className="flex items-center space-x-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">Upload Complete</span>
                </div>

                {/* Stage 2: Reading Video */}
                <div className={`flex items-center space-x-2 p-2 rounded-lg text-xs font-medium border ${
                  progressInfo?.status !== 'idle'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-navy-card/40 border-navy-border text-slate-400'
                }`}>
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">Reading Video</span>
                </div>

                {/* Stage 3: Extracting Frames */}
                <div className={`flex items-center space-x-2 p-2 rounded-lg text-xs font-medium border ${
                  progressInfo?.status === 'extracting'
                    ? 'bg-sky-500/15 border-sky-500/40 text-ocean-cyan shadow-sm shadow-sky-500/10'
                    : progressInfo?.status === 'generating_metadata' || progressInfo?.status === 'completed'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-navy-card/40 border-navy-border text-slate-400'
                }`}>
                  {progressInfo?.status === 'extracting' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-ocean-cyan flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="truncate">Extracting Frames</span>
                </div>

                {/* Stage 4: Generating Metadata */}
                <div className={`flex items-center space-x-2 p-2 rounded-lg text-xs font-medium border ${
                  progressInfo?.status === 'generating_metadata'
                    ? 'bg-sky-500/15 border-sky-500/40 text-ocean-cyan'
                    : progressInfo?.status === 'completed'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-navy-card/40 border-navy-border text-slate-400'
                }`}>
                  {progressInfo?.status === 'generating_metadata' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-ocean-cyan flex-shrink-0" />
                  ) : (
                    <Sparkles className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="truncate">Gen Metadata</span>
                </div>

                {/* Stage 5: Dataset Ready */}
                <div className={`flex items-center space-x-2 p-2 rounded-lg text-xs font-medium border ${
                  progressInfo?.status === 'completed'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-navy-card/40 border-navy-border text-slate-400'
                }`}>
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">Dataset Ready</span>
                </div>

              </div>
            </div>

            {/* 2. Prominent Top Percentage & Glowing Progress Bar */}
            <div className="bg-[#0c162b]/90 border border-navy-border rounded-xl p-6 text-center space-y-3">
              
              {/* Large percentage on top */}
              <div className="flex flex-col items-center">
                <span className="text-4xl font-black text-ocean-cyan tracking-tight font-mono">
                  {progressPercent.toFixed(1)}%
                </span>
                <span className="text-xs font-semibold text-slate-400 mt-1 tracking-wide">
                  FRAME EXTRACTION IN PROGRESS
                </span>
              </div>

              {/* Glowing progress bar */}
              <div className="w-full bg-navy-card h-4 rounded-full p-0.5 border border-navy-border/80 overflow-hidden relative shadow-inner">
                <div 
                  className="h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 rounded-full transition-all duration-300 ease-out shadow-lg shadow-sky-500/30"
                  style={{ width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
                />
              </div>

              {/* Sub-label under bar */}
              <div className="flex justify-between items-center text-xs font-mono text-slate-300 px-1 pt-1">
                <span>
                  <strong className="text-slate-100">{framesProcessed.toLocaleString()}</strong> / {totalVideoFrames.toLocaleString()} Frames Processed
                </span>
                <span className="text-emerald-400 font-bold">
                  {framesExtracted.toLocaleString()} Keyframes Saved
                </span>
              </div>
            </div>

            {/* 3. Scientific Extraction Metrics Grid (Both Processed & Saved) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              
              {/* Metric 1: Frames Processed */}
              <div className="bg-[#0c162b]/80 border border-navy-border p-4 rounded-xl">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Frames Processed</span>
                <span className="block text-slate-100 font-bold text-lg mt-1 font-mono">
                  {framesProcessed.toLocaleString()} <span className="text-xs text-slate-400 font-normal">/ {totalVideoFrames.toLocaleString()}</span>
                </span>
                <span className="block text-[10px] text-slate-400 mt-1">video scan count</span>
              </div>

              {/* Metric 2: Keyframes Saved */}
              <div className="bg-[#0c162b]/80 border border-navy-border p-4 rounded-xl">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Keyframes Saved</span>
                <span className="block text-emerald-400 font-bold text-xl mt-1 font-mono">
                  {framesExtracted.toLocaleString()}
                </span>
                <span className="block text-[10px] text-slate-400 mt-1">isolated for labeling</span>
              </div>

              {/* Metric 3: Dataset Compression */}
              <div className="bg-[#0c162b]/80 border border-navy-border p-4 rounded-xl">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dataset Compression</span>
                <span className="block text-ocean-cyan font-bold text-xl mt-1 font-mono">
                  {compressionRatio}×
                </span>
                <span className="block text-[10px] text-slate-400 mt-1 font-mono">
                  {totalVideoFrames || '—'} → {framesExtracted || '—'}
                </span>
              </div>

              {/* Metric 4: Frames Ignored */}
              <div className="bg-[#0c162b]/80 border border-navy-border p-4 rounded-xl">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Frames Ignored</span>
                <span className="block text-slate-400 font-bold text-xl mt-1 font-mono">
                  {framesIgnored.toLocaleString()}
                </span>
                <span className="block text-[10px] text-slate-400 mt-1">redundant / static frames</span>
              </div>

            </div>

            {/* 4. Real-Time Performance & Current Status Indicators */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              
              <div className="bg-[#0c162b]/50 border border-navy-border/60 p-3 rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Gauge className="w-4 h-4 text-sky-400" />
                  <span className="text-slate-300 font-medium">Extraction Speed</span>
                </div>
                <span className="font-mono font-bold text-slate-100">{currentFps} FPS</span>
              </div>

              <div className="bg-[#0c162b]/50 border border-navy-border/60 p-3 rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-slate-300 font-medium">Time Remaining</span>
                </div>
                <span className="font-mono font-bold text-amber-300">{formatEta(etaSeconds)}</span>
              </div>

              <div className="bg-[#0c162b]/50 border border-navy-border/60 p-3 rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <ImageIcon className="w-4 h-4 text-emerald-400" />
                  <span className="text-slate-300 font-medium">Current Frame</span>
                </div>
                <span className="font-mono font-bold text-emerald-300 truncate max-w-[120px]">{currentFilename}</span>
              </div>

            </div>

            {/* 5. Live Extracted Keyframe Image Previews */}
            <div className="bg-[#0c162b]/60 border border-navy-border/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>Live Keyframe Previews</span>
                </span>
                <span className="text-[10px] text-slate-400">
                  {recentThumbnails.length} recent frames on disk
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {recentThumbnails.length > 0 ? (
                  recentThumbnails.slice(-4).map((fname, idx) => (
                    <div key={fname} className="group relative aspect-video bg-navy-card rounded-lg overflow-hidden border border-sky-500/30 shadow-md transition-all duration-300 hover:scale-[1.02]">
                      <img 
                        src={videoId ? getFrameImageUrl(videoId, fname) : ''} 
                        alt={fname}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 flex justify-between items-center text-[10px] text-slate-200 font-mono">
                        <span className="truncate">{fname}</span>
                        {idx === recentThumbnails.slice(-4).length - 1 && (
                          <span className="bg-sky-500/80 text-white px-1 py-0.2 rounded text-[8px] font-sans font-bold uppercase">New</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  [1, 2, 3, 4].map((i) => (
                    <div key={i} className="aspect-video bg-[#0c162b] border border-navy-border/60 rounded-lg flex flex-col items-center justify-center p-2 text-slate-600 animate-pulse">
                      <ImageIcon className="w-5 h-5 mb-1" />
                      <span className="text-[10px]">Processing...</span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

        {/* EXTRACTED state: Complete status, key summary & workspace auto-redirect */}
        {uploadState === 'extracted' && (
          <div className="text-center p-8 flex flex-col items-center justify-center min-h-[320px]">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-bold text-slate-100">
              Dataset Created Successfully!
            </h3>
            <p className="text-slate-400 text-sm mt-1 mb-6 max-w-lg mx-auto">
              Hybrid Adaptive Keyframe Selection compressed <strong className="text-slate-200">{totalVideoFrames.toLocaleString()} video frames</strong> into <strong className="text-emerald-400">{framesExtracted.toLocaleString()} keyframes</strong> ({compressionRatio}× compression ratio).
            </p>

            {/* Scientific Breakdown Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl mb-8">
              <div className="bg-[#0c162b]/80 border border-navy-border p-4 rounded-xl text-center">
                <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Frames Processed</span>
                <span className="block text-slate-100 font-bold text-xl mt-1 font-mono">{totalVideoFrames.toLocaleString()}</span>
              </div>
              <div className="bg-[#0c162b]/80 border border-navy-border p-4 rounded-xl text-center">
                <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Keyframes Saved</span>
                <span className="block text-emerald-400 font-bold text-xl mt-1 font-mono">{framesExtracted.toLocaleString()}</span>
              </div>
              <div className="bg-[#0c162b]/80 border border-navy-border p-4 rounded-xl text-center">
                <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Dataset Compression</span>
                <span className="block text-ocean-cyan font-bold text-xl mt-1 font-mono">{compressionRatio}×</span>
                <span className="block text-[10px] text-slate-400 font-mono">{totalVideoFrames} → {framesExtracted}</span>
              </div>
              <div className="bg-[#0c162b]/80 border border-navy-border p-4 rounded-xl text-center">
                <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Resolution</span>
                <span className="block text-slate-200 font-bold text-sm mt-2 font-mono">{resolution || '1920 x 1080'}</span>
              </div>
            </div>

            {/* Auto Redirect Banner */}
            {autoRedirectSeconds !== null && (
              <div className="bg-sky-950/30 border border-sky-500/30 px-5 py-2.5 rounded-lg mb-8 text-xs text-sky-300 flex items-center space-x-2">
                <Clock className="w-4 h-4 text-sky-400 animate-spin" />
                <span>Redirecting to Annotation Workspace in <strong>{autoRedirectSeconds}s</strong>...</span>
              </div>
            )}

            <div className="flex space-x-4">
              <button
                onClick={handleReset}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-navy-border text-slate-300 font-medium rounded-lg transition-colors text-sm"
              >
                Upload Different Video
              </button>
              <button
                onClick={handleGoToWorkspace}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg flex items-center space-x-2 transition-all duration-200 shadow-lg shadow-emerald-600/20 text-sm animate-pulse"
              >
                <span>Continue to Annotation Workspace</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ERROR state */}
        {uploadState === 'error' && (
          <div className="text-center p-12 flex flex-col items-center justify-center min-h-[320px]">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 animate-pulse">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-100">Upload Process Failed</h3>
            <p className="text-rose-400/90 text-sm font-medium mt-2 max-w-md mx-auto bg-rose-950/20 border border-rose-900/30 px-4 py-2 rounded-lg">
              {errorMsg}
            </p>
            <button
              onClick={handleReset}
              className="mt-6 px-6 py-2.5 bg-slate-800 hover:bg-slate-700 border border-navy-border text-slate-300 font-medium rounded-lg transition-colors text-sm"
            >
              Try Again
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default Upload;
