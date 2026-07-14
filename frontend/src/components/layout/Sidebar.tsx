import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  UploadCloud,
  Layers,
  BarChart3,
  Cpu,
  Settings,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, setCollapsed }) => {
  const location = useLocation();

  const menuItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Upload Video', path: '/upload', icon: UploadCloud },
    { name: 'Annotation Workspace', path: '/workspace', icon: Layers },
    { name: 'Dataset Status', path: '/status', icon: BarChart3 },
  ];

  return (
    <aside
      className={`bg-navy-panel border-r border-navy-border flex flex-col transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Area */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-navy-border">
        {!collapsed && (
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center">
              <span className="text-sky-400 font-bold text-sm">AI</span>
            </div>
            <span className="font-bold text-slate-100 tracking-wide text-sm">HITL PLATFORM</span>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center">
            <span className="text-sky-400 font-bold text-sm">AI</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded hover:bg-navy-card text-slate-400 hover:text-slate-100 transition-colors hidden md:block"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center p-3 rounded-lg transition-colors group relative ${
                isActive
                  ? 'bg-navy-card text-ocean-cyan font-medium border border-navy-border/60'
                  : 'text-slate-400 hover:bg-navy-card/50 hover:text-slate-100'
              }`}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-ocean-cyan' : 'text-slate-400 group-hover:text-slate-200'}`} />
              {!collapsed && <span className="ml-3 text-sm tracking-wide">{item.name}</span>}
              {collapsed && (
                <div className="absolute left-16 bg-navy-panel border border-navy-border px-2 py-1 rounded text-xs text-slate-100 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                  {item.name}
                </div>
              )}
            </Link>
          );
        })}

        {/* Separator */}
        <div className="h-px bg-navy-border/40 my-4" />

        {/* Future Feature: AI suggestions (Disabled placeholder) */}
        <div className="flex items-center p-3 rounded-lg opacity-40 cursor-not-allowed group relative text-slate-400">
          <Cpu className="w-5 h-5 flex-shrink-0" />
          {!collapsed && (
            <div className="ml-3 flex-1 flex items-center justify-between">
              <span className="text-sm tracking-wide">AI Assist</span>
              <span className="text-[10px] font-semibold bg-sky-950 text-sky-400 border border-sky-900 px-1.5 py-0.5 rounded uppercase tracking-wider scale-90">
                Soon
              </span>
            </div>
          )}
          {collapsed && (
            <div className="absolute left-16 bg-navy-panel border border-navy-border px-2 py-1 rounded text-xs text-slate-100 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              AI Assist (Coming Soon)
            </div>
          )}
        </div>

        {/* Settings (Placeholder) */}
        <div className="flex items-center p-3 rounded-lg opacity-40 cursor-not-allowed group relative text-slate-400">
          <Settings className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="ml-3 text-sm tracking-wide">Settings</span>}
          {collapsed && (
            <div className="absolute left-16 bg-navy-panel border border-navy-border px-2 py-1 rounded text-xs text-slate-100 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              Settings
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar;
