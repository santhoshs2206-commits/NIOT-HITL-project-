import React from 'react';
import { BarChart3, Target } from 'lucide-react';
import type { DetectionSummary } from '../../types/detection';

interface DetectionStatisticsProps {
  summary: DetectionSummary | null;
}

export const DetectionStatistics: React.FC<DetectionStatisticsProps> = ({ summary }) => {
  if (!summary) return null;

  const classCounts = summary.class_counts || {};

  return (
    <div className="space-y-6">
      {/* Section Title */}
      <div className="flex items-center space-x-3 pb-2 border-b border-navy-border/60">
        <div className="w-9 h-9 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
          <BarChart3 className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-slate-100 text-lg">Detection Results Analytics</h3>
          <p className="text-xs text-slate-400">Class breakdowns, detection density, and performance metrics</p>
        </div>
      </div>

      {/* Class Distribution Grid */}
      <div>
        <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center space-x-2">
          <Target className="w-4 h-4 text-ocean-cyan" />
          <span>Detected Species & Objects by Class</span>
        </h4>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Object.keys(classCounts).length > 0 ? (
            Object.entries(classCounts).map(([clsName, count]) => (
              <div
                key={clsName}
                className="bg-navy-panel border border-navy-border/80 rounded-xl p-4 shadow-md flex flex-col justify-between hover:border-ocean-cyan/50 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-sm font-semibold text-slate-200 capitalize">{clsName}</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-ocean-cyan shadow-sm shadow-cyan-400" />
                </div>
                <div className="flex items-baseline space-x-1">
                  <span className="text-2xl font-bold font-mono text-ocean-cyan">{count}</span>
                  <span className="text-xs text-slate-400">detections</span>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full bg-navy-panel border border-navy-border p-4 rounded-xl text-center text-slate-400 text-sm">
              No objects detected matching the current confidence threshold.
            </div>
          )}
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Total Detections */}
        <div className="bg-navy-panel border border-navy-border p-4 rounded-xl space-y-1">
          <p className="text-xs text-slate-400">Total Detections</p>
          <p className="text-xl font-bold font-mono text-slate-100">{summary.total_detections}</p>
        </div>

        {/* Total Frames */}
        <div className="bg-navy-panel border border-navy-border p-4 rounded-xl space-y-1">
          <p className="text-xs text-slate-400">Total Frames</p>
          <p className="text-xl font-bold font-mono text-slate-100">{summary.total_frames}</p>
        </div>

        {/* Frames with Objects */}
        <div className="bg-navy-panel border border-navy-border p-4 rounded-xl space-y-1">
          <p className="text-xs text-slate-400">Frames w/ Objects</p>
          <p className="text-xl font-bold font-mono text-emerald-400">
            {summary.frames_with_objects} <span className="text-xs font-normal text-slate-400">({summary.detection_ratio_pct}%)</span>
          </p>
        </div>

        {/* Average Confidence */}
        <div className="bg-navy-panel border border-navy-border p-4 rounded-xl space-y-1">
          <p className="text-xs text-slate-400">Avg Confidence</p>
          <p className="text-xl font-bold font-mono text-ocean-cyan">{summary.average_confidence}%</p>
        </div>

        {/* Processing Time */}
        <div className="bg-navy-panel border border-navy-border p-4 rounded-xl space-y-1">
          <p className="text-xs text-slate-400">Processing Time</p>
          <p className="text-xl font-bold font-mono text-slate-100">{summary.processing_time_sec}s</p>
        </div>

        {/* Detection FPS */}
        <div className="bg-navy-panel border border-navy-border p-4 rounded-xl space-y-1">
          <p className="text-xs text-slate-400">Detection Speed</p>
          <p className="text-xl font-bold font-mono text-sky-400">{summary.processing_fps} FPS</p>
        </div>
      </div>
    </div>
  );
};

export default DetectionStatistics;
