import React from 'react';
import { Download, Video, FileSpreadsheet, FileCode, FileText } from 'lucide-react';
import { detectionService } from '../../services/detectionService';

interface DetectionDownloadProps {
  jobId: string;
}

export const DetectionDownload: React.FC<DetectionDownloadProps> = ({ jobId }) => {
  const videoUrl = detectionService.getDownloadVideoUrl(jobId);
  const csvUrl = detectionService.getDownloadCsvUrl(jobId);
  const jsonUrl = detectionService.getDownloadJsonUrl(jobId);
  const reportUrl = detectionService.getDownloadReportUrl(jobId);

  return (
    <div className="bg-navy-panel border border-navy-border rounded-xl p-5 shadow-lg space-y-4">
      <div className="flex items-center space-x-3 pb-3 border-b border-navy-border/60">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
          <Download className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-slate-100 text-base">Export & Downloads</h3>
          <p className="text-xs text-slate-400">Download rendered detection artifacts and data files</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Processed Video */}
        <a
          href={videoUrl}
          download
          className="bg-navy-card/80 hover:bg-navy-card border border-navy-border/80 hover:border-ocean-cyan p-4 rounded-xl flex items-center space-x-3 transition-all duration-150 group"
        >
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center text-ocean-cyan group-hover:scale-105 transition-transform">
            <Video className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-100 text-sm">Processed Video</h4>
            <p className="text-xs text-slate-400">Rendered MP4 file</p>
          </div>
        </a>

        {/* Detection CSV */}
        <a
          href={csvUrl}
          download
          className="bg-navy-card/80 hover:bg-navy-card border border-navy-border/80 hover:border-emerald-400 p-4 rounded-xl flex items-center space-x-3 transition-all duration-150 group"
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-100 text-sm">Detection CSV</h4>
            <p className="text-xs text-slate-400">Bounding boxes per frame</p>
          </div>
        </a>

        {/* Detection JSON */}
        <a
          href={jsonUrl}
          download
          className="bg-navy-card/80 hover:bg-navy-card border border-navy-border/80 hover:border-sky-400 p-4 rounded-xl flex items-center space-x-3 transition-all duration-150 group"
        >
          <div className="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-400/30 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
            <FileCode className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-100 text-sm">Structured JSON</h4>
            <p className="text-xs text-slate-400">Full metadata & detections</p>
          </div>
        </a>

        {/* Summary Report */}
        <a
          href={reportUrl}
          download
          className="bg-navy-card/80 hover:bg-navy-card border border-navy-border/80 hover:border-indigo-400 p-4 rounded-xl flex items-center space-x-3 transition-all duration-150 group"
        >
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-400/30 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-100 text-sm">Summary Report</h4>
            <p className="text-xs text-slate-400">Scientific text report</p>
          </div>
        </a>
      </div>
    </div>
  );
};

export default DetectionDownload;
