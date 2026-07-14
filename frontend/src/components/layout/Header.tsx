import React from 'react';
import { useHealthCheck } from '../../hooks/useHealthCheck';
import { Wifi, WifiOff } from 'lucide-react';

export const Header: React.FC = () => {
  const { isSuccess, isLoading } = useHealthCheck();

  return (
    <header className="h-16 bg-navy-panel border-b border-navy-border px-6 flex items-center justify-between z-10">
      <div>
        <h1 className="text-base font-semibold text-slate-100 tracking-wide">
          Underwater HITL Object Detection Annotation
        </h1>
      </div>
      
      <div className="flex items-center space-x-4">
        {isLoading ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-slate-800 text-slate-400 border border-slate-700 animate-pulse">
            Checking backend...
          </span>
        ) : isSuccess ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-emerald-950/75 text-emerald-400 border border-emerald-800/85">
            <Wifi className="w-3.5 h-3.5" />
            Backend Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-rose-950/75 text-rose-400 border border-rose-800/85">
            <WifiOff className="w-3.5 h-3.5" />
            Backend Disconnected
          </span>
        )}
      </div>
    </header>
  );
};

export default Header;
