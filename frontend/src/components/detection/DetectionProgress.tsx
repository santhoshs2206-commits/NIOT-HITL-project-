import React from 'react';
import { Loader2, Activity, Clock, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DetectionProgress as ProgressType } from '../../types/detection';

interface DetectionProgressProps {
  progress: ProgressType | null;
  onCancel?: () => void;
}

export const DetectionProgress: React.FC<DetectionProgressProps> = ({ progress }) => {
  if (!progress) return null;

  const currentFrame = progress.current_frame || 0;
  const totalFrames = Math.max(1, progress.total_frames || 100);
  const percentage = Math.min(100, Math.round((currentFrame / totalFrames) * 100));

  const formatEta = (seconds: number) => {
    if (seconds <= 0) return '0s';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const stages = [
    'Loading Model...',
    'Reading Video...',
    'Running Detection...',
    'Drawing Bounding Boxes...',
    'Saving Output Video...',
    'Completed'
  ];

  return (
    <div className="bg-navy-panel border border-navy-border rounded-xl p-8 shadow-xl max-w-3xl mx-auto my-6">
      {progress.status === 'failed' ? (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-red-400">Object Detection Failed</h3>
          <p className="text-sm text-slate-300 bg-red-950/40 border border-red-900/60 rounded-lg p-3 max-w-md mx-auto">
            {progress.error || 'An unexpected error occurred during frame processing.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-ocean-cyan animate-pulse">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-100 text-lg">Running Object Detection</h3>
                <p className="text-xs text-ocean-cyan font-medium">{progress.current_stage}</p>
              </div>
            </div>
            <div className="text-right font-mono">
              <span className="text-2xl font-bold text-ocean-cyan">{percentage}%</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="w-full bg-navy-card h-4 rounded-full overflow-hidden border border-navy-border p-0.5 relative">
              <div
                className="bg-gradient-to-r from-sky-500 to-ocean-cyan h-full rounded-full transition-all duration-300 shadow-sm shadow-cyan-500/50"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-400 font-mono">
              <span>Frame {currentFrame} / {totalFrames}</span>
              <span>{percentage}% Complete</span>
            </div>
          </div>

          {/* Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
            <div className="bg-navy-card/80 border border-navy-border/60 p-3 rounded-lg flex items-center space-x-3">
              <div className="w-8 h-8 rounded bg-sky-500/10 text-sky-400 flex items-center justify-center">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Processing Speed</p>
                <p className="text-sm font-semibold font-mono text-slate-100">{progress.fps} FPS</p>
              </div>
            </div>

            <div className="bg-navy-card/80 border border-navy-border/60 p-3 rounded-lg flex items-center space-x-3">
              <div className="w-8 h-8 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Est. Remaining Time</p>
                <p className="text-sm font-semibold font-mono text-slate-100">{formatEta(progress.eta_seconds)}</p>
              </div>
            </div>

            <div className="col-span-2 md:col-span-1 bg-navy-card/80 border border-navy-border/60 p-3 rounded-lg flex items-center space-x-3">
              <div className="w-8 h-8 rounded bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Current Phase</p>
                <p className="text-xs font-semibold text-slate-200 truncate">{progress.current_stage}</p>
              </div>
            </div>
          </div>

          {/* Stage Progress Checklist */}
          <div className="border-t border-navy-border/60 pt-4">
            <p className="text-xs font-medium text-slate-400 mb-3">Workflow Execution Pipeline:</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {stages.map((stg) => {
                const isCurrent = progress.current_stage.includes(stg.split(' ')[0]);
                const isPassed = percentage === 100 || (progress.current_stage === 'Completed');
                return (
                  <span
                    key={stg}
                    className={`px-2.5 py-1 rounded-md border flex items-center space-x-1.5 font-mono ${
                      isPassed
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : isCurrent
                        ? 'bg-cyan-500/20 border-ocean-cyan text-ocean-cyan font-bold animate-pulse'
                        : 'bg-navy-card/50 border-navy-border text-slate-500'
                    }`}
                  >
                    {isPassed ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-current" />
                    )}
                    <span>{stg}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DetectionProgress;
