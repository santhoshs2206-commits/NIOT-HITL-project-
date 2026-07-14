import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { 
  UploadCloud, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  FileVideo, 
  Play, 
  Image as ImageIcon 
} from 'lucide-react';
import { uploadVideo, extractFrames } from '../services/videoService';

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'extracting' | 'extracted' | 'error';

const ALLOWED_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];

const Upload: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // States
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [numFrames, setNumFrames] = useState<number>(0);
  const [resolution, setResolution] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

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
    mutationFn: extractFrames,
    onSuccess: (data) => {
      setNumFrames(data.frames_extracted);
      setResolution(`${data.frame_width} x ${data.frame_height}`);
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
    extractMutation.mutate(videoId);
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
    setUploadState('idle');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto flex flex-col justify-center min-h-[80vh]">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-100 tracking-wide">
          Upload Underwater Footage
        </h1>
        <p className="mt-2 text-slate-400 max-w-md mx-auto">
          Add MP4, AVI, MOV, or WEBM subsea videos to extract individual frames for labeling.
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
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center min-h-[300px] ${
              isDragOver 
                ? 'border-ocean-cyan bg-sky-500/5' 
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
            <div className="w-16 h-16 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-400 mb-4 group-hover:scale-110 transition-transform">
              <UploadCloud className="w-8 h-8" />
            </div>
            <p className="text-slate-200 font-semibold text-lg">
              Drag and drop your video here
            </p>
            <p className="text-slate-400 text-sm mt-1">
              or click to browse local files
            </p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              {ALLOWED_EXTENSIONS.map((ext) => (
                <span key={ext} className="text-[10px] font-bold px-2 py-0.5 bg-navy-card border border-navy-border text-slate-400 rounded uppercase">
                  {ext.slice(1)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* UPLOADING state */}
        {uploadState === 'uploading' && (
          <div className="text-center p-12 flex flex-col items-center justify-center min-h-[300px]">
            <Loader2 className="w-12 h-12 text-ocean-cyan animate-spin mb-4" />
            <p className="text-slate-200 font-medium text-lg">Uploading video content...</p>
            <p className="text-slate-400 text-sm mt-1">{file?.name}</p>
            {file && (
              <span className="text-xs text-slate-500 mt-2">
                Size: {(file.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            )}
          </div>
        )}

        {/* UPLOADED state: Success message, show Video ID & extract triggers */}
        {uploadState === 'uploaded' && (
          <div className="text-center p-10 flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-100">Video Uploaded Successfully!</h3>
            <p className="text-slate-400 text-sm mt-1 mb-6">{file?.name}</p>

            <div className="bg-[#0c162b] border border-navy-border px-6 py-3 rounded-lg mb-6 flex items-center space-x-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assigned ID:</span>
              <code className="text-ocean-cyan font-mono text-base font-semibold">{videoId}</code>
            </div>

            <div className="flex space-x-4">
              <button
                onClick={handleReset}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-navy-border text-slate-300 font-medium rounded-lg transition-colors"
              >
                Upload Another
              </button>
              <button
                onClick={handleStartExtraction}
                disabled={extractMutation.isPending}
                className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg flex items-center space-x-2 transition-all duration-200 shadow-lg shadow-sky-600/20"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Extract Video Frames</span>
              </button>
            </div>
          </div>
        )}

        {/* EXTRACTING state: Show Loading Skeleton */}
        {uploadState === 'extracting' && (
          <div className="p-8 min-h-[300px] flex flex-col justify-center">
            <div className="flex flex-col items-center mb-6">
              <Loader2 className="w-10 h-10 text-ocean-cyan animate-spin mb-3" />
              <p className="text-slate-200 font-medium text-lg">Extracting individual frames...</p>
              <p className="text-slate-400 text-xs mt-1">This uses OpenCV in the backend to split frames into JPEG formats.</p>
            </div>

            {/* Skeletons block to simulate visual frames extraction */}
            <div className="grid grid-cols-4 gap-4 animate-pulse mt-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="aspect-video bg-[#0c162b] border border-navy-border rounded-lg flex items-center justify-center">
                  <ImageIcon className="w-6 h-6 text-navy-border" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* EXTRACTED state: Complete status and workspace navigation link */}
        {uploadState === 'extracted' && (
          <div className="text-center p-10 flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 animate-pulse">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-100">
              ✅ Successfully extracted {numFrames} frames ({resolution})
            </h3>
            <p className="text-slate-400 text-sm mt-2 mb-6">OpenCV extraction sequence executed cleanly.</p>

            <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
              <div className="bg-[#0c162b] border border-navy-border p-4 rounded-lg text-center">
                <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Frames Extracted</span>
                <span className="block text-ocean-cyan font-bold text-xl mt-1">{numFrames}</span>
              </div>
              <div className="bg-[#0c162b] border border-navy-border p-4 rounded-lg text-center">
                <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Resolution</span>
                <span className="block text-ocean-cyan font-bold text-xl mt-1">{resolution}</span>
              </div>
            </div>

            <div className="flex space-x-4">
              <button
                onClick={handleReset}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-navy-border text-slate-300 font-medium rounded-lg transition-colors"
              >
                Upload Different Video
              </button>
              <button
                onClick={handleGoToWorkspace}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg flex items-center space-x-2 transition-all duration-200 shadow-lg shadow-emerald-600/20"
              >
                <FileVideo className="w-4 h-4" />
                <span>Go to Workspace</span>
              </button>
            </div>
          </div>
        )}

        {/* ERROR state */}
        {uploadState === 'error' && (
          <div className="text-center p-12 flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 animate-pulse">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-100">Upload Process Failed</h3>
            <p className="text-rose-400/90 text-sm font-medium mt-2 max-w-md mx-auto bg-rose-950/20 border border-rose-900/30 px-4 py-2 rounded-lg">
              {errorMsg}
            </p>
            <button
              onClick={handleReset}
              className="mt-6 px-6 py-2.5 bg-slate-800 hover:bg-slate-700 border border-navy-border text-slate-300 font-medium rounded-lg transition-colors"
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
