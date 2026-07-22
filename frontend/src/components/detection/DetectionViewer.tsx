import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Columns,
  Eye,
  Volume2,
  VolumeX,
  RotateCcw
} from 'lucide-react';
import { detectionService } from '../../services/detectionService';

interface DetectionViewerProps {
  jobId: string;
  seekTimestamp?: number | null;
}

export const DetectionViewer: React.FC<DetectionViewerProps> = ({ jobId, seekTimestamp }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeTab, setActiveTab] = useState<'processed' | 'original' | 'side-by-side'>('processed');
  const [isMuted, setIsMuted] = useState(true);

  const videoRefProcessed = useRef<HTMLVideoElement>(null);
  const videoRefOriginal = useRef<HTMLVideoElement>(null);

  const processedUrl = detectionService.getDownloadVideoUrl(jobId);
  const originalUrl = detectionService.getOriginalVideoUrl(jobId);

  // Trigger video reload when src or active tab changes
  useEffect(() => {
    if (videoRefProcessed.current) {
      videoRefProcessed.current.load();
    }
    if (videoRefOriginal.current) {
      videoRefOriginal.current.load();
    }
    setIsPlaying(false);
  }, [processedUrl, originalUrl, activeTab]);

  // Synchronize frame seek when timeline item is clicked
  useEffect(() => {
    if (seekTimestamp !== undefined && seekTimestamp !== null) {
      if (videoRefProcessed.current) {
        videoRefProcessed.current.currentTime = seekTimestamp;
      }
      if (videoRefOriginal.current) {
        videoRefOriginal.current.currentTime = seekTimestamp;
      }
      setCurrentTime(seekTimestamp);
    }
  }, [seekTimestamp]);

  const togglePlay = () => {
    if (activeTab === 'side-by-side') {
      if (isPlaying) {
        videoRefProcessed.current?.pause();
        videoRefOriginal.current?.pause();
      } else {
        videoRefProcessed.current?.play();
        videoRefOriginal.current?.play();
      }
    } else if (activeTab === 'processed') {
      if (isPlaying) {
        videoRefProcessed.current?.pause();
      } else {
        videoRefProcessed.current?.play();
      }
    } else {
      if (isPlaying) {
        videoRefOriginal.current?.pause();
      } else {
        videoRefOriginal.current?.play();
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setCurrentTime(e.currentTarget.currentTime);
    setDuration(e.currentTarget.duration || 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (videoRefProcessed.current) videoRefProcessed.current.currentTime = time;
    if (videoRefOriginal.current) videoRefOriginal.current.currentTime = time;
  };

  const stepFrame = (frames: number) => {
    // Assuming ~30 fps
    const step = frames * (1 / 30);
    const newTime = Math.max(0, Math.min(duration, currentTime + step));
    setCurrentTime(newTime);
    if (videoRefProcessed.current) videoRefProcessed.current.currentTime = newTime;
    if (videoRefOriginal.current) videoRefOriginal.current.currentTime = newTime;
  };

  const toggleFullscreen = () => {
    const activeEl = activeTab === 'processed' ? videoRefProcessed.current : videoRefOriginal.current;
    if (activeEl?.requestFullscreen) {
      activeEl.requestFullscreen();
    }
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-navy-panel border border-navy-border rounded-xl p-5 shadow-xl space-y-4">
      {/* Header & Comparison Mode Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-navy-border/60">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-ocean-cyan">
            <Eye className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-100 text-base">Scientific Video Viewer</h3>
            <p className="text-xs text-slate-400">Frame-accurate object detection overlay & video comparison</p>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center bg-navy-card p-1 rounded-lg border border-navy-border/80 space-x-1">
          <button
            onClick={() => setActiveTab('processed')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center space-x-1.5 ${
              activeTab === 'processed'
                ? 'bg-ocean-cyan text-navy-dark shadow'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Processed Video</span>
          </button>
          <button
            onClick={() => setActiveTab('original')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center space-x-1.5 ${
              activeTab === 'original'
                ? 'bg-ocean-cyan text-navy-dark shadow'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <span>Original Video</span>
          </button>
          <button
            onClick={() => setActiveTab('side-by-side')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center space-x-1.5 ${
              activeTab === 'side-by-side'
                ? 'bg-ocean-cyan text-navy-dark shadow'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Side-by-Side</span>
          </button>
        </div>
      </div>

      {/* Video Container Area */}
      <div className="bg-black/90 rounded-xl overflow-hidden border border-navy-border/80 relative min-h-[320px] flex items-center justify-center">
        {activeTab === 'side-by-side' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 w-full gap-2 p-2">
            <div className="relative">
              <span className="absolute top-2 left-2 z-10 bg-navy-panel/80 border border-ocean-cyan/40 text-ocean-cyan text-[11px] font-mono px-2 py-0.5 rounded shadow">
                Processed (AI Detections)
              </span>
              <video
                ref={videoRefProcessed}
                src={processedUrl}
                onTimeUpdate={handleTimeUpdate}
                muted={isMuted}
                className="w-full rounded-lg"
              />
            </div>
            <div className="relative">
              <span className="absolute top-2 left-2 z-10 bg-navy-panel/80 border border-slate-600 text-slate-300 text-[11px] font-mono px-2 py-0.5 rounded shadow">
                Original Feed
              </span>
              <video
                ref={videoRefOriginal}
                src={originalUrl}
                muted={isMuted}
                className="w-full rounded-lg"
              />
            </div>
          </div>
        ) : (
          <div className="w-full relative">
            <video
              ref={videoRefProcessed}
              src={processedUrl}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              muted={isMuted}
              className={`w-full max-h-[500px] object-contain mx-auto ${activeTab === 'processed' ? 'block' : 'hidden'}`}
            />
            <video
              ref={videoRefOriginal}
              src={originalUrl}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              muted={isMuted}
              className={`w-full max-h-[500px] object-contain mx-auto ${activeTab === 'original' ? 'block' : 'hidden'}`}
            />
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div className="bg-navy-card/80 border border-navy-border/60 rounded-xl p-4 space-y-3">
        {/* Timeline Slider */}
        <div className="flex items-center space-x-3 text-xs font-mono">
          <span className="text-ocean-cyan font-bold">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.01"
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-2 bg-navy-panel rounded-lg appearance-none cursor-pointer accent-ocean-cyan"
          />
          <span className="text-slate-400">{formatTime(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => stepFrame(-1)}
              title="Previous Frame (1/30s)"
              className="p-2 rounded-lg bg-navy-panel border border-navy-border text-slate-300 hover:text-white hover:border-ocean-cyan transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              onClick={togglePlay}
              className="px-4 py-2 rounded-lg bg-ocean-cyan text-navy-dark font-bold text-sm flex items-center space-x-2 shadow-md shadow-cyan-500/20 hover:bg-cyan-300 transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>

            <button
              onClick={() => stepFrame(1)}
              title="Next Frame (1/30s)"
              className="p-2 rounded-lg bg-navy-panel border border-navy-border text-slate-300 hover:text-white hover:border-ocean-cyan transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                setCurrentTime(0);
                if (videoRefProcessed.current) videoRefProcessed.current.currentTime = 0;
                if (videoRefOriginal.current) videoRefOriginal.current.currentTime = 0;
              }}
              title="Reset Video"
              className="p-2 rounded-lg bg-navy-panel border border-navy-border text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 rounded-lg bg-navy-panel border border-navy-border text-slate-400 hover:text-slate-200 transition-colors"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              onClick={toggleFullscreen}
              title="Fullscreen"
              className="p-2 rounded-lg bg-navy-panel border border-navy-border text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DetectionViewer;
