import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  UploadCloud,
  Layers,
  BarChart3,
  PlayCircle,
  HelpCircle,
  FileVideo,
  FolderHeart,
  TrendingUp,
  Cpu,
  Loader2,
  CheckCircle2,
  Clock,
  MoreVertical,
  Trash2,
  Check,
  AlertCircle,
  HardDrive
} from 'lucide-react';
import {
  getDatasetStatus,
  deleteUploadedVideoOnly,
  deleteCompleteDataset
} from '../services/videoService';
import type { VideoStatusItem } from '../types/api';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Menu and modal states
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [videoToDeleteOnly, setVideoToDeleteOnly] = useState<VideoStatusItem | null>(null);
  const [videoToDeleteAll, setVideoToDeleteAll] = useState<VideoStatusItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Fetch dataset-wide status for metrics and listings
  const { data: statusData, isLoading } = useQuery({
    queryKey: ['dataset-status'],
    queryFn: getDatasetStatus,
    refetchInterval: 10000,
  });

  const stats = statusData || {
    total_videos: 0,
    total_frames: 0,
    skipped_frames: 0,
    effective_total_frames: 0,
    annotated_frames: 0,
    remaining_frames: 0,
    overall_completion_rate: 0,
    videos: []
  };

  const activeVideos = stats.videos.filter(v => v.status === 'annotating');

  const showToast = (type: 'success' | 'error', message: string) => {
    setToastMessage({ type, message });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleConfirmDeleteVideoOnly = async () => {
    if (!videoToDeleteOnly) return;
    setIsDeleting(true);
    try {
      const res = await deleteUploadedVideoOnly(videoToDeleteOnly.video_id);
      showToast('success', res.message || 'Uploaded video removed successfully.');
      queryClient.invalidateQueries({ queryKey: ['dataset-status'] });
      setVideoToDeleteOnly(null);
    } catch (err: any) {
      showToast('error', err.response?.data?.detail || 'Failed to delete video file.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteCompleteDataset = async () => {
    if (!videoToDeleteAll) return;
    setIsDeleting(true);
    try {
      const res = await deleteCompleteDataset(videoToDeleteAll.video_id);
      showToast('success', res.message || 'Complete dataset deleted successfully.');
      queryClient.invalidateQueries({ queryKey: ['dataset-status'] });
      setVideoToDeleteAll(null);
    } catch (err: any) {
      showToast('error', err.response?.data?.detail || 'Failed to delete complete dataset.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn relative">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-2xl flex items-center space-x-3 text-sm animate-fadeIn ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-300'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <Check className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-400" />
          )}
          <span>{toastMessage.message}</span>
        </div>
      )}

      {/* Welcome Hero Panel */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#0c1b35] via-navy-panel to-[#09152b] border border-navy-border p-8 md:p-10 rounded-2xl shadow-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="absolute top-0 right-0 w-80 h-80 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-20 w-60 h-60 bg-ocean-cyan/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 space-y-3">
          <span className="text-[10px] font-bold tracking-widest text-sky-400 bg-sky-500/10 px-2.5 py-1 rounded-full uppercase border border-sky-500/20">
            Phase 1 Active
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-100 tracking-wide">
            Underwater HITL Platform
          </h1>
          <p className="text-slate-400 text-sm md:text-base max-w-xl leading-relaxed">
            Human-in-the-Loop annotation workspace for custom YOLO object detection. Upload underwater videos, extract frames, and label subsea organisms or obstacles.
          </p>
        </div>

        <div className="relative z-10 flex flex-wrap gap-3">
          <Link
            to="/upload"
            className="px-5 py-3 bg-sky-600 hover:bg-sky-500 text-slate-100 text-sm font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-sky-600/10 hover:shadow-sky-600/20 hover:-translate-y-0.5 transition-all duration-200"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload New Footage</span>
          </Link>
          <Link
            to="/status"
            className="px-5 py-3 bg-navy-card hover:bg-slate-800 border border-navy-border text-slate-300 text-sm font-semibold rounded-xl flex items-center gap-2 hover:-translate-y-0.5 transition-all duration-200"
          >
            <BarChart3 className="w-4 h-4 text-sky-400" />
            <span>Analytics Status</span>
          </Link>
        </div>
      </div>

      {/* Quick Status Bar */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-ocean-cyan" />
          <span>Synchronizing platform stats...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#0b1426]/60 border border-navy-border/60 p-4 rounded-xl flex items-center gap-4">
            <div className="p-2.5 bg-sky-500/10 rounded-lg text-sky-400">
              <FileVideo className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Total Video Datasets</span>
              <span className="block text-xl font-bold text-slate-200 font-mono mt-0.5">{stats.total_videos}</span>
            </div>
          </div>
          <div className="bg-[#0b1426]/60 border border-navy-border/60 p-4 rounded-xl flex items-center gap-4">
            <div className="p-2.5 bg-sky-500/10 rounded-lg text-sky-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Annotated Frames</span>
              <span className="block text-xl font-bold text-slate-200 font-mono mt-0.5">
                {stats.annotated_frames} <span className="text-xs text-slate-500 font-normal">/ {stats.effective_total_frames ?? stats.total_frames}</span>
              </span>
            </div>
          </div>
          <div className="bg-[#0b1426]/60 border border-navy-border/60 p-4 rounded-xl flex items-center gap-4">
            <div className="p-2.5 bg-sky-500/10 rounded-lg text-sky-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Dataset Completion</span>
                <span className="text-xs font-bold text-ocean-cyan font-mono">{stats.overall_completion_rate}%</span>
              </div>
              <div className="w-full h-1.5 bg-navy-card rounded-full mt-1.5 overflow-hidden border border-navy-border/50">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-ocean-cyan rounded-full transition-all"
                  style={{ width: `${stats.overall_completion_rate}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left 2 Cols: Active runs list */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-200 tracking-wide flex items-center gap-2">
              <PlayCircle className="w-5 h-5 text-sky-400" />
              Active Annotation Runs
            </h3>
            <span className="text-xs font-bold text-slate-500 bg-navy-card px-2 py-0.5 rounded border border-navy-border">
              {activeVideos.length} In Progress
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2].map(i => (
                <div key={i} className="h-28 bg-navy-panel/40 border border-navy-border rounded-xl animate-pulse" />
              ))}
            </div>
          ) : stats.videos.length === 0 ? (
            <div className="text-center p-12 bg-navy-panel/20 border border-dashed border-navy-border rounded-xl">
              <FolderHeart className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No video datasets found.</p>
              <p className="text-slate-500 text-xs mt-1">Get started by uploading your first underwater video file.</p>
              <Link
                to="/upload"
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white rounded-lg transition-colors"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Upload Video
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {stats.videos.map((vid) => {
                const isCompleted = vid.status === 'completed' || vid.completion_rate >= 100;
                const isAnnotating = vid.status === 'annotating' && vid.completion_rate < 100;
                
                return (
                  <div
                    key={vid.video_id}
                    className="p-5 bg-navy-panel hover:bg-navy-panel/85 border border-navy-border hover:border-sky-500/30 rounded-xl transition-all duration-200 shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4 group relative overflow-visible"
                  >
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-mono font-bold text-ocean-cyan bg-sky-950/45 px-2 py-0.5 rounded border border-sky-900/30">
                          {vid.video_id}
                        </code>
                        <h4 className="font-semibold text-slate-200 text-sm truncate max-w-[280px]" title={vid.filename}>
                          {vid.filename}
                        </h4>
                        
                        {vid.video_deleted && (
                          <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <HardDrive className="w-3 h-3" />
                            Video Removed (Storage Saved)
                          </span>
                        )}

                        {isCompleted ? (
                          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-900/30 px-2 py-0.5 rounded-full uppercase flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Completed
                          </span>
                        ) : isAnnotating ? (
                          <span className="text-[9px] font-bold text-sky-400 bg-sky-950/40 border border-sky-900/30 px-2 py-0.5 rounded-full uppercase flex items-center gap-1 animate-pulse">
                            <Clock className="w-2.5 h-2.5" />
                            Labeling
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full uppercase">
                            Uploaded
                          </span>
                        )}

                        {vid.status !== 'uploaded' && (
                          <span className="text-[9px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full uppercase">
                            {vid.motion_profile || 'Moderate'}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-5 flex-wrap text-xs text-slate-500">
                        {vid.status !== 'uploaded' ? (
                          <>
                            <span>Keyframes: <strong className="text-slate-400 font-semibold">{vid.total_frames}</strong></span>
                            {vid.original_total_frames > 0 && (
                              <>
                                <span>Original: <strong className="text-slate-400 font-semibold">{vid.original_total_frames}</strong></span>
                                <span>Reduction: <strong className="text-slate-400 font-semibold">{vid.reduction_ratio}x</strong></span>
                              </>
                            )}
                          </>
                        ) : (
                          <span>Footage uploaded</span>
                        )}
                        <span>Labeled: <strong className="text-slate-400 font-semibold">{vid.annotated_frames}</strong></span>
                        {!!vid.skipped_frames && (
                          <span>Skipped: <strong className="text-slate-400 font-semibold">{vid.skipped_frames}</strong></span>
                        )}
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-navy-card rounded-full overflow-hidden border border-navy-border/50">
                            <div className="h-full bg-sky-500 rounded-full" style={{ width: `${vid.completion_rate}%` }} />
                          </div>
                          <span className="font-bold text-slate-400 font-mono text-[10px]">{vid.completion_rate}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Button Group: [Annotate] [⋮] */}
                    <div className="flex items-center space-x-2 w-full md:w-auto">
                      <button
                        onClick={() => navigate(`/workspace?video_id=${vid.video_id}`)}
                        className="flex-1 md:flex-initial px-4 py-2 bg-navy-card hover:bg-sky-600 border border-navy-border hover:border-transparent text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1 group-hover:shadow-[0_0_8px_rgba(3,105,161,0.2)]"
                      >
                        <span>{isCompleted ? 'View Labels' : 'Annotate'}</span>
                        <PlayCircle className="w-3.5 h-3.5" />
                      </button>

                      {/* Three-Dot (⋮) Menu Button */}
                      <div className="relative">
                        <button
                          onClick={() => setOpenMenuId(openMenuId === vid.video_id ? null : vid.video_id)}
                          className="p-2 rounded-lg bg-navy-card border border-navy-border/80 text-slate-400 hover:text-slate-100 hover:border-slate-500 transition-colors"
                          title="Manage Dataset"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {openMenuId === vid.video_id && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setOpenMenuId(null)}
                            />
                            <div className="absolute right-0 mt-2 w-60 bg-navy-panel border border-navy-border rounded-xl shadow-2xl z-50 py-1 text-xs text-left divide-y divide-navy-border/50">
                              <div className="px-3.5 py-2 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                                Manage Dataset
                              </div>
                              <div className="py-1">
                                <button
                                  disabled={vid.video_deleted}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setVideoToDeleteOnly(vid);
                                  }}
                                  className={`w-full px-3.5 py-2 flex items-center space-x-2.5 text-left transition-colors ${
                                    vid.video_deleted
                                      ? 'opacity-40 cursor-not-allowed text-slate-500'
                                      : 'text-amber-300 hover:bg-amber-500/10'
                                  }`}
                                >
                                  <FileVideo className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                  <div>
                                    <span className="font-semibold block">Delete Uploaded Video</span>
                                    <span className="text-[10px] text-slate-400 font-normal">Keep frames & labels</span>
                                  </div>
                                </button>

                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setVideoToDeleteAll(vid);
                                  }}
                                  className="w-full px-3.5 py-2 flex items-center space-x-2.5 text-left text-rose-400 hover:bg-rose-500/10 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4 text-rose-400 flex-shrink-0" />
                                  <div>
                                    <span className="font-semibold block">Delete Complete Dataset</span>
                                    <span className="text-[10px] text-slate-400 font-normal">Remove all files & stats</span>
                                  </div>
                                </button>
                              </div>
                              <div className="py-1">
                                <button
                                  onClick={() => setOpenMenuId(null)}
                                  className="w-full px-3.5 py-1.5 text-slate-400 hover:text-slate-200 hover:bg-navy-card"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 1 Col: Info panel and system guidelines */}
        <div className="space-y-6">
          <h3 className="text-lg font-bold text-slate-200 tracking-wide flex items-center gap-2">
            <Cpu className="w-5 h-5 text-sky-400" />
            HITL Workflow
          </h3>

          <div className="bg-navy-panel border border-navy-border rounded-xl shadow-lg p-5 space-y-4 text-xs text-slate-400 leading-relaxed">
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-sky-500/10 border border-sky-400/30 text-sky-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                  1
                </div>
                <div>
                  <span className="font-semibold text-slate-300 block">Footage Upload</span>
                  Submit underwater video runs (MP4, AVI, MOV) for processing.
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-sky-500/10 border border-sky-400/30 text-sky-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                  2
                </div>
                <div>
                  <span className="font-semibold text-slate-300 block">Frame Extraction</span>
                  FastAPI runs OpenCV to decompose videos into discrete JPEG frames.
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-sky-500/10 border border-sky-400/30 text-sky-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                  3
                </div>
                <div>
                  <span className="font-semibold text-slate-300 block">Manual Labeling</span>
                  Use Fabric.js canvas to draw object bounding boxes and assign class labels.
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-sky-500/10 border border-sky-400/30 text-sky-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                  4
                </div>
                <div>
                  <span className="font-semibold text-slate-300 block">Export Dataset</span>
                  Annotations are auto-converted to normalized YOLO coordinates (`.txt`) for AI training.
                </div>
              </div>
            </div>
          </div>

          {/* Quick tips panel */}
          <div className="bg-gradient-to-br from-navy-panel to-[#09152b] border border-navy-border rounded-xl p-5 shadow-lg space-y-2">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
              Quick Workspace Tips
            </h4>
            <ul className="list-disc pl-4 text-[11px] text-slate-400 space-y-1.5 leading-relaxed">
              <li>Use keybinds <kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px] text-slate-300">A</kbd> and <kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px] text-slate-300">D</kbd> to change frames instantly.</li>
              <li>Press <kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px] text-slate-300">Del</kbd> to delete a selected bounding box.</li>
              <li>Enable **Auto Save** in the top bar to save labels dynamically as you scroll.</li>
            </ul>
          </div>

        </div>

      </div>

      {/* Confirmation Modal 1 — Delete Uploaded Video Only */}
      {videoToDeleteOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-navy-panel border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <FileVideo className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Delete Uploaded Video</h3>
                <p className="text-xs text-amber-300">The uploaded source video will be permanently removed.</p>
              </div>
            </div>

            <div className="bg-navy-card/90 border border-navy-border/80 rounded-xl p-4 space-y-3 text-xs">
              <p className="font-semibold text-slate-300">The following data will be preserved:</p>
              <div className="space-y-1.5 text-slate-300">
                <div className="flex items-center space-x-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>✓ Extracted Key Frames</span>
                </div>
                <div className="flex items-center space-x-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>✓ Annotation Progress</span>
                </div>
                <div className="flex items-center space-x-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>✓ YOLO Labels</span>
                </div>
                <div className="flex items-center space-x-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>✓ Dataset Metadata</span>
                </div>
                <div className="flex items-center space-x-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>✓ Exported Dataset</span>
                </div>
              </div>
              <p className="text-[11px] text-amber-400/90 pt-2 border-t border-navy-border/60">
                Only the original uploaded video will be deleted. This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-navy-border/60">
              <button
                onClick={() => setVideoToDeleteOnly(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-navy-card border border-navy-border text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteVideoOnly}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-navy-dark transition-all flex items-center space-x-1.5 shadow-lg shadow-amber-500/20 font-bold"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>{isDeleting ? 'Deleting Video...' : 'Delete Video'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal 2 — Delete Complete Dataset */}
      {videoToDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-navy-panel border border-rose-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Delete Complete Dataset</h3>
                <p className="text-xs text-rose-300">This will permanently remove every resource associated with this dataset.</p>
              </div>
            </div>

            <div className="bg-rose-950/20 border border-rose-500/30 rounded-xl p-4 space-y-2.5 text-xs text-rose-200">
              <p className="font-semibold text-rose-300">The following will be deleted:</p>
              <ul className="list-disc list-inside space-y-1 text-rose-300/90 font-mono text-[11px]">
                <li>Uploaded Video</li>
                <li>Extracted Key Frames</li>
                <li>Annotation Metadata</li>
                <li>YOLO Labels</li>
                <li>Dataset Statistics</li>
                <li>Progress Information</li>
                <li>Temporary Files</li>
              </ul>
              <p className="text-[11px] text-rose-400 font-bold pt-2 border-t border-rose-900/50">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-navy-border/60">
              <button
                onClick={() => setVideoToDeleteAll(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-navy-card border border-navy-border text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteCompleteDataset}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-all flex items-center space-x-1.5 shadow-lg shadow-rose-600/30 font-bold"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>{isDeleting ? 'Deleting Everything...' : 'Delete Everything'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
