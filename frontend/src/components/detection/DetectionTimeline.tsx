import React from 'react';
import { Clock, Play } from 'lucide-react';
import type { DetectionEvent } from '../../types/detection';

interface DetectionTimelineProps {
  events: DetectionEvent[];
  onSeek: (timestampSec: number) => void;
}

export const DetectionTimeline: React.FC<DetectionTimelineProps> = ({ events, onSeek }) => {
  if (!events || events.length === 0) {
    return (
      <div className="bg-navy-panel border border-navy-border rounded-xl p-5 shadow-lg text-center text-slate-400 text-sm">
        No timeline events detected.
      </div>
    );
  }

  return (
    <div className="bg-navy-panel border border-navy-border rounded-xl p-5 shadow-lg space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-navy-border/60">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-100 text-base">Detection Timeline</h3>
            <p className="text-xs text-slate-400">Click any timestamp log to jump to that frame in the video player</p>
          </div>
        </div>

        <span className="text-xs font-mono bg-navy-card px-2.5 py-1 rounded border border-navy-border text-slate-300">
          {events.length} Key Events
        </span>
      </div>

      {/* Horizontal / Grid Timeline */}
      <div className="max-h-60 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {events.map((evt, idx) => (
            <button
              key={`${evt.frame}-${idx}`}
              onClick={() => onSeek(evt.timestamp_sec)}
              className="bg-navy-card/80 hover:bg-navy-card border border-navy-border/80 hover:border-ocean-cyan p-2.5 rounded-lg text-left transition-all duration-150 flex items-center justify-between group"
            >
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 rounded bg-ocean-cyan/10 border border-ocean-cyan/30 flex items-center justify-center text-ocean-cyan group-hover:bg-ocean-cyan group-hover:text-navy-dark transition-colors">
                  <Play className="w-3.5 h-3.5 fill-current" />
                </div>
                <div>
                  <span className="text-xs font-mono font-bold text-ocean-cyan block">{evt.timestamp}</span>
                  <span className="text-xs font-medium text-slate-200 capitalize">{evt.label}</span>
                </div>
              </div>
              <span className="text-[11px] font-mono text-slate-400 bg-navy-panel px-1.5 py-0.5 rounded border border-navy-border">
                {Math.round(evt.confidence * 100)}%
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DetectionTimeline;
