import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  UploadCloud,
  Layers,
  BarChart3,
  Cpu,
  Scan,
  Bot,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, setCollapsed }) => {
  const location = useLocation();

  const datasetItems = [
    { name: 'Upload Video', path: '/upload', icon: UploadCloud },
    { name: 'Annotation Workspace', path: '/workspace', icon: Layers },
    { name: 'Dataset Status', path: '/status', icon: BarChart3 },
    { name: 'YOLO Training', path: '/training', icon: Cpu },
  ];

  const isDatasetActive = datasetItems.some((item) => location.pathname === item.path);
  const [datasetOpen, setDatasetOpen] = useState(true);

  // Auto-expand group when on a dataset workflow route
  useEffect(() => {
    if (isDatasetActive) {
      setDatasetOpen(true);
    }
  }, [location.pathname, isDatasetActive]);

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
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {/* Dashboard */}
        <Link
          to="/"
          className={`flex items-center p-3 rounded-lg transition-colors group relative ${
            location.pathname === '/'
              ? 'bg-navy-card text-ocean-cyan font-medium border border-navy-border/60'
              : 'text-slate-400 hover:bg-navy-card/50 hover:text-slate-100'
          }`}
        >
          <LayoutDashboard className={`w-5 h-5 flex-shrink-0 ${location.pathname === '/' ? 'text-ocean-cyan' : 'text-slate-400 group-hover:text-slate-200'}`} />
          {!collapsed && <span className="ml-3 text-sm tracking-wide">Dashboard</span>}
          {collapsed && (
            <div className="absolute left-16 bg-navy-panel border border-navy-border px-2 py-1 rounded text-xs text-slate-100 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              Dashboard
            </div>
          )}
        </Link>

        {/* Group Header: Dataset Training */}
        {!collapsed ? (
          <div>
            <button
              onClick={() => setDatasetOpen(!datasetOpen)}
              className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors group text-slate-300 hover:bg-navy-card/40 ${
                isDatasetActive ? 'text-sky-300 font-medium' : ''
              }`}
            >
              <div className="flex items-center space-x-3">
                <FolderKanban className={`w-5 h-5 flex-shrink-0 ${isDatasetActive ? 'text-sky-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                <span className="text-sm tracking-wide">Dataset Training</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                  datasetOpen ? 'transform rotate-0' : 'transform -rotate-90'
                }`}
              />
            </button>

            {/* Nested Workflow Sub-items */}
            {datasetOpen && (
              <div className="ml-4 pl-3 border-l border-sky-500/20 space-y-1 mt-1 mb-2">
                {datasetItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      className={`flex items-center px-3 py-2 rounded-lg text-xs transition-colors group ${
                        isActive
                          ? 'bg-sky-500/15 text-ocean-cyan font-medium border border-sky-500/30'
                          : 'text-slate-400 hover:bg-navy-card/50 hover:text-slate-100'
                      }`}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-ocean-cyan' : 'text-slate-400 group-hover:text-slate-200'}`} />
                      <span className="ml-2.5 tracking-wide">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Collapsed Mode for Dataset Training items */
          <div className="space-y-1">
            {datasetItems.map((item) => {
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
                  <div className="absolute left-16 bg-navy-panel border border-navy-border px-2 py-1 rounded text-xs text-slate-100 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                    Dataset Training › {item.name}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Object Detection */}
        <Link
          to="/detection"
          className={`flex items-center p-3 rounded-lg transition-colors group relative ${
            location.pathname === '/detection'
              ? 'bg-navy-card text-ocean-cyan font-medium border border-navy-border/60'
              : 'text-slate-400 hover:bg-navy-card/50 hover:text-slate-100'
          }`}
        >
          <Scan className={`w-5 h-5 flex-shrink-0 ${location.pathname === '/detection' ? 'text-ocean-cyan' : 'text-slate-400 group-hover:text-slate-200'}`} />
          {!collapsed && <span className="ml-3 text-sm tracking-wide">Object Detection</span>}
          {collapsed && (
            <div className="absolute left-16 bg-navy-panel border border-navy-border px-2 py-1 rounded text-xs text-slate-100 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              Object Detection
            </div>
          )}
        </Link>

        {/* Separator */}
        <div className="h-px bg-navy-border/40 my-4" />

        {/* Future Feature: AI Assistant */}
        <div className="flex items-center p-3 rounded-lg opacity-40 cursor-not-allowed group relative text-slate-400">
          <Bot className="w-5 h-5 flex-shrink-0" />
          {!collapsed && (
            <div className="ml-3 flex-1 flex items-center justify-between">
              <span className="text-sm tracking-wide">AI Assistant</span>
              <span className="text-[10px] font-semibold bg-sky-950 text-sky-400 border border-sky-900 px-1.5 py-0.5 rounded uppercase tracking-wider scale-90">
                Soon
              </span>
            </div>
          )}
          {collapsed && (
            <div className="absolute left-16 bg-navy-panel border border-navy-border px-2 py-1 rounded text-xs text-slate-100 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              AI Assistant (Soon)
            </div>
          )}
        </div>

        {/* Settings */}
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

