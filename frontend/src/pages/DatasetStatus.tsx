import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Video,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  ExternalLink,
  TrendingUp,
  Tag,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { getDatasetStatus, getClasses } from '../services/videoService';

const DatasetStatus: React.FC = () => {
  // Fetch dataset global status metrics from FastAPI
  const { data: statusData, isLoading, isError, error } = useQuery({
    queryKey: ['dataset-status'],
    queryFn: getDatasetStatus,
    refetchInterval: 10000, // Poll every 10 seconds to keep analytics fresh
  });

  // Fetch unique classes vocabulary list
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: getClasses,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
        <Loader2 className="w-12 h-12 text-ocean-cyan animate-spin" />
        <p className="text-slate-400 text-sm font-medium">Fetching annotation metrics...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-rose-950/20 border border-rose-500/30 rounded-xl text-center">
        <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-slate-100">Failed to Load Status</h3>
        <p className="mt-2 text-rose-300 text-xs leading-relaxed">
          {error instanceof Error ? error.message : 'Could not establish connection to the backend server.'}
        </p>
      </div>
    );
  }

  const stats = statusData || {
    total_videos: 0,
    total_frames: 0,
    annotated_frames: 0,
    remaining_frames: 0,
    overall_completion_rate: 0,
    videos: []
  };

  const classesList = classesData || [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-navy-border pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-100 tracking-wide flex items-center gap-2.5">
            <BarChart3 className="w-8 h-8 text-sky-400" />
            Dataset Annotation Analytics
          </h1>
          <p className="mt-2 text-slate-400 text-sm max-w-xl">
            Overview of the human-in-the-loop training corpus. Tracks active annotation counts and completed subsea footage.
          </p>
        </div>
      </div>

      {/* Aggregate Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Videos */}
        <div className="bg-navy-panel border border-navy-border p-6 rounded-xl shadow-lg relative overflow-hidden group hover:border-sky-500/35 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Videos</span>
              <span className="text-3xl font-bold text-slate-100 mt-2 block">{stats.total_videos}</span>
            </div>
            <div className="p-3 bg-sky-500/10 rounded-lg text-sky-400 group-hover:scale-110 transition-transform">
              <Video className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-4 text-[10px] text-slate-500">Unique subsea video sources uploaded</div>
        </div>

        {/* Total Frames */}
        <div className="bg-navy-panel border border-navy-border p-6 rounded-xl shadow-lg relative overflow-hidden group hover:border-sky-500/35 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Frames</span>
              <span className="text-3xl font-bold text-slate-100 mt-2 block">{stats.total_frames}</span>
            </div>
            <div className="p-3 bg-sky-500/10 rounded-lg text-sky-400 group-hover:scale-110 transition-transform">
              <ImageIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-4 text-[10px] text-slate-500">JPEG frames extracted from footage</div>
        </div>

        {/* Annotated Frames */}
        <div className="bg-navy-panel border border-navy-border p-6 rounded-xl shadow-lg relative overflow-hidden group hover:border-sky-500/35 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Annotated Frames</span>
              <span className="text-3xl font-bold text-emerald-400 mt-2 block">{stats.annotated_frames}</span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-400 group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-4 text-[10px] text-slate-500">{stats.remaining_frames} remaining frames to label</div>
        </div>

        {/* Completion Rate */}
        <div className="bg-navy-panel border border-navy-border p-6 rounded-xl shadow-lg relative overflow-hidden group hover:border-sky-500/35 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Overall Completion</span>
              <span className="text-3xl font-bold text-ocean-cyan mt-2 block">{stats.overall_completion_rate}%</span>
            </div>
            <div className="p-3 bg-cyan-500/10 rounded-lg text-ocean-cyan group-hover:scale-110 transition-transform">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-4 text-[10px] text-slate-500">Average dataset progress rate</div>
        </div>
      </div>

      {/* Global Progress Section */}
      <div className="bg-navy-panel border border-navy-border p-6 rounded-xl shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-300">Overall Dataset Progress</span>
          <span className="text-sm font-bold text-ocean-cyan">{stats.overall_completion_rate}%</span>
        </div>
        <div className="w-full h-3.5 bg-navy-card rounded-full overflow-hidden border border-navy-border">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-ocean-cyan rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(0,240,255,0.4)]"
            style={{ width: `${stats.overall_completion_rate}%` }}
          />
        </div>
      </div>

      {/* Main Grid: Videos details & classes vocabulary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Videos Status Table */}
        <div className="lg:col-span-2 bg-navy-panel border border-navy-border rounded-xl shadow-xl overflow-hidden flex flex-col">
          <div className="p-5 border-b border-navy-border bg-[#0b1426]">
            <h3 className="text-base font-bold text-slate-100 tracking-wide">Footage Annotation Status</h3>
            <p className="text-slate-400 text-xs mt-1">Detailed status breakdown for individual uploaded video runs.</p>
          </div>

          <div className="overflow-x-auto flex-1">
            {stats.videos.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No videos uploaded yet. Go to <Link to="/upload" className="text-sky-400 hover:underline">Upload</Link> to start.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-navy-border bg-[#0c162b]/30 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                    <th className="p-4 pl-6">Video / File</th>
                    <th className="p-4 text-center">Progress</th>
                    <th className="p-4 text-center">Frames Labeled</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-border/50 text-sm">
                  {stats.videos.map((vid) => {
                    const isCompleted = vid.status === 'completed';
                    const isAnnotating = vid.status === 'annotating';
                    return (
                      <tr key={vid.video_id} className="hover:bg-[#0c162b]/20 transition-colors">
                        <td className="p-4 pl-6">
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-slate-200 truncate max-w-[200px]" title={vid.filename}>
                              {vid.filename}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500 mt-0.5">{vid.video_id}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col items-center space-y-1">
                            <span className="text-xs font-bold text-slate-300 font-mono">{vid.completion_rate}%</span>
                            <div className="w-24 h-1.5 bg-navy-card rounded-full overflow-hidden border border-navy-border/50">
                              <div
                                className="h-full bg-sky-500 rounded-full transition-all"
                                style={{ width: `${vid.completion_rate}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <span className="text-xs font-semibold text-slate-300">
                            {vid.annotated_frames} <span className="text-slate-500">/ {vid.total_frames}</span>
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          {isCompleted ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-900/35 px-2 py-0.5 rounded-full uppercase">
                              <CheckCircle2 className="w-3 h-3" />
                              Done
                            </span>
                          ) : isAnnotating ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-400 bg-sky-950/40 border border-sky-900/35 px-2 py-0.5 rounded-full uppercase animate-pulse">
                              <Clock className="w-3 h-3" />
                              Labeling
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-900/50 border border-slate-800 px-2 py-0.5 rounded-full uppercase">
                              Uploaded
                            </span>
                          )}
                        </td>
                        <td className="p-4 pr-6 text-right">
                          <Link
                            to={`/workspace?video_id=${vid.video_id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-navy-card hover:bg-sky-600/20 border border-navy-border hover:border-sky-500/50 rounded-lg text-xs font-semibold text-sky-400 hover:text-slate-100 transition-all"
                          >
                            <span>Open</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Classes Vocabulary Card */}
        <div className="bg-navy-panel border border-navy-border rounded-xl shadow-xl p-5 flex flex-col h-fit">
          <div className="border-b border-navy-border pb-4 mb-4">
            <h3 className="text-base font-bold text-slate-100 tracking-wide flex items-center gap-2">
              <Tag className="w-4 h-4 text-sky-400" />
              Dynamic Class Dictionary
            </h3>
            <p className="text-slate-400 text-xs mt-1">Class labels registered dynamically during annotation.</p>
          </div>

          {classesList.length === 0 ? (
            <div className="py-8 text-center border border-dashed border-navy-border rounded-lg bg-[#0c162b]/20">
              <span className="text-xs text-slate-500">No classes registered yet. Labels will appear here once saved in workspace.</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {classesList.map((lbl) => (
                  <span
                    key={lbl}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-navy-card border border-navy-border hover:border-sky-500/30 text-slate-200 rounded-lg transition-colors cursor-default"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-ocean-cyan shadow-[0_0_6px_rgba(0,240,255,0.7)]" />
                    {lbl}
                  </span>
                ))}
              </div>
              <div className="bg-[#0c162b]/50 border border-navy-border rounded-lg p-3 text-[11px] text-slate-400 leading-relaxed">
                <span className="font-bold text-slate-300 block mb-1">💡 Pro Tip</span>
                Adding labels in the Bounding Box Properties panel automatically registers new species or object classes here!
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DatasetStatus;
