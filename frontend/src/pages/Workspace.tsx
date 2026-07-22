import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Canvas,
  Rect,
  FabricImage,
  FabricText,
  Point
} from 'fabric';
import {
  MousePointer,
  Square,
  Trash2,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Save,
  Sparkles,
  Plus,
  FolderOpen,
  AlertCircle,
  AlertTriangle,
  Play,
  Pause,
  Loader2,
  Ban,
  FastForward,
  RefreshCw,
  Sliders,
  Edit2,
  Copy,
  Tag,
  CheckCircle2,
  PackageCheck,
  X
} from 'lucide-react';
import trainingService from '../services/trainingService';
import { 
  getFramesList, 
  getFrameImageUrl, 
  getAnnotations, 
  saveAnnotations,
  updateSingleAnnotation, 
  getClasses,
  getDatasetStatus,
  propagateAnnotations,
  skipFrame,
  restoreFrame,
  skipFrameRange
} from '../services/videoService';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class WorkspaceErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Workspace Runtime Exception Caught by ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#070d19] text-rose-300 p-8 flex flex-col items-center justify-center font-mono">
          <div className="max-w-2xl w-full bg-[#0c162b] border border-rose-500/40 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertTriangle className="w-7 h-7 flex-shrink-0" />
              <div>
                <h1 className="text-lg font-bold">Workspace Runtime Exception</h1>
                <p className="text-xs text-rose-300/80 font-sans">An uncaught runtime error occurred during component rendering/lifecycle.</p>
              </div>
            </div>

            <div className="bg-[#070d19] p-4 rounded-xl border border-rose-900/50 space-y-2 text-xs font-mono">
              <div className="text-rose-400 font-bold">
                Error: {this.state.error?.toString()}
              </div>
              {this.state.errorInfo?.componentStack && (
                <div className="mt-2 text-[10px] text-slate-400 overflow-auto max-h-48 whitespace-pre-wrap font-mono border-t border-navy-border/60 pt-2">
                  <p className="font-bold text-slate-300 mb-1">Component Stack:</p>
                  {this.state.errorInfo.componentStack}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold font-sans transition-colors"
              >
                Reload Workspace
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface MockAnnotation {
  id: string;
  label: string;
  bbox: [number, number, number, number]; // [xmin, ymin, xmax, ymax]
  color?: string;
  isNew?: boolean;
  // Rich tracking metadata from backend (preserved across save/load cycles)
  tracking_id?: string | null;
  source?: string | null;
  propagation_state?: string | null;
  confidence?: number | null;
  created_by?: string | null;
  tracker?: string | null;
  tracker_version?: string | null;
}

const DEFAULT_ANNOTATION_COLOR = '#00f0ff'; // Unified Cyan accent color matching the theme

const Workspace: React.FC = () => {
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get('video_id') || '';
  const queryClient = useQueryClient();

  // Workspace States
  const [autoSave, setAutoSave] = useState(true);
  const [activeTool, setActiveTool] = useState<'select' | 'draw'>('select');
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>('Fish');
  const [newLabelInput, setNewLabelInput] = useState<string>('');

  // AI Propagation workstation states
  const [isPropagating, setIsPropagating] = useState(false);
  const [trackingState, setTrackingState] = useState<'Inactive' | 'Propagating' | 'Paused' | 'Lost'>('Inactive');
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [endFrameInput, setEndFrameInput] = useState<string>('');
  const [propagationTracker, setPropagationTracker] = useState<string>('CSRT');
  const [useYoloFallback, setUseYoloFallback] = useState(true);
  const [propagationSpeed, setPropagationSpeed] = useState<3 | 8 | 15>(8); // FPS
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Status monitor
  const [propagationStats, setPropagationStats] = useState<{
    current: number;
    total: number;
    startFrame: number;
    endFrame: number;
    objectsTracked: number;
    status: 'Idle' | 'Running' | 'Paused' | 'Stopped' | 'Completed' | 'Error';
    stopReason: string;
  }>({
    current: 0,
    total: 0,
    startFrame: 0,
    endFrame: 0,
    objectsTracked: 0,
    status: 'Idle',
    stopReason: ''
  });

  // Safe execution refs
  const isPausedRef = useRef(false);
  const onFrameRenderedRef = useRef<(() => void) | null>(null);

  // Floating prompt state for standard labeling experience
  const [promptState, setPromptState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    bbox: [number, number, number, number];
    tempRect: Rect;
  } | null>(null);
  const [promptInput, setPromptInput] = useState('');
  const [promptHighlight, setPromptHighlight] = useState(0);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  
  // Premium Notification Toast State
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Dynamic set of class labels available at runtime
  const [classLabels, setClassLabels] = useState<string[]>([
    'Fish',
    'Crab',
    'Coral',
    'Diver',
    'Sea Turtle'
  ]);

  // Local state for all bounding box annotations mapped by frame name
  const [annotations, setAnnotations] = useState<Record<string, MockAnnotation[]>>({});

  // Inspector & Interactive Edit States
  const [isEditingAnnotation, setIsEditingAnnotation] = useState(false);
  const [originalEditSnapshot, setOriginalEditSnapshot] = useState<MockAnnotation | null>(null);
  const [editForm, setEditForm] = useState({
    label: '',
    xmin: 0,
    ymin: 0,
    xmax: 0,
    ymax: 0,
    width: 0,
    height: 0
  });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; annId: string } | null>(null);
  // Ref tracking persistent edit mode state to prevent stale closure in Fabric listeners
  const isEditingAnnotationRef = useRef(isEditingAnnotation);
  useEffect(() => {
    isEditingAnnotationRef.current = isEditingAnnotation;
  }, [isEditingAnnotation]);

  // Canvas Refs
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const activeFrameRef = useRef<HTMLDivElement | null>(null);
  const imageBoundsRef = useRef({ left: 0, top: 0, width: 800, height: 450 });
  const originalImageSizeRef = useRef({ width: 1920, height: 1080 });
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 800, height: 450 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fabricHostRef = useRef<HTMLDivElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1); // viewport zoom (1 = 100%)

  // Query list of frames from FastAPI
  const { data: framesData, isLoading: isLoadingFrames, error: framesError } = useQuery({
    queryKey: ['frames', videoId],
    queryFn: () => getFramesList(videoId),
    enabled: !!videoId,
  });

  // Query class labels list from FastAPI
  const { data: serverClasses } = useQuery({
    queryKey: ['classes'],
    queryFn: getClasses,
  });

  // Query dataset status to retrieve video profile information
  const { data: statusData } = useQuery({
    queryKey: ['dataset-status'],
    queryFn: getDatasetStatus,
  });

  const videoMeta = useMemo(() => 
    statusData?.videos.find(v => v.video_id === videoId),
    [statusData, videoId]
  );

  const frames = useMemo(() => framesData?.frames || [], [framesData?.frames]);
  const currentFrame = frames[currentFrameIndex];

  // Auto-set default End Frame input when frames load or Current Frame changes if invalid
  useEffect(() => {
    if (frames && frames.length > 0) {
      const parsed = parseInt(endFrameInput, 10);
      if (isNaN(parsed) || parsed <= (currentFrameIndex + 1) || parsed > frames.length) {
        setEndFrameInput(String(Math.min(currentFrameIndex + 25, frames.length)));
      }
    }
  }, [frames, currentFrameIndex]);

  const parsedEndFrame = parseInt(endFrameInput, 10);

  const endFrameValidationError = useMemo(() => {
    if (!endFrameInput || isNaN(parsedEndFrame)) {
      return 'Please enter a target End Frame number.';
    }
    if (parsedEndFrame <= currentFrameIndex + 1) {
      return `End Frame must be greater than Current Frame (${currentFrameIndex + 1}).`;
    }
    if (parsedEndFrame > frames.length) {
      return `End Frame cannot exceed total frames (${frames.length}).`;
    }
    return null;
  }, [endFrameInput, parsedEndFrame, currentFrameIndex, frames.length]);

  const activeAnnotations = useMemo(() => 
    currentFrame ? (annotations[currentFrame.name] || []) : [],
    [currentFrame, annotations]
  );

  const selectedAnnotation = useMemo(() => 
    activeAnnotations.find((ann) => ann.id === selectedAnnotationId),
    [activeAnnotations, selectedAnnotationId]
  );

  // Computed properties — synchronized with backend frame.annotated state and local edits
  const totalAnnotated = useMemo(() => {
    return frames.filter((f) => f.annotated || (annotations[f.name] && annotations[f.name].length > 0)).length;
  }, [frames, annotations]);
  const progressPercent = frames.length > 0 ? Math.round((totalAnnotated / frames.length) * 100) : 0;

  const trackerSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    activeAnnotations.forEach((ann) => {
      const cleanLbl = ann.label.trim();
      summary[cleanLbl] = (summary[cleanLbl] || 0) + 1;
    });
    return summary;
  }, [activeAnnotations]);

  // Show a sleek notification toast helper
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Sync dyn classes list with backend CLASSES_FILE on mount
  useEffect(() => {
    if (serverClasses && serverClasses.length > 0) {
      setClassLabels((prev) => {
        const merged = Array.from(new Set([...prev, ...serverClasses]));
        return merged;
      });
    }
  }, [serverClasses]);

  // Load saved annotations for the current frame from FastAPI on render/frame transition
  useEffect(() => {
    if (!videoId || !currentFrame?.name) return;

    let isActive = true;
    getAnnotations(videoId, currentFrame.name)
      .then((data) => {
        if (!isActive) return;

        const mappedAnns: MockAnnotation[] = data.map((ann) => ({
          // Preserve backend-assigned ID so the rich metadata round-trips correctly
          id: ann.id || Math.random().toString(36).substr(2, 9),
          label: ann.label,
          bbox: ann.bbox,
          color: DEFAULT_ANNOTATION_COLOR,
          isNew: false,
          // Preserve all tracking metadata
          tracking_id: ann.tracking_id,
          source: ann.source,
          propagation_state: ann.propagation_state,
          confidence: ann.confidence,
          created_by: ann.created_by,
          tracker: ann.tracker,
          tracker_version: ann.tracker_version,
        }));

        setAnnotations((prev) => ({
          ...prev,
          [currentFrame.name]: mappedAnns,
        }));
      })
      .catch((err) => {
        console.error('Failed to load annotations from API:', err);
      });

    return () => {
      isActive = false;
    };
  }, [currentFrame?.name, videoId]);

  const handleManualEdit = useCallback(() => {
    setShowResumePrompt(true);
  }, []);

  // Add annotation to local state
  const addAnnotation = useCallback((frameName: string, ann: MockAnnotation) => {
    setAnnotations((prev) => {
      const currentList = prev[frameName] || [];
      return {
        ...prev,
        [frameName]: [...currentList, ann],
      };
    });
    handleManualEdit();
  }, [handleManualEdit]);

  // Update annotation coordinates in local state
  const updateAnnotationBbox = useCallback((id: string, bbox: [number, number, number, number]) => {
    if (!currentFrame) return;
    setAnnotations((prev) => {
      const currentList = prev[currentFrame.name] || [];
      return {
        ...prev,
        [currentFrame.name]: currentList.map((ann) => 
          ann.id === id ? { ...ann, bbox } : ann
        ),
      };
    });
    handleManualEdit();
  }, [currentFrame, handleManualEdit]);

  // Create a stable ref to hold the latest coordinate update callback
  const updateBboxRef = useRef(updateAnnotationBbox);
  useEffect(() => {
    updateBboxRef.current = updateAnnotationBbox;
  }, [updateAnnotationBbox]);

  // Save annotations to API helper
  const triggerSaveRequest = useCallback(async (frameName: string, anns: MockAnnotation[]) => {
    if (!videoId) return;
    const requestPayload = anns.map((ann) => ({
      label: ann.label,
      bbox: ann.bbox,
      id: ann.id,
      tracking_id: ann.tracking_id ?? null,
      // Newly-drawn boxes are always manual/user; existing annotations keep their original metadata
      // so tracking results don't get reclassified as "manual" by auto-save.
      source: ann.isNew ? 'manual' : (ann.source ?? null),
      propagation_state: ann.isNew ? 'manual' : (ann.propagation_state ?? null),
      created_by: ann.isNew ? 'user' : (ann.created_by ?? null),
      confidence: ann.confidence ?? null,
      tracker: ann.tracker ?? null,
      tracker_version: ann.tracker_version ?? null,
    }));

    try {
      await saveAnnotations(videoId, frameName, requestPayload);
      queryClient.invalidateQueries({ queryKey: ['frames', videoId] });
      return true;
    } catch (err) {
      console.error(`Failed to save annotations for ${frameName}:`, err);
      return false;
    }
  }, [videoId, queryClient]);

  // Switch Frame handlers - with dynamic Auto-Save trigger
  const handleSelectFrame = useCallback((index: number) => {
    if (currentFrame) {
      const annsToSave = annotations[currentFrame.name] || [];
      
      // Auto save if enabled
      if (autoSave) {
        triggerSaveRequest(currentFrame.name, annsToSave).then((success) => {
          if (success) {
            showToast('Auto-saved annotations');
          } else {
            showToast('Auto-save failed', 'error');
          }
        });
      }
    }

    setCurrentFrameIndex(index);
    setSelectedAnnotationId(null);
  }, [autoSave, currentFrame, annotations, triggerSaveRequest, showToast]);

  // Manual save trigger button
  const handleManualSave = useCallback(() => {
    if (!currentFrame) return;
    const annsToSave = annotations[currentFrame.name] || [];
    triggerSaveRequest(currentFrame.name, annsToSave).then((success) => {
      if (success) {
        showToast('Annotations saved successfully');
      } else {
        showToast('Failed to save annotations', 'error');
      }
    });
  }, [currentFrame, annotations, triggerSaveRequest, showToast]);

  // Loop execution function for propagation
  const executePropagationStep = useCallback(async (startIdx: number, targetEndIdx: number, sessionId: string) => {
    if (!videoId || !frames || frames.length === 0) return;
    
    // Stop condition: frame boundaries reached
    if (startIdx >= targetEndIdx) {
      setIsPropagating(false);
      setTrackingState('Inactive');
      setPropagationStats(prev => ({ ...prev, status: 'Completed' }));
      showToast('AI Propagation completed successfully');
      setCurrentSessionId(null);
      return;
    }

    const startFrame = frames[startIdx];
    if (!startFrame) return;

    // Check if the next frame name is valid
    const nextIdx = startIdx + 1;
    const nextFrame = frames[nextIdx];
    if (!nextFrame) {
      setIsPropagating(false);
      setTrackingState('Inactive');
      setPropagationStats(prev => ({ ...prev, status: 'Completed' }));
      showToast('AI Propagation reached end of video');
      setCurrentSessionId(null);
      return;
    }

    try {
      // Trigger a step of 1 frame forward from startFrame name
      const response = await propagateAnnotations(videoId, {
        start_frame: startFrame.name,
        mode: "1", // Propagate exactly 1 frame forward (step mode)
        tracker_type: propagationTracker,
        yolo_fallback: useYoloFallback,
        session_id: sessionId
      });

      // Update monitor stats
      setPropagationStats(prev => ({
        ...prev,
        current: nextIdx + 1,
        objectsTracked: response.objects_tracked || prev.objectsTracked,
        status: 'Running'
      }));

      if (response.frames_propagated > 0) {
        // Invalidate frames query to refresh sidebar dot markers
        queryClient.invalidateQueries({ queryKey: ['frames', videoId] });

        // Deterministic canvas synchronization: wait for image load and render
        const renderPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Frame load timeout'));
          }, 6000); // 6s max timeout for frame load

          onFrameRenderedRef.current = () => {
            clearTimeout(timeout);
            onFrameRenderedRef.current = null;
            resolve();
          };
        });

        // Set the active frame index, prompting canvas load and render
        setCurrentFrameIndex(nextIdx);

        try {
          await renderPromise;
        } catch (renderError) {
          console.error('Frame rendering timed out or failed:', renderError);
          setIsPropagating(false);
          setTrackingState('Lost');
          setPropagationStats(prev => ({ ...prev, status: 'Error', stopReason: 'Frame load failed' }));
          showToast('Propagation halted: Frame failed to load', 'error');
          setCurrentSessionId(null);
          return;
        }

        // Queued pause checks
        if (isPausedRef.current) {
          setIsPropagating(false);
          setTrackingState('Paused');
          setPropagationStats(prev => ({ ...prev, status: 'Paused' }));
          showToast('AI Propagation paused');
          return;
        }

        // Check backend stop reason
        if (response.stop_reason === 'all_objects_lost') {
          setIsPropagating(false);
          setTrackingState('Lost');
          setPropagationStats(prev => ({ ...prev, status: 'Stopped', stopReason: 'All objects lost' }));
          showToast('Propagation stopped: All objects lost', 'error');
          setCurrentSessionId(null);
          return;
        }

        // Speed control delay (3 FPS = 333ms, 8 FPS = 125ms, 15 FPS = 66ms)
        const fpsDelay = propagationSpeed === 3 ? 333 : propagationSpeed === 15 ? 66 : 125;
        setTimeout(() => {
          executePropagationStep(nextIdx, targetEndIdx, sessionId);
        }, fpsDelay);

      } else {
        setIsPropagating(false);
        setTrackingState('Lost');
        const errMsg = response.error_detail || response.stop_reason || 'No objects tracked';
        setPropagationStats(prev => ({ 
          ...prev, 
          status: 'Stopped', 
          stopReason: errMsg
        }));
        showToast(`AI Propagation stopped: ${errMsg}`, 'error');
        setCurrentSessionId(null);
      }
    } catch (err: any) {
      console.error('Propagation error during step:', err);
      setIsPropagating(false);
      setTrackingState('Lost');
      
      let errMsg = 'unknown error';
      if (err.response?.data?.detail) {
        const detail = err.response.data.detail;
        if (typeof detail === 'string') {
          errMsg = detail;
        } else if (Array.isArray(detail)) {
          errMsg = detail.map((d: any) => `${d.loc.slice(1).join('.')}: ${d.msg}`).join(', ');
        }
      } else {
        errMsg = err.message || 'unknown error';
      }

      setPropagationStats(prev => ({ ...prev, status: 'Error', stopReason: errMsg }));
      showToast('AI Propagation error: ' + errMsg, 'error');
      setCurrentSessionId(null);
    }
  }, [videoId, frames, propagationTracker, useYoloFallback, propagationSpeed, queryClient, showToast]);

  // Start propagation
  const handlePropagateStart = useCallback(async () => {
    if (!currentFrame || isPropagating) return;

    const currentAnns = annotations[currentFrame.name] || [];
    if (currentAnns.length === 0) {
      showToast('No active annotations on this frame to propagate', 'error');
      return;
    }

    const targetEndFrame = parseInt(endFrameInput, 10);
    if (isNaN(targetEndFrame) || targetEndFrame <= (currentFrameIndex + 1) || targetEndFrame > frames.length) {
      showToast('Please enter a valid End Frame within range', 'error');
      return;
    }

    // Unsaved Changes Protection Safeguard
    setPropagationStats(prev => ({ ...prev, status: 'Idle', stopReason: 'Saving current state...' }));
    const saveSuccess = await triggerSaveRequest(currentFrame.name, currentAnns);
    if (!saveSuccess) {
      showToast('Cannot start propagation: Failed to save active frame annotations', 'error');
      setPropagationStats(prev => ({ ...prev, status: 'Idle', stopReason: 'Save failed' }));
      return;
    }

    const startFrameNum = currentFrameIndex + 1;
    const targetEndIndex = targetEndFrame - 1;

    if (currentFrameIndex >= targetEndIndex) {
      showToast('Current frame index is already at or past the end boundary', 'error');
      return;
    }

    // Reinitialize state
    setIsPropagating(true);
    isPausedRef.current = false;
    setTrackingState('Propagating');

    // Remove isNew visual indicators since we are committing them to tracking
    setAnnotations(prev => {
      const copy = { ...prev };
      if (copy[currentFrame.name]) {
        copy[currentFrame.name] = copy[currentFrame.name].map(ann => ({ ...ann, isNew: false }));
      }
      return copy;
    });

    const nextSessionId = `session_${Date.now()}`;
    setCurrentSessionId(nextSessionId);

    setPropagationStats({
      current: startFrameNum,
      total: targetEndFrame,
      startFrame: startFrameNum,
      endFrame: targetEndFrame,
      objectsTracked: currentAnns.length,
      status: 'Running',
      stopReason: ''
    });

    // Brief delay to allow UI to render initialization state
    setTimeout(() => {
      executePropagationStep(currentFrameIndex, targetEndIndex, nextSessionId);
    }, 400);

  }, [
    currentFrame,
    currentFrameIndex,
    endFrameInput,
    isPropagating,
    annotations,
    frames,
    triggerSaveRequest,
    executePropagationStep,
    showToast
  ]);

  // Pause propagation
  const handlePropagatePause = useCallback(() => {
    isPausedRef.current = true;
    setTrackingState('Paused');
    setPropagationStats(prev => ({ ...prev, status: 'Paused' }));
  }, []);

  // Resume propagation
  const handlePropagateResume = useCallback(async () => {
    if (!currentFrame || isPropagating) return;

    const currentAnns = annotations[currentFrame.name] || [];
    if (currentAnns.length === 0) {
      showToast('No active annotations on this frame to propagate', 'error');
      return;
    }

    const targetEndFrame = parseInt(endFrameInput, 10);
    if (isNaN(targetEndFrame) || targetEndFrame <= (currentFrameIndex + 1) || targetEndFrame > frames.length) {
      showToast('Please enter a valid End Frame within range', 'error');
      return;
    }

    setPropagationStats(prev => ({ ...prev, status: 'Idle', stopReason: 'Saving current state...' }));
    const saveSuccess = await triggerSaveRequest(currentFrame.name, currentAnns);
    if (!saveSuccess) {
      showToast('Cannot resume propagation: Failed to save active frame annotations', 'error');
      setPropagationStats(prev => ({ ...prev, status: 'Idle', stopReason: 'Save failed' }));
      return;
    }

    const startFrameNum = currentFrameIndex + 1;
    const targetEndIndex = targetEndFrame - 1;

    if (currentFrameIndex >= targetEndIndex) {
      showToast('Current frame index is already at or past the end boundary', 'error');
      return;
    }

    setIsPropagating(true);
    isPausedRef.current = false;
    setTrackingState('Propagating');

    const nextSessionId = currentSessionId || `session_${Date.now()}`;
    setCurrentSessionId(nextSessionId);

    setPropagationStats({
      current: startFrameNum,
      total: targetEndFrame,
      startFrame: startFrameNum,
      endFrame: targetEndFrame,
      objectsTracked: currentAnns.length,
      status: 'Running',
      stopReason: ''
    });

    setTimeout(() => {
      executePropagationStep(currentFrameIndex, targetEndIndex, nextSessionId);
    }, 400);

  }, [
    currentFrame,
    currentFrameIndex,
    endFrameInput,
    isPropagating,
    annotations,
    frames,
    currentSessionId,
    triggerSaveRequest,
    executePropagationStep,
    showToast
  ]);

  // Stop/reset propagation
  const handlePropagateStop = useCallback(() => {
    isPausedRef.current = true;
    setIsPropagating(false);
    setTrackingState('Inactive');
    setCurrentSessionId(null);
    setPropagationStats({
      current: 0,
      total: 0,
      startFrame: 0,
      endFrame: 0,
      objectsTracked: 0,
      status: 'Idle',
      stopReason: ''
    });
  }, []);

  // Delete annotation from local state AND remove from canvas
  const deleteAnnotation = useCallback((id: string) => {
    if (!currentFrame) return;

    // Remove from Fabric canvas
    const fbCanvas = fabricCanvasRef.current;
    if (fbCanvas) {
      const toRemove = fbCanvas.getObjects().filter(
        (obj) => (obj as any).data?.id === id
      );
      toRemove.forEach((obj) => {
        // Also remove associated label text
        const textObj = (obj as any).textObject;
        if (textObj) fbCanvas.remove(textObj);
        fbCanvas.remove(obj);
      });
      fbCanvas.discardActiveObject();
      fbCanvas.renderAll();
    }

    setAnnotations((prev) => {
      const currentList = prev[currentFrame.name] || [];
      return {
        ...prev,
        [currentFrame.name]: currentList.filter((ann) => ann.id !== id),
      };
    });
    setSelectedAnnotationId(null);
    handleManualEdit();
  }, [currentFrame, handleManualEdit]);

  // Update annotation label in local state
  const changeAnnotationLabel = useCallback((id: string, newLabel: string) => {
    if (!currentFrame) return;
    setAnnotations((prev) => {
      const currentList = prev[currentFrame.name] || [];
      return {
        ...prev,
        [currentFrame.name]: currentList.map((ann) => 
          ann.id === id ? { ...ann, label: newLabel, color: DEFAULT_ANNOTATION_COLOR } : ann
        ),
      };
    });
    handleManualEdit();
  }, [currentFrame, handleManualEdit]);

  // Duplicate an existing annotation box
  const duplicateAnnotation = useCallback((id: string) => {
    if (!currentFrame) return;
    const currentAnns = annotations[currentFrame.name] || [];
    const target = currentAnns.find(a => a.id === id);
    if (!target) return;

    const newId = `copy_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const [xmin, ymin, xmax, ymax] = target.bbox;
    const w = xmax - xmin;
    const h = ymax - ymin;
    const shift = 20;
    const newXmin = xmin + shift;
    const newYmin = ymin + shift;
    const newXmax = newXmin + w;
    const newYmax = newYmin + h;

    const cloned: MockAnnotation = {
      ...target,
      id: newId,
      bbox: [newXmin, newYmin, newXmax, newYmax],
      isNew: true,
      created_by: 'manual_duplicate'
    };

    addAnnotation(currentFrame.name, cloned);
    setSelectedAnnotationId(newId);
    showToast('Annotation duplicated', 'success');
  }, [currentFrame, annotations, addAnnotation, showToast]);

  // Update editForm numeric state from Fabric canvas object
  const updateEditFormFromObject = useCallback((obj: Rect) => {
    const left = obj.left || 0;
    const top = obj.top || 0;
    const width = (obj.width || 0) * (obj.scaleX || 1);
    const height = (obj.height || 0) * (obj.scaleY || 1);

    const bounds = imageBoundsRef.current;
    const scale = bounds.width / (originalImageSizeRef.current.width || 1);
    if (scale <= 0) return;

    const xmin = Math.max(0, Math.round((left - bounds.left) / scale));
    const ymin = Math.max(0, Math.round((top - bounds.top) / scale));
    const w_orig = Math.round(width / scale);
    const h_orig = Math.round(height / scale);

    setEditForm({
      label: (obj as any).data?.label || activeLabel,
      xmin,
      ymin,
      xmax: xmin + w_orig,
      ymax: ymin + h_orig,
      width: w_orig,
      height: h_orig,
    });
  }, [activeLabel]);

  // Synchronize numeric input edits from Inspector panel directly back to Fabric canvas
  const updateCanvasFromEditForm = useCallback((newXmin: number, newYmin: number, newW: number, newH: number, newLabel: string) => {
    if (!selectedAnnotationId || !currentFrame) return;
    const newXmax = newXmin + newW;
    const newYmax = newYmin + newH;
    const newBbox: [number, number, number, number] = [newXmin, newYmin, newXmax, newYmax];

    // 1. Update local annotations state
    setAnnotations(prev => {
      const list = prev[currentFrame.name] || [];
      return {
        ...prev,
        [currentFrame.name]: list.map(ann => 
          ann.id === selectedAnnotationId 
            ? { ...ann, label: newLabel, bbox: newBbox }
            : ann
        )
      };
    });

    // 2. Update Fabric.js canvas object
    const fbCanvas = fabricCanvasRef.current;
    if (!fbCanvas) return;

    const imgBounds = imageBoundsRef.current;
    const origSize = originalImageSizeRef.current;

    const scaleX = imgBounds.width / (origSize.width || 1);
    const scaleY = imgBounds.height / (origSize.height || 1);

    const left = imgBounds.left + newXmin * scaleX;
    const top = imgBounds.top + newYmin * scaleY;
    const width = newW * scaleX;
    const height = newH * scaleY;

    const rectObj = fbCanvas.getObjects().find(obj => (obj as any).data?.id === selectedAnnotationId);
    if (rectObj && rectObj instanceof Rect) {
      rectObj.set({
        left,
        top,
        width,
        height,
        scaleX: 1,
        scaleY: 1
      });
      (rectObj as any).data.label = newLabel;
      rectObj.setCoords();

      const textObj = (rectObj as any).textObject;
      if (textObj) {
        textObj.set({
          left,
          top: Math.max(imgBounds.top, top - 18),
          text: newLabel
        });
        textObj.setCoords();
      }
      fbCanvas.renderAll();
    }
  }, [selectedAnnotationId, currentFrame]);

  // Start persistent Edit Mode for an annotation
  const handleStartEditAnnotation = useCallback((ann: MockAnnotation) => {
    setSelectedAnnotationId(ann.id);
    setIsEditingAnnotation(true);
    setOriginalEditSnapshot({ ...ann });
    const [xmin, ymin, xmax, ymax] = ann.bbox;
    setEditForm({
      label: ann.label,
      xmin: Math.round(xmin),
      ymin: Math.round(ymin),
      xmax: Math.round(xmax),
      ymax: Math.round(ymax),
      width: Math.round(xmax - xmin),
      height: Math.round(ymax - ymin),
    });
  }, []);

  // Cancel persistent Edit Mode and revert changes to original snapshot
  const handleCancelEditAnnotation = useCallback(() => {
    if (originalEditSnapshot && currentFrame) {
      const frameName = currentFrame.name;
      // 1. Revert local state
      setAnnotations(prev => {
        const list = prev[frameName] || [];
        return {
          ...prev,
          [frameName]: list.map(a => a.id === originalEditSnapshot.id ? { ...originalEditSnapshot } : a)
        };
      });

      // 2. Revert Fabric.js canvas object
      const fbCanvas = fabricCanvasRef.current;
      if (fbCanvas) {
        const rectObj = fbCanvas.getObjects().find(obj => (obj as any).data?.id === originalEditSnapshot.id);
        if (rectObj && rectObj instanceof Rect) {
          const imgBounds = imageBoundsRef.current;
          const origSize = originalImageSizeRef.current;
          const scaleX = imgBounds.width / (origSize.width || 1);
          const scaleY = imgBounds.height / (origSize.height || 1);

          const [xmin, ymin, xmax, ymax] = originalEditSnapshot.bbox;
          const left = imgBounds.left + xmin * scaleX;
          const top = imgBounds.top + ymin * scaleY;
          const width = (xmax - xmin) * scaleX;
          const height = (ymax - ymin) * scaleY;

          rectObj.set({
            left,
            top,
            width,
            height,
            scaleX: 1,
            scaleY: 1
          });
          (rectObj as any).data.label = originalEditSnapshot.label;
          rectObj.setCoords();

          const textObj = (rectObj as any).textObject;
          if (textObj) {
            textObj.set({
              left,
              top: Math.max(imgBounds.top, top - 18),
              text: originalEditSnapshot.label
            });
            textObj.setCoords();
          }
          fbCanvas.renderAll();
        }
      }
    }

    setIsEditingAnnotation(false);
    setOriginalEditSnapshot(null);
    showToast('Editing cancelled - changes reverted', 'success');
  }, [originalEditSnapshot, currentFrame, showToast]);

  // Save persistent Edit Mode changes to backend API, update metadata.json & YOLO txt
  const handleSaveEditAnnotation = useCallback(async () => {
    if (!currentFrame || !selectedAnnotationId) return;
    const currentFrameAnns = annotations[currentFrame.name] || [];
    const selectedAnn = currentFrameAnns.find(a => a.id === selectedAnnotationId);
    if (!selectedAnn) return;

    const newXmax = editForm.xmin + editForm.width;
    const newYmax = editForm.ymin + editForm.height;
    const updatedAnn: MockAnnotation = {
      ...selectedAnn,
      label: editForm.label,
      bbox: [editForm.xmin, editForm.ymin, newXmax, newYmax],
    };

    try {
      // 1. Update single annotation API endpoint
      await updateSingleAnnotation(videoId, currentFrame.name, selectedAnnotationId, {
        label: updatedAnn.label,
        bbox: updatedAnn.bbox,
        id: selectedAnnotationId,
        tracking_id: updatedAnn.tracking_id,
        source: updatedAnn.source,
        propagation_state: updatedAnn.propagation_state,
        confidence: updatedAnn.confidence
      });

      // 2. Persist full frame save to regenerate metadata.json & YOLO label (.txt)
      const updatedFrameAnns = currentFrameAnns.map(a => 
        a.id === selectedAnnotationId ? updatedAnn : a
      );
      await saveAnnotations(videoId, currentFrame.name, updatedFrameAnns);

      showToast(`Annotation '${editForm.label}' saved successfully`, 'success');
      setIsEditingAnnotation(false);
      setOriginalEditSnapshot(null);
    } catch (err: any) {
      console.error('Failed to save annotation:', err);
      showToast('Failed to save annotation changes', 'error');
    }
  }, [currentFrame, selectedAnnotationId, editForm, videoId, annotations, showToast]);

  // Finalize all annotated frames for video, marking dataset status as READY_FOR_TRAINING
  const handleFinalizeAnnotatedDataset = useCallback(async () => {
    if (!videoId) return;
    try {
      const res = await trainingService.finalizeDataset(videoId);
      showToast(res.message || `Annotated frames for ${videoId} marked Ready for Training!`, 'success');
    } catch (err: any) {
      console.error('Failed to finalize dataset:', err);
      showToast(err.response?.data?.detail || 'Failed to finalize dataset', 'error');
    }
  }, [videoId, showToast]);

  // ─── Toolbar action handlers ────────────────────────────────────────────────

  const ZOOM_STEP = 0.1;
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 8;

  /** Recalculates viewport transform to keep the canvas center aligned with viewport center at any zoom level */
  const applyZoomAndCenter = useCallback((zoomVal: number) => {
    const fbCanvas = fabricCanvasRef.current;
    if (!fbCanvas) return;
    
    const w = fbCanvas.width!;
    const h = fbCanvas.height!;
    
    // Zoom centered precisely on the canvas center coordinates
    const tx = (w / 2) * (1 - zoomVal);
    const ty = (h / 2) * (1 - zoomVal);
    
    fbCanvas.setViewportTransform([zoomVal, 0, 0, zoomVal, tx, ty]);
    fbCanvas.renderAll();
    setZoomLevel(zoomVal);
  }, []);

  /** Zoom toward the canvas centre by one step */
  const handleZoomIn = useCallback(() => {
    const fbCanvas = fabricCanvasRef.current;
    if (!fbCanvas) return;
    const next = Math.min(fbCanvas.getZoom() + ZOOM_STEP, ZOOM_MAX);
    applyZoomAndCenter(next);
  }, [applyZoomAndCenter]);

  /** Zoom out from the canvas centre by one step */
  const handleZoomOut = useCallback(() => {
    const fbCanvas = fabricCanvasRef.current;
    if (!fbCanvas) return;
    const next = Math.max(fbCanvas.getZoom() - ZOOM_STEP, ZOOM_MIN);
    applyZoomAndCenter(next);
  }, [applyZoomAndCenter]);

  /** Fit the frame image to the current canvas size, reset pan */
  const handleFitScreen = useCallback(() => {
    applyZoomAndCenter(1);
    // The render-image effect will re-fit the image on next render;
    // force it by bumping canvasDimensions to current real size
    const container = containerRef.current;
    if (container) {
      setCanvasDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    }
  }, [applyZoomAndCenter]);

  /** Reset zoom to 1 and pan to origin */
  const handleResetView = useCallback(() => {
    applyZoomAndCenter(1);
  }, [applyZoomAndCenter]);

  /** Switch active tool and immediately update canvas cursor / selectability */
  const handleSetTool = useCallback((tool: 'select' | 'draw') => {
    setActiveTool(tool);
    const fbCanvas = fabricCanvasRef.current;
    if (!fbCanvas) return;
    if (tool === 'select') {
      fbCanvas.defaultCursor = 'default';
      fbCanvas.hoverCursor = 'move';
      fbCanvas.selection = true;
      fbCanvas.forEachObject((obj) => {
        if ((obj as any).data) {
          obj.selectable = true;
          obj.evented = true;
        }
      });
    } else {
      fbCanvas.defaultCursor = 'crosshair';
      fbCanvas.hoverCursor = 'crosshair';
      fbCanvas.selection = false;
      fbCanvas.discardActiveObject();
      fbCanvas.forEachObject((obj) => {
        if ((obj as any).data) {
          obj.selectable = false;
          obj.evented = false;
        }
      });
    }
    fbCanvas.renderAll();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────

  // Auto-scroll inside sidebar list
  useEffect(() => {
    if (activeFrameRef.current) {
      activeFrameRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentFrameIndex]);

  // Preload nearby images
  useEffect(() => {
    if (frames.length === 0) return;

    const indicesToPreload = [currentFrameIndex - 1, currentFrameIndex + 1];
    indicesToPreload.forEach((idx) => {
      if (idx >= 0 && idx < frames.length) {
        const frame = frames[idx];
        const imgUrl = getFrameImageUrl(videoId, frame.name);
        const img = new Image();
        img.src = imgUrl;
      }
    });
  }, [currentFrameIndex, frames, videoId]);

  // Keybindings listener: Arrow keys, A/D frame nav, Delete, Escape, tool shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (currentFrameIndex > 0) handleSelectFrame(currentFrameIndex - 1);
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (currentFrameIndex < frames.length - 1) handleSelectFrame(currentFrameIndex + 1);
          break;

        case 'a':
        case 'A':
          // Only navigate frames if not switching tool
          if (!e.shiftKey) {
            e.preventDefault();
            if (currentFrameIndex > 0) handleSelectFrame(currentFrameIndex - 1);
          }
          break;

        case 'd':
        case 'D':
          if (!e.shiftKey) {
            e.preventDefault();
            if (currentFrameIndex < frames.length - 1) handleSelectFrame(currentFrameIndex + 1);
          }
          break;

        case 's':
        case 'S':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (isEditingAnnotation) {
              handleSaveEditAnnotation();
            } else if (currentFrame) {
              const currentAnns = annotations[currentFrame.name] || [];
              triggerSaveRequest(currentFrame.name, currentAnns);
              showToast('Annotations saved (Ctrl+S)', 'success');
            }
          } else {
            handleSetTool('select');
          }
          break;

        case 'e':
        case 'E':
          if (selectedAnnotationId && !isEditingAnnotation) {
            e.preventDefault();
            const selectedAnn = (annotations[currentFrame?.name || ''] || []).find(a => a.id === selectedAnnotationId);
            if (selectedAnn) {
              handleStartEditAnnotation(selectedAnn);
            }
          }
          break;

        case 'b':
        case 'B':
          handleSetTool('draw');
          break;

        case '+':
        case '=':
          handleZoomIn();
          break;

        case '-':
        case '_':
          handleZoomOut();
          break;

        case 'Delete':
        case 'Backspace':
          if (selectedAnnotationId) deleteAnnotation(selectedAnnotationId);
          break;

        case 'Escape':
          if (isEditingAnnotation) {
            handleCancelEditAnnotation();
          } else {
            setSelectedAnnotationId(null);
            handleSetTool('select');
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [frames.length, selectedAnnotationId, deleteAnnotation, currentFrameIndex, handleSelectFrame, handleSetTool, handleZoomIn, handleZoomOut]);

  // Fabric Canvas Initialization
  useEffect(() => {
    if (!fabricHostRef.current) return;

    if (fabricCanvasRef.current) {
      try {
        console.log('Disposing previous Fabric canvas instance before creating new one');
        fabricCanvasRef.current.dispose();
      } catch (e) {
        console.warn('Fabric dispose error ignored:', e);
      }
      fabricCanvasRef.current = null;
    }

    // Imperatively clear host container to remove old Fabric DOM elements cleanly
    fabricHostRef.current.innerHTML = '';

    // Create canvas element imperatively outside React VDOM reconciliation
    const canvasEl = document.createElement('canvas');
    fabricHostRef.current.appendChild(canvasEl);

    const initialWidth = containerRef.current?.clientWidth || 800;
    const initialHeight = containerRef.current?.clientHeight || 450;

    const fbCanvas = new Canvas(canvasEl, {
      width: initialWidth,
      height: initialHeight,
      selection: true,
      backgroundColor: '#070d19',
    });

    fabricCanvasRef.current = fbCanvas;
    console.log('Fabric Canvas initialized successfully', fbCanvas);

    // Selection handlers
    const onSelection = (e: any) => {
      const selectedObj = e.selected?.[0];
      if (selectedObj && (selectedObj as any).data) {
        const annId = (selectedObj as any).data.id;
        setSelectedAnnotationId(annId);
        if (selectedObj instanceof Rect) {
          updateEditFormFromObject(selectedObj);
        }
      }
    };

    fbCanvas.on('selection:created', onSelection);
    fbCanvas.on('selection:updated', onSelection);
    fbCanvas.on('selection:cleared', () => {
      // In persistent edit mode, Fabric selection clearing events NEVER exit edit mode.
      if (!isEditingAnnotationRef.current) {
        setSelectedAnnotationId(null);
      }
    });

    // Right-click context menu handler on Fabric objects
    fbCanvas.on('mouse:down', (opt: any) => {
      if (opt.e && (opt.e.button === 2 || opt.e.which === 3)) {
        opt.e.preventDefault();
        opt.e.stopPropagation();
        const targetObj = opt.target;
        if (targetObj && (targetObj as any).data?.id) {
          const annId = (targetObj as any).data.id;
          setSelectedAnnotationId(annId);
          if (targetObj instanceof Rect) {
            updateEditFormFromObject(targetObj);
          }
          setContextMenu({
            x: opt.e.clientX,
            y: opt.e.clientY,
            annId
          });
        } else {
          setContextMenu(null);
        }
      } else {
        setContextMenu(null);
      }
    });

    // Helper to align floating text above rect boundaries
    const updateTextLabelPos = (rect: Rect) => {
      const textObj = (rect as any).textObject;
      if (!textObj) return;
      textObj.set({
        left: rect.left,
        top: Math.max(imageBoundsRef.current.top, (rect.top || 0) - 16),
      });
    };

    // Object modifications sync
    fbCanvas.on('object:modified', (e) => {
      const obj = e.target;
      if (!obj || !(obj instanceof Rect)) return;
      const data = (obj as any).data as MockAnnotation;
      if (!data) return;

      const left = obj.left || 0;
      const top = obj.top || 0;
      const width = (obj.width || 0) * (obj.scaleX || 1);
      const height = (obj.height || 0) * (obj.scaleY || 1);

      // Convert back to original subsea image coordinate space
      const bounds = imageBoundsRef.current;
      const scale = bounds.width / (originalImageSizeRef.current.width || 1);

      const xmin_orig = Math.round((left - bounds.left) / scale);
      const ymin_orig = Math.round((top - bounds.top) / scale);
      const xmax_orig = Math.round((left + width - bounds.left) / scale);
      const ymax_orig = Math.round((top + height - bounds.top) / scale);

      updateBboxRef.current(data.id, [
        Math.max(0, xmin_orig),
        Math.max(0, ymin_orig),
        Math.min(originalImageSizeRef.current.width, xmax_orig),
        Math.min(originalImageSizeRef.current.height, ymax_orig)
      ]);
      updateEditFormFromObject(obj);
    });

    // Clamp coordinates during moving to keep them inside image bounds
    fbCanvas.on('object:moving', (e) => {
      const obj = e.target;
      if (!obj || !(obj instanceof Rect)) return;
      const bounds = imageBoundsRef.current;
      const w = (obj.width || 0) * (obj.scaleX || 1);
      const h = (obj.height || 0) * (obj.scaleY || 1);

      if (obj.left < bounds.left) {
        obj.left = bounds.left;
      }
      if (obj.top < bounds.top) {
        obj.top = bounds.top;
      }
      if (obj.left + w > bounds.left + bounds.width) {
        obj.left = bounds.left + bounds.width - w;
      }
      if (obj.top + h > bounds.top + bounds.height) {
        obj.top = bounds.top + bounds.height - h;
      }

      updateTextLabelPos(obj as Rect);
      updateEditFormFromObject(obj);
      fbCanvas.renderAll();
    });

    // Clamp coordinates during scaling to keep them inside image bounds
    fbCanvas.on('object:scaling', (e) => {
      const obj = e.target;
      if (!obj || !(obj instanceof Rect)) return;
      const bounds = imageBoundsRef.current;
      const w = (obj.width || 0) * (obj.scaleX || 1);
      const h = (obj.height || 0) * (obj.scaleY || 1);

      if (obj.left < bounds.left) {
        const diff = bounds.left - obj.left;
        obj.left = bounds.left;
        obj.scaleX = (w - diff) / (obj.width || 1);
      }
      if (obj.top < bounds.top) {
        const diff = bounds.top - obj.top;
        obj.top = bounds.top;
        obj.scaleY = (h - diff) / (obj.height || 1);
      }
      if (obj.left + w > bounds.left + bounds.width) {
        obj.scaleX = (bounds.left + bounds.width - obj.left) / (obj.width || 1);
      }
      if (obj.top + h > bounds.top + bounds.height) {
        obj.scaleY = (bounds.top + bounds.height - obj.top) / (obj.height || 1);
      }

      updateTextLabelPos(obj as Rect);
      updateEditFormFromObject(obj);
      fbCanvas.renderAll();
    });

    // Mouse-wheel zoom: zoom toward the cursor position
    const onWheel = (opt: any) => {
      const delta = opt.e.deltaY;
      let zoom = fbCanvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.max(0.1, Math.min(8, zoom));
      fbCanvas.zoomToPoint(new Point(opt.e.offsetX, opt.e.offsetY), zoom);
      fbCanvas.renderAll();
      setZoomLevel(zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    };
    fbCanvas.on('mouse:wheel', onWheel);

    return () => {
      fbCanvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [videoId]);

  // Handle container resizing to dynamically adjust canvas dimensions
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const width = container.clientWidth || entry.contentRect.width;
        const height = container.clientHeight || entry.contentRect.height;

        if (width > 0 && height > 0) {
          setCanvasDimensions({ width, height });
          const fbCanvas = fabricCanvasRef.current;
          if (fbCanvas) {
            fbCanvas.setDimensions({ width, height });
            // Re-apply viewport transform to keep the canvas centered at current zoom
            const currentZoom = fbCanvas.getZoom();
            const tx = (width / 2) * (1 - currentZoom);
            const ty = (height / 2) * (1 - currentZoom);
            fbCanvas.setViewportTransform([currentZoom, 0, 0, currentZoom, tx, ty]);
            fbCanvas.renderAll();
          }
        }
      }
    });

    resizeObserver.observe(container);

    // Fire once immediately to capture initial size
    const initialWidth = container.clientWidth;
    const initialHeight = container.clientHeight;
    if (initialWidth > 0 && initialHeight > 0) {
      setCanvasDimensions({ width: initialWidth, height: initialHeight });
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Render Image and Annotation Objects onto Fabric Canvas
  useEffect(() => {
    const fbCanvas = fabricCanvasRef.current;
    if (!fbCanvas || !currentFrame || !videoId) return;

    let isCurrent = true;

    const imageUrl = getFrameImageUrl(videoId, currentFrame.name);
    const activeIdBeforeRender = selectedAnnotationId;

    // Clear everything
    fbCanvas.clear();
    fbCanvas.backgroundColor = '#070d19';

    // Load background frame image using standard HTML Image to guarantee property setting
    const imgEl = new Image();
    imgEl.src = imageUrl;
    imgEl.onload = () => {
      if (!isCurrent) return;

      const canvasWidth = canvasDimensions.width;
      const canvasHeight = canvasDimensions.height;
      const originalWidth = imgEl.naturalWidth || imgEl.width;
      const originalHeight = imgEl.naturalHeight || imgEl.height;

      // Store original image size
      originalImageSizeRef.current = { width: originalWidth, height: originalHeight };

      // Scale to fit 92% of the dynamic container space
      const paddingFactor = 0.92;
      const scale = Math.min(
        (canvasWidth * paddingFactor) / originalWidth,
        (canvasHeight * paddingFactor) / originalHeight
      );

      const imgWidth = originalWidth * scale;
      const imgHeight = originalHeight * scale;
      const imgLeft = (canvasWidth - imgWidth) / 2;
      const imgTop = (canvasHeight - imgHeight) / 2;

      // Update image bounds ref
      imageBoundsRef.current = { left: imgLeft, top: imgTop, width: imgWidth, height: imgHeight };

      // Create FabricImage with options directly in constructor
      const img = new FabricImage(imgEl, {
        scaleX: scale,
        scaleY: scale,
        left: imgLeft,
        top: imgTop,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
        hoverCursor: 'default',
      });

      // Subtle visual border frame around the image bounds
      const imageBorder = new Rect({
        left: imgLeft - 1.5,
        top: imgTop - 1.5,
        width: imgWidth + 3,
        height: imgHeight + 3,
        fill: 'transparent',
        stroke: '#1e293b', // Sleek slate-800 border
        strokeWidth: 1.5,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      });

      fbCanvas.add(imageBorder);
      fbCanvas.sendObjectToBack(imageBorder);

      fbCanvas.add(img);
      fbCanvas.sendObjectToBack(img);

      // Render all existing rects and small text tags from React state
      const currentList = annotations[currentFrame.name] || [];
      currentList.forEach((ann) => {
        const [xmin_orig, ymin_orig, xmax_orig, ymax_orig] = ann.bbox;
        const isSelected = activeIdBeforeRender === ann.id;
        const color = ann.isNew ? '#d946ef' : DEFAULT_ANNOTATION_COLOR; // Vibrant magenta for newly added unsaved objects

        // Scale original coordinates to current canvas space
        const left = imgLeft + xmin_orig * scale;
        const top = imgTop + ymin_orig * scale;
        const w = (xmax_orig - xmin_orig) * scale;
        const h = (ymax_orig - ymin_orig) * scale;

        // Bounding box rect
        const rect = new Rect({
          left: left,
          top: top,
          width: w,
          height: h,
          fill: 'transparent',
          stroke: color,
          strokeWidth: isSelected ? 3 : 1.5,
          strokeDashArray: ann.isNew ? [4, 4] : undefined,
          cornerColor: isSelected ? '#00f0ff' : color,
          cornerSize: isSelected ? 9 : 7,
          transparentCorners: false,
          lockRotation: true, // Keep 2D bounding boxes axis-aligned for YOLO
          originX: 'left',
          originY: 'top',
          selectable: activeTool === 'select',
          evented: activeTool === 'select',
          data: ann,
        });

        // Small dynamic label text above bounding box
        const labelText = new FabricText(ann.isNew ? `NEW | ${ann.label}` : ann.label, {
          left: left,
          top: top - 16,
          fontSize: 10,
          fontFamily: 'Outfit, sans-serif',
          fontWeight: 'bold',
          fill: '#080f1e',
          backgroundColor: color,
          originX: 'left',
          originY: 'top',
          selectable: false,
          evented: false,
        });

        (rect as any).textObject = labelText;

        fbCanvas.add(rect);
        fbCanvas.add(labelText);

        // Restore active focus selection
        if (isSelected) {
          fbCanvas.setActiveObject(rect);
        }
      });

      fbCanvas.renderAll();

      if (onFrameRenderedRef.current) {
        onFrameRenderedRef.current();
      }
    };
    imgEl.onerror = (err) => {
      console.error('Error loading image via HTML Image:', err);
    };

    return () => {
      isCurrent = false;
      imgEl.onload = null;
      imgEl.onerror = null;
    };
  }, [currentFrame, annotations, videoId, activeTool, selectedAnnotationId, canvasDimensions]);

  // Ref to track promptState to avoid stale closures in canvas event listeners
  const promptStateRef = useRef(promptState);
  useEffect(() => {
    promptStateRef.current = promptState;
  }, [promptState]);

  // Set up Mouse Drawing handlers on Canvas when tool is 'draw'
  useEffect(() => {
    const fbCanvas = fabricCanvasRef.current;
    if (!fbCanvas) return;

    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let activeRect: Rect | null = null;

    const onMouseDown = (opt: any) => {
      if (activeTool !== 'draw') return;
      if (promptStateRef.current?.visible) return; // Block drawing if prompt is open
      isDrawing = true;
      const pointer = fbCanvas.getScenePoint(opt.e);
      startX = pointer.x;
      startY = pointer.y;

      activeRect = new Rect({
        left: startX,
        top: startY,
        width: 0,
        height: 0,
        fill: 'transparent',
        stroke: DEFAULT_ANNOTATION_COLOR,
        strokeWidth: 1.5,
        cornerColor: DEFAULT_ANNOTATION_COLOR,
        cornerSize: 7,
        transparentCorners: false,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      });

      fbCanvas.add(activeRect);
      fbCanvas.setActiveObject(activeRect);
    };

    const onMouseMove = (opt: any) => {
      if (!isDrawing || !activeRect) return;
      const pointer = fbCanvas.getScenePoint(opt.e);
      const x = pointer.x;
      const y = pointer.y;

      const left = Math.min(startX, x);
      const top = Math.min(startY, y);
      const width = Math.abs(startX - x);
      const height = Math.abs(startY - y);

      activeRect.set({
        left,
        top,
        width,
        height,
      });
      fbCanvas.renderAll();
    };

    const onMouseUp = () => {
      if (!isDrawing || !activeRect) return;
      isDrawing = false;

      const left = Math.max(0, Math.round(activeRect.left || 0));
      const top = Math.max(0, Math.round(activeRect.top || 0));
      const width = Math.round(activeRect.width || 0);
      const height = Math.round(activeRect.height || 0);

      // Validate threshold coordinates (width & height > 5px)
      if (width > 5 && height > 5 && currentFrame) {
        // Convert drawn canvas coordinates to original image coordinates
        const bounds = imageBoundsRef.current;
        const scale = bounds.width / originalImageSizeRef.current.width;

        const xmin_orig = Math.round((left - bounds.left) / scale);
        const ymin_orig = Math.round((top - bounds.top) / scale);
        const xmax_orig = Math.round((left + width - bounds.left) / scale);
        const ymax_orig = Math.round((top + height - bounds.top) / scale);

        // Convert canvas scene coordinates to viewport coordinates for HTML overlay placement
        const vt = fbCanvas.viewportTransform;
        const zoom = vt[0];
        const tx = vt[4];
        const ty = vt[5];

        const vx = left * zoom + tx;
        const vy = top * zoom + ty;

        setPromptState({
          visible: true,
          x: vx,
          y: vy,
          bbox: [
            Math.max(0, xmin_orig),
            Math.max(0, ymin_orig),
            Math.min(originalImageSizeRef.current.width, xmax_orig),
            Math.min(originalImageSizeRef.current.height, ymax_orig)
          ],
          tempRect: activeRect,
        });

        // Set the activeRect to null so it's not removed or modified by this handler anymore
        activeRect = null;
      } else {
        fbCanvas.remove(activeRect);
        activeRect = null;
        fbCanvas.renderAll();
        // Discarded accidental click, reset tool to select
        setActiveTool('select');
      }
    };

    if (activeTool === 'draw') {
      fbCanvas.defaultCursor = 'crosshair';
      fbCanvas.selection = false;
      fbCanvas.forEachObject((obj) => {
        if ((obj as any).data) {
          obj.selectable = false;
          obj.evented = false;
        }
      });

      fbCanvas.on('mouse:down', onMouseDown);
      fbCanvas.on('mouse:move', onMouseMove);
      fbCanvas.on('mouse:up', onMouseUp);
    } else {
      fbCanvas.defaultCursor = 'default';
      fbCanvas.selection = true;
      fbCanvas.forEachObject((obj) => {
        if ((obj as any).data) {
          obj.selectable = true;
          obj.evented = true;
        }
      });
    }

    return () => {
      fbCanvas.off('mouse:down', onMouseDown);
      fbCanvas.off('mouse:move', onMouseMove);
      fbCanvas.off('mouse:up', onMouseUp);
    };
  }, [activeTool, currentFrame, addAnnotation]);

  // Auto-focus the floating prompt input when it opens
  useEffect(() => {
    if (promptState?.visible) {
      setPromptInput('');
      setPromptHighlight(0);
      // Small delay to let React render the input element before focusing
      const t = setTimeout(() => promptInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [promptState?.visible]);

  // Floating prompt confirm: attach label, save annotation, clean up
  const handlePromptConfirm = useCallback((label: string) => {
    if (!promptState || !currentFrame) return;

    // Register new class label dynamically if it doesn't exist
    if (!classLabels.includes(label)) {
      setClassLabels((prev) => [...prev, label]);
    }

    const newAnn: MockAnnotation = {
      id: Math.random().toString(36).substr(2, 9),
      label,
      bbox: promptState.bbox,
      color: DEFAULT_ANNOTATION_COLOR,
      isNew: true,
    };
    addAnnotation(currentFrame.name, newAnn);

    // Remove the temporary drawing rect from the Fabric canvas
    const fbCanvas = fabricCanvasRef.current;
    if (fbCanvas && promptState.tempRect) {
      fbCanvas.remove(promptState.tempRect);
      fbCanvas.renderAll();
    }

    setPromptState(null);
    setActiveTool('select');
  }, [promptState, currentFrame, classLabels, addAnnotation]);

  // Floating prompt cancel: discard the box
  const handlePromptCancel = useCallback(() => {
    if (!promptState) return;

    const fbCanvas = fabricCanvasRef.current;
    if (fbCanvas && promptState.tempRect) {
      fbCanvas.remove(promptState.tempRect);
      fbCanvas.renderAll();
    }

    setPromptState(null);
    setActiveTool('select');
  }, [promptState]);

  // Handle label change on selected box
  const handleLabelQuickSelect = (label: string) => {
    setActiveLabel(label);
    if (selectedAnnotationId) {
      changeAnnotationLabel(selectedAnnotationId, label);
    }
  };

  // Add custom class label
  const handleAddCustomLabel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabelInput.trim()) return;
    const label = newLabelInput.trim();
    if (!classLabels.includes(label)) {
      setClassLabels((prev) => [...prev, label]);
    }
    handleLabelQuickSelect(label);
    setNewLabelInput('');
  };

  // Skip / Restore Frame State and Handlers
  const [showSkipModal, setShowSkipModal] = useState(false);
  const [skipTab, setSkipTab] = useState<'single' | 'range'>('range');
  const [skipRangeStartInput, setSkipRangeStartInput] = useState<string>('');
  const [skipRangeEndInput, setSkipRangeEndInput] = useState<string>('');
  const [isSkipping, setIsSkipping] = useState(false);

  // Auto-set Skip Range inputs when Modal opens
  useEffect(() => {
    if (showSkipModal) {
      const startNum = currentFrameIndex + 1;
      setSkipRangeStartInput(String(startNum));
      setSkipRangeEndInput(String(Math.min(currentFrameIndex + 25, frames.length)));
    }
  }, [showSkipModal, currentFrameIndex, frames.length]);

  const handleConfirmSkipFrame = async () => {
    if (!videoId || !currentFrame) return;
    setIsSkipping(true);
    try {
      // 1. Send API request to mark frame as skipped
      await skipFrame(videoId, currentFrame.name);
      showToast(`Frame '${currentFrame.name}' excluded from AI training.`, 'success');

      // 2. Hide Modal FIRST so React unmounts modal overlay cleanly from DOM
      setShowSkipModal(false);

      // 3. Refetch updated frame list asynchronously
      const updatedData = await queryClient.fetchQuery({
        queryKey: ['frames', videoId],
        queryFn: () => getFramesList(videoId)
      });
      await queryClient.invalidateQueries({ queryKey: ['dataset-status'] });

      const refreshedFrames = updatedData?.frames || [];

      // 4. Safely calculate next valid frame index within array bounds
      let nextIndex = currentFrameIndex;
      if (refreshedFrames.length > 0) {
        if (nextIndex >= refreshedFrames.length) {
          nextIndex = Math.max(0, refreshedFrames.length - 1);
        } else if (nextIndex < refreshedFrames.length - 1) {
          nextIndex = nextIndex + 1;
        }
      }

      // 5. Defer frame transition to the next animation tick
      requestAnimationFrame(() => {
        setTimeout(() => {
          handleSelectFrame(nextIndex);
        }, 0);
      });

    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to skip frame.', 'error');
    } finally {
      setIsSkipping(false);
    }
  };

  const handleConfirmSkipFrameRange = async () => {
    if (!videoId || !frames || frames.length === 0) return;
    const startIdx = parseInt(skipRangeStartInput, 10) - 1;
    const endIdx = parseInt(skipRangeEndInput, 10) - 1;

    if (isNaN(startIdx) || isNaN(endIdx) || startIdx < 0 || endIdx >= frames.length || startIdx > endIdx) {
      showToast('Please enter a valid Start and End frame range.', 'error');
      return;
    }

    const startFrame = frames[startIdx]?.name;
    const endFrame = frames[endIdx]?.name;
    if (!startFrame || !endFrame) return;

    setIsSkipping(true);
    try {
      const res = await skipFrameRange(videoId, startFrame, endFrame);
      showToast(res.message, 'success');
      setShowSkipModal(false);

      const updatedData = await queryClient.fetchQuery({
        queryKey: ['frames', videoId],
        queryFn: () => getFramesList(videoId)
      });
      await queryClient.invalidateQueries({ queryKey: ['dataset-status'] });

      const refreshedFrames = updatedData?.frames || [];
      let nextIndex = currentFrameIndex;
      if (refreshedFrames.length > 0) {
        if (nextIndex >= refreshedFrames.length) {
          nextIndex = Math.max(0, refreshedFrames.length - 1);
        }
      }

      requestAnimationFrame(() => {
        setTimeout(() => {
          handleSelectFrame(nextIndex);
        }, 0);
      });
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to skip frame range.', 'error');
    } finally {
      setIsSkipping(false);
    }
  };

  const handleRestoreFrame = async () => {
    if (!videoId || !currentFrame) return;
    try {
      await restoreFrame(videoId, currentFrame.name);
      showToast(`Frame '${currentFrame.name}' restored to annotation workflow.`, 'success');
      await queryClient.invalidateQueries({ queryKey: ['frames', videoId] });
      await queryClient.invalidateQueries({ queryKey: ['dataset-status'] });
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to restore frame.', 'error');
    }
  };

  // If no video, show empty state
  if (!videoId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-8 max-w-lg mx-auto text-center">
        <div className="w-16 h-16 rounded-full bg-navy-card border border-navy-border flex items-center justify-center text-slate-400 mb-6 shadow-xl">
          <FolderOpen className="w-8 h-8 text-sky-400" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100 tracking-wide">No Video Selected</h2>
        <p className="mt-2 text-slate-400 text-sm leading-relaxed">
          The annotation workspace requires an active video session. Please upload a new video file or select an active project from the dashboard.
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            to="/upload"
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold rounded-lg shadow-lg shadow-sky-600/10 transition-colors"
          >
            Upload Video
          </Link>
          <Link
            to="/"
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-navy-border text-slate-300 text-sm font-medium rounded-lg transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Find dynamic metadata counts
  const labelsCount: Record<string, number> = {};
  Object.values(annotations).flat().forEach((ann) => {
    labelsCount[ann.label] = (labelsCount[ann.label] || 0) + 1;
  });

  return (
    <div className="h-[calc(100vh-64px)] flex overflow-hidden select-none bg-navy-dark">
      
      {/* 1. LEFT PANEL: Frame browser */}
      <aside className="w-64 border-r border-navy-border bg-[#0b1426] flex flex-col flex-shrink-0 h-full">
        <div className="p-4 border-b border-navy-border bg-navy-panel flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Frames Browser</span>
            <span className="text-xs font-bold text-ocean-cyan">{totalAnnotated}/{frames.length} Done</span>
          </div>
          <div className="w-full h-2 bg-navy-card border border-navy-border rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-sky-500 to-ocean-cyan rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {videoMeta && videoMeta.status !== 'uploaded' && (
            <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-navy-border/40 text-[10px]">
              <span className="text-slate-500 font-medium">Motion Profile:</span>
              <span className="font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded uppercase">
                {videoMeta.motion_profile}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoadingFrames ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-2">
              <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-ocean-cyan" />
              <span className="text-xs text-slate-500">Loading frames...</span>
            </div>
          ) : framesError ? (
            <div className="p-3 text-center border border-rose-900 bg-rose-950/20 text-rose-400 rounded-lg text-xs flex items-center justify-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Error loading frames</span>
            </div>
          ) : frames.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              No frames extracted.
            </div>
          ) : (
            frames.map((frame, idx) => {
              const isSelected = currentFrameIndex === idx;
              const hasLabels = frame.annotated || (annotations[frame.name] && annotations[frame.name].length > 0);
              return (
                <div
                  key={frame.name}
                  ref={isSelected ? activeFrameRef : null}
                  onClick={() => handleSelectFrame(idx)}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-all duration-200 flex items-center justify-between ${
                    isSelected
                      ? 'bg-navy-dark border-ocean-cyan shadow-[0_0_10px_rgba(0,240,255,0.25)] text-slate-100'
                      : 'bg-[#0c162b]/40 border-navy-border/50 text-slate-400 hover:bg-[#0c162b]/80 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <img
                      src={getFrameImageUrl(videoId, frame.name)}
                      alt=""
                      className="w-14 h-9 object-cover rounded bg-slate-900 border border-navy-border/60 flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-200">
                          {idx + 1} of {frames.length}
                        </span>
                        {hasLabels ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" title="Annotated" />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-600" title="Not Annotated" />
                        )}
                      </div>
                      <span className="text-[9px] font-mono text-slate-500 truncate max-w-[120px]">{frame.name}</span>
                    </div>
                  </div>

                  {frame.skipped ? (
                    <span className="text-[10px] font-bold text-amber-400 bg-amber-950/50 border border-amber-500/30 px-1.5 py-0.5 rounded scale-90">
                      Skipped
                    </span>
                  ) : hasLabels ? (
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-900/20 px-1.5 py-0.5 rounded scale-90">
                      Saved
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-900/60 border border-slate-800 px-1.5 py-0.5 rounded scale-90">
                      Empty
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* 2. CENTER PANEL: Canvas Workspace */}
      <section className="flex-1 flex flex-col h-full bg-[#080f1e] overflow-hidden relative">
        {/* Actions Toolbar */}
        <div className="h-12 bg-navy-panel border-b border-navy-border px-4 flex items-center justify-between flex-shrink-0">

          {/* Left cluster: drawing tools */}
          <div className="flex items-center space-x-1.5">
            <button
              id="tool-select"
              onClick={() => handleSetTool('select')}
              title="Select / Move / Resize (S)"
              className={`p-2 rounded-lg transition-all duration-150 border ${
                activeTool === 'select'
                  ? 'bg-sky-600 border-sky-500 text-white shadow-md shadow-sky-600/20'
                  : 'bg-navy-card border-navy-border text-slate-400 hover:text-slate-100 hover:border-slate-600'
              }`}
            >
              <MousePointer className="w-4 h-4" />
            </button>

            <button
              id="tool-draw"
              onClick={() => handleSetTool('draw')}
              title="Draw Bounding Box (D)"
              className={`p-2 rounded-lg transition-all duration-150 border ${
                activeTool === 'draw'
                  ? 'bg-sky-600 border-sky-500 text-white shadow-md shadow-sky-600/20'
                  : 'bg-navy-card border-navy-border text-slate-400 hover:text-slate-100 hover:border-slate-600'
              }`}
            >
              <Square className="w-4 h-4" />
            </button>

            <div className="w-px h-6 bg-navy-border/80 mx-1.5" />

            <button
              id="tool-delete"
              title="Delete Selected Box (Del)"
              disabled={!selectedAnnotationId}
              onClick={() => selectedAnnotationId && deleteAnnotation(selectedAnnotationId)}
              className="p-2 bg-navy-card border border-navy-border text-slate-400 hover:text-rose-400 hover:border-rose-900 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:border-navy-border rounded-lg transition-all duration-150"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Centre cluster: viewport controls */}
          <div className="flex items-center space-x-1">
            <button
              id="tool-zoom-in"
              title="Zoom In (+)"
              onClick={handleZoomIn}
              className="p-2 bg-navy-card border border-navy-border text-slate-400 hover:text-sky-300 hover:border-sky-900 rounded-lg transition-all duration-150"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <button
              id="tool-zoom-out"
              title="Zoom Out (−)"
              onClick={handleZoomOut}
              className="p-2 bg-navy-card border border-navy-border text-slate-400 hover:text-sky-300 hover:border-sky-900 rounded-lg transition-all duration-150"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <button
              id="tool-fit"
              title="Fit Frame to Viewport"
              onClick={handleFitScreen}
              className="p-2 bg-navy-card border border-navy-border text-slate-400 hover:text-sky-300 hover:border-sky-900 rounded-lg transition-all duration-150"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            <button
              id="tool-reset"
              title="Reset Zoom & Pan"
              onClick={handleResetView}
              className="p-2 bg-navy-card border border-navy-border text-slate-400 hover:text-sky-300 hover:border-sky-900 rounded-lg transition-all duration-150"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Live zoom percentage badge */}
            <span
              className={`text-xs font-mono px-2 min-w-[46px] text-center rounded ${
                zoomLevel !== 1 ? 'text-sky-400 font-bold' : 'text-slate-500'
              }`}
            >
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>

          {/* Right cluster: save */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400">Auto Save</span>
              <button
                onClick={() => setAutoSave(!autoSave)}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${
                  autoSave ? 'bg-sky-500' : 'bg-slate-800'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                    autoSave ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <button
              onClick={handleManualSave}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors shadow-md shadow-emerald-600/10"
              title="Save current frame annotations"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>

            <button
              onClick={handleFinalizeAnnotatedDataset}
              className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors shadow-md shadow-sky-600/10"
              title="Finalize all annotated frames for training"
            >
              <PackageCheck className="w-3.5 h-3.5" />
              <span>Save Annotated Frames</span>
            </button>

            {currentFrame?.skipped ? (
              <button
                onClick={handleRestoreFrame}
                title="Restore Frame to Active Annotation Workflow"
                className="px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-all shadow-md shadow-amber-500/10"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Restore Frame</span>
              </button>
            ) : (
              <button
                onClick={() => setShowSkipModal(true)}
                title="Exclude Frame from AI Training"
                className="px-3.5 py-1.5 bg-navy-card hover:bg-amber-950/40 border border-navy-border hover:border-amber-500/40 text-amber-400 hover:text-amber-300 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-all"
              >
                <FastForward className="w-3.5 h-3.5" />
                <span>Skip Frame</span>
              </button>
            )}
          </div>
        </div>

        {/* Large Viewport Canvas Area */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#070d19]">
          {/* Isolated Fabric Host Container — Imperatively managed DOM node outside React VDOM reconciliation */}
          <div ref={fabricHostRef} className="absolute inset-0 flex items-center justify-center pointer-events-auto" />

          {/* Floating Skipped Frame Banner */}
          {currentFrame?.skipped && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full bg-amber-950/90 border border-amber-500/50 text-amber-300 text-xs font-semibold flex items-center space-x-3 shadow-2xl backdrop-blur-md animate-fadeIn">
              <Ban className="w-4 h-4 text-amber-400" />
              <span>Frame Skipped — Excluded from AI Training</span>
              <button
                onClick={handleRestoreFrame}
                className="px-2.5 py-0.5 bg-amber-500/20 hover:bg-amber-500/40 text-amber-200 text-[10px] font-bold rounded border border-amber-400/40 transition-colors"
              >
                Restore
              </button>
            </div>
          )}

          {/* Floating Label Prompt Overlay */}
          {promptState?.visible && (() => {
            const filtered = classLabels.filter(
              (c) => c.toLowerCase().includes(promptInput.toLowerCase())
            );
            return (
              <>
                {/* Transparent click-outside backdrop */}
                <div
                  className="absolute inset-0 z-40"
                  onClick={handlePromptCancel}
                />
                {/* Prompt card */}
                <div
                  className="absolute z-50 w-56 rounded-lg border border-sky-600/40 bg-[#0b1426]/95 backdrop-blur-md shadow-2xl shadow-sky-900/30 overflow-hidden"
                  style={{
                    left: Math.min(promptState.x, (canvasDimensions.width || 600) - 240),
                    top: Math.max(0, promptState.y - 8),
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="px-3 py-1.5 bg-sky-900/30 border-b border-sky-800/30 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">Assign Label</span>
                    <button onClick={handlePromptCancel} className="text-slate-500 hover:text-slate-300 text-xs leading-none">✕</button>
                  </div>
                  {/* Input */}
                  <div className="p-2">
                    <input
                      ref={promptInputRef}
                      type="text"
                      value={promptInput}
                      placeholder="Type label name..."
                      className="w-full px-2.5 py-1.5 text-xs bg-[#070d19] border border-navy-border rounded-md text-slate-100 placeholder-slate-600 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition-colors"
                      onChange={(e) => {
                        setPromptInput(e.target.value);
                        setPromptHighlight(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const label = filtered.length > 0 ? filtered[Math.min(promptHighlight, filtered.length - 1)] : promptInput.trim();
                          if (label) handlePromptConfirm(label);
                        } else if (e.key === 'Escape') {
                          handlePromptCancel();
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setPromptHighlight((prev) => Math.min(prev + 1, filtered.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setPromptHighlight((prev) => Math.max(prev - 1, 0));
                        }
                      }}
                    />
                  </div>
                  {/* Suggestions */}
                  {filtered.length > 0 && (
                    <div className="max-h-36 overflow-y-auto border-t border-navy-border/40">
                      {filtered.map((cls, idx) => (
                        <button
                          key={cls}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                            idx === promptHighlight
                              ? 'bg-sky-600/30 text-sky-200'
                              : 'text-slate-300 hover:bg-sky-900/20 hover:text-sky-200'
                          }`}
                          onMouseEnter={() => setPromptHighlight(idx)}
                          onClick={() => handlePromptConfirm(cls)}
                        >
                          {cls}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* New class hint */}
                  {promptInput.trim() && !classLabels.some((c) => c.toLowerCase() === promptInput.trim().toLowerCase()) && (
                    <div className="px-3 py-1.5 border-t border-navy-border/40">
                      <button
                        className="w-full text-left text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                        onClick={() => handlePromptConfirm(promptInput.trim())}
                      >
                        + Create new class "<span className="font-bold">{promptInput.trim()}</span>"
                      </button>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {/* Manual Edit Notification Popup & Resume Prompt */}
          {showResumePrompt && (
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-50 bg-[#0f1b35]/95 border border-amber-500/30 rounded-xl p-4 shadow-2xl backdrop-blur-md max-w-sm w-full flex flex-col gap-3 transition-all duration-300">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500 flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-bold text-slate-200">Manual Edit Detected</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    You have manually modified annotations on this frame. Do you want to resume AI tracking from this frame?
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowResumePrompt(false)}
                  className="px-3 py-1.5 text-[10px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded font-semibold transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={async () => {
                    setShowResumePrompt(false);
                    await handlePropagateResume();
                  }}
                  className="px-3 py-1.5 text-[10px] bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-900 font-extrabold rounded shadow-md transition-all active:scale-98"
                >
                  Resume Tracking
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Floating Premium Toast Message */}
        {toast && (
          <div className={`absolute bottom-16 right-4 px-4 py-2.5 rounded-lg border shadow-lg transition-all duration-300 z-50 text-xs font-semibold flex items-center gap-2 animate-bounce ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-400'
              : 'bg-rose-950/90 border-rose-500/30 text-rose-400'
          }`}>
            <span>{toast.message}</span>
          </div>
        )}

        {/* Shortcuts detail */}
        <div className="h-10 bg-navy-panel border-t border-navy-border px-4 flex items-center justify-between flex-shrink-0 text-slate-400 text-[11px]">
          <div className="flex items-center space-x-3">
            <span><kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px]">S</kbd> Select</span>
            <span><kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px]">B</kbd> Draw Box</span>
            <span><kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px]">Del</kbd> Remove</span>
            <span><kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px]">Esc</kbd> Select Mode</span>
            <span><kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px]">+/-</kbd> Zoom</span>
            <span><kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px]">Scroll</kbd> Zoom</span>
            <span><kbd className="bg-navy-card px-1 py-0.5 border border-navy-border rounded text-[10px]">A/D</kbd> Frame Nav</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-300">
              Frame {frames.length > 0 ? currentFrameIndex + 1 : 0} / {frames.length}
            </span>
          </div>
        </div>
      </section>

      {/* 3. RIGHT PANEL: Bounding Box Properties & stats */}
      <aside className="w-80 border-l border-navy-border bg-[#0b1426] flex flex-col flex-shrink-0 h-full overflow-y-auto">
        
        {/* ANNOTATION INSPECTOR PANEL (When Annotation Selected) */}
        {selectedAnnotation ? (
          <div className="p-4 border-b border-navy-border bg-sky-950/20 space-y-3 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <h3 className="text-xs font-extrabold text-slate-100 uppercase tracking-wider">
                  {isEditingAnnotation ? 'ANNOTATION INSPECTOR (Editing...)' : 'ANNOTATION INSPECTOR'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isEditingAnnotation) {
                    handleCancelEditAnnotation();
                  } else {
                    setSelectedAnnotationId(null);
                  }
                }}
                className="p-1 text-slate-400 hover:text-slate-100 rounded hover:bg-navy-card transition-colors"
                title="Close Inspector (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Readouts */}
            <div className="grid grid-cols-2 gap-2 text-[10px] bg-[#070d19]/80 border border-navy-border/60 p-2.5 rounded-lg font-mono text-slate-300">
              <div>
                <span className="text-slate-500 block uppercase tracking-tighter text-[9px]">Object ID</span>
                <span className="font-bold text-sky-300 truncate block">{selectedAnnotation.id}</span>
              </div>
              <div>
                <span className="text-slate-500 block uppercase tracking-tighter text-[9px]">Source</span>
                <span className="font-bold text-slate-200 block">{selectedAnnotation.source || 'Manual'}</span>
              </div>
            </div>

            {!isEditingAnnotation ? (
              /* VIEW MODE */
              <div className="space-y-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Class Label</span>
                  <div className="bg-[#070d19] border border-navy-border px-3 py-2 rounded-lg flex items-center justify-between text-xs font-semibold text-slate-100">
                    <span className="flex items-center space-x-2">
                      <Tag className="w-3.5 h-3.5 text-sky-400" />
                      <span>{selectedAnnotation.label}</span>
                    </span>
                    <span className="text-[9px] font-mono text-slate-400 bg-navy-card px-2 py-0.5 rounded border border-navy-border">
                      {selectedAnnotation.confidence ? `${(selectedAnnotation.confidence * 100).toFixed(0)}% Conf` : 'Manual'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Bounding Box Coordinates</span>
                  <div className="grid grid-cols-4 gap-1.5 text-center font-mono text-xs">
                    <div className="bg-[#070d19] border border-navy-border p-2 rounded-lg">
                      <span className="text-[9px] text-slate-500 block uppercase">X</span>
                      <span className="font-bold text-slate-200">{Math.round(selectedAnnotation.bbox[0])}</span>
                    </div>
                    <div className="bg-[#070d19] border border-navy-border p-2 rounded-lg">
                      <span className="text-[9px] text-slate-500 block uppercase">Y</span>
                      <span className="font-bold text-slate-200">{Math.round(selectedAnnotation.bbox[1])}</span>
                    </div>
                    <div className="bg-[#070d19] border border-navy-border p-2 rounded-lg">
                      <span className="text-[9px] text-slate-500 block uppercase">Width</span>
                      <span className="font-bold text-slate-200">{Math.round(selectedAnnotation.bbox[2] - selectedAnnotation.bbox[0])}</span>
                    </div>
                    <div className="bg-[#070d19] border border-navy-border p-2 rounded-lg">
                      <span className="text-[9px] text-slate-500 block uppercase">Height</span>
                      <span className="font-bold text-slate-200">{Math.round(selectedAnnotation.bbox[3] - selectedAnnotation.bbox[1])}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleStartEditAnnotation(selectedAnnotation)}
                    className="py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-xs flex items-center justify-center space-x-1 shadow-md transition-all active:scale-98"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => duplicateAnnotation(selectedAnnotation.id)}
                    className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-xs flex items-center justify-center space-x-1 border border-navy-border transition-colors active:scale-98"
                  >
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Duplicate</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteAnnotation(selectedAnnotation.id)}
                    className="py-2 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 font-bold rounded-lg text-xs flex items-center justify-center space-x-1 border border-rose-900/40 transition-colors active:scale-98"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ) : (
              /* EDIT MODE */
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Class Label</label>
                  <select
                    value={editForm.label}
                    onChange={(e) => {
                      const newLbl = e.target.value;
                      setEditForm(prev => ({ ...prev, label: newLbl }));
                      updateCanvasFromEditForm(editForm.xmin, editForm.ymin, editForm.width, editForm.height, newLbl);
                    }}
                    className="w-full bg-[#070d19] border border-sky-500/50 rounded-lg px-3 py-2 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400"
                  >
                    {classLabels.map(lbl => (
                      <option key={lbl} value={lbl}>{lbl}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="font-bold text-slate-400 uppercase tracking-wider">Canvas Control</span>
                    <span className="font-semibold text-emerald-400 flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3 animate-pulse" />
                      <span>Canvas Edit Active</span>
                    </span>
                  </div>

                  <div className="p-2.5 bg-[#070d19] border border-navy-border/60 rounded-lg text-slate-400 text-[10px] space-y-1.5">
                    <p className="italic text-slate-400">
                      Drag corner handles or move bounding box directly on canvas.
                    </p>
                    <div className="grid grid-cols-4 gap-1.5 text-center font-mono text-xs pt-1 border-t border-navy-border/40">
                      <div className="bg-navy-card/60 p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block uppercase">X</span>
                        <span className="font-bold text-slate-200">{editForm.xmin}</span>
                      </div>
                      <div className="bg-navy-card/60 p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block uppercase">Y</span>
                        <span className="font-bold text-slate-200">{editForm.ymin}</span>
                      </div>
                      <div className="bg-navy-card/60 p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block uppercase">W</span>
                        <span className="font-bold text-slate-200">{editForm.width}</span>
                      </div>
                      <div className="bg-navy-card/60 p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block uppercase">H</span>
                        <span className="font-bold text-slate-200">{editForm.height}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveEditAnnotation}
                    className="py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs flex items-center justify-center space-x-1 shadow-md transition-all active:scale-98"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Save Changes</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelEditAnnotation}
                    className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg text-xs flex items-center justify-center space-x-1 border border-navy-border transition-colors active:scale-98"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Annotations List Section */}
        <div className="p-4 border-b border-navy-border">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
            <span>Annotations on Frame ({activeAnnotations.length})</span>
          </h3>
          
          {activeAnnotations.length === 0 ? (
            <div className="p-6 text-center border border-dashed border-navy-border rounded-lg bg-[#0c162b]/30">
              <span className="text-xs text-slate-500">No objects labeled on this frame.</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
              {activeAnnotations.map((ann) => {
                const isSelected = selectedAnnotationId === ann.id;
                const lowLbl = ann.label.toLowerCase();
                const emoji = lowLbl.includes('fish') ? '🐟' 
                            : lowLbl.includes('crab') ? '🦀'
                            : lowLbl.includes('coral') ? '🪸'
                            : lowLbl.includes('turtle') ? '🐢'
                            : lowLbl.includes('star') ? '⭐'
                            : '🏷️';
                return (
                  <div
                    key={ann.id}
                    onClick={() => {
                      setSelectedAnnotationId(ann.id);
                      handleSetTool('select');
                    }}
                    className={`p-2.5 rounded-lg border text-xs flex items-center justify-between cursor-pointer transition-all duration-200 ${
                      isSelected 
                        ? 'bg-sky-950/40 border-sky-500 text-sky-200 shadow-md shadow-sky-500/10' 
                        : 'bg-[#0c162b]/40 border-navy-border/40 hover:bg-[#0c162b]/70 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span>{emoji}</span>
                      <span className="font-semibold truncate">{ann.label}</span>
                      <span className="text-[9px] font-mono text-slate-500">
                        ({Math.round(ann.bbox[0])},{Math.round(ann.bbox[1])})
                      </span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEditAnnotation(ann);
                        }}
                        className="p-1 hover:bg-sky-500/20 text-slate-400 hover:text-sky-300 rounded"
                        title="Edit Annotation"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAnnotation(ann.id);
                        }}
                        className="p-1 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 rounded"
                        title="Delete Annotation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

          {/* Quick labels selection */}
          <div className="mt-4">
            <label className="block text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-2">
              Class Labels List
            </label>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {classLabels.map((lbl) => {
                const isCurrent = activeLabel === lbl;
                return (
                  <button
                    key={lbl}
                    onClick={() => handleLabelQuickSelect(lbl)}
                    className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                      isCurrent
                        ? 'text-slate-900 bg-[#00f0ff] border-transparent font-bold'
                        : 'text-slate-400 border-navy-border hover:border-slate-700'
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>

            {/* Custom label input */}
            <form onSubmit={handleAddCustomLabel} className="relative flex rounded-md border border-navy-border bg-[#0c162b]">
              <input
                type="text"
                value={newLabelInput}
                onChange={(e) => setNewLabelInput(e.target.value)}
                placeholder="Custom label name..."
                className="w-full bg-transparent px-3 py-1.5 text-xs text-slate-200 focus:outline-none placeholder:text-slate-600"
              />
              <button type="submit" className="px-3 border-l border-navy-border text-sky-400 hover:text-sky-300 flex items-center transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </form>
          </div>

        {/* AI Interactive Tracking Card */}
        <div className="p-4 border-b border-navy-border space-y-4">
          <div className="bg-[#0c162b]/50 border border-navy-border/60 p-4 rounded-xl space-y-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 border-b border-navy-border/40 pb-2">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              AI Active Tracking
            </h3>

            {/* Tracker Type Selection */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Tracker Algorithm
              </label>
              <select
                disabled={isPropagating}
                value={propagationTracker}
                onChange={(e) => setPropagationTracker(e.target.value)}
                className="w-full bg-[#070d19] border border-navy-border text-xs text-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:border-sky-500/50 disabled:opacity-50"
              >
                <option value="CSRT">CSRT (Auto-Fallback)</option>
                <option value="MIL">MIL (Robust)</option>
                <option value="DaSiamRPN">DaSiamRPN (DL)</option>
                <option value="Vit">Vision Transformer (Vit)</option>
                <option value="Nano">Nano (Lightweight DL)</option>
              </select>
            </div>

            {/* Range selection */}
            <div className="space-y-3 pt-1">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Tracking Range
              </label>

              {/* Read-only Current Frame & Remaining grid */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#070d19] border border-navy-border/80 p-2.5 rounded-lg">
                  <span className="text-[9px] font-semibold text-slate-500 uppercase block">Current Frame</span>
                  <span className="text-sm font-extrabold text-sky-400 font-mono block mt-0.5">
                    {currentFrameIndex + 1}
                  </span>
                </div>

                <div className="bg-[#070d19] border border-navy-border/80 p-2.5 rounded-lg">
                  <span className="text-[9px] font-semibold text-slate-500 uppercase block">Remaining</span>
                  <span className="text-sm font-extrabold text-slate-300 font-mono block mt-0.5">
                    {Math.max(0, frames.length - (currentFrameIndex + 1))}
                  </span>
                </div>
              </div>

              {/* End Frame Input */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="font-semibold text-slate-400">End Frame:</span>
                  <span className="text-slate-500">Total: {frames.length}</span>
                </div>
                <input
                  type="number"
                  min={currentFrameIndex + 2}
                  max={frames.length}
                  disabled={isPropagating}
                  value={endFrameInput}
                  onChange={(e) => setEndFrameInput(e.target.value)}
                  placeholder={`e.g. ${Math.min(currentFrameIndex + 25, frames.length)}`}
                  className={`w-full bg-[#070d19] border text-xs text-slate-100 font-mono font-bold rounded-lg px-3 py-2 focus:outline-none transition-colors disabled:opacity-50 ${
                    endFrameValidationError
                      ? 'border-rose-500/80 focus:border-rose-500'
                      : 'border-navy-border focus:border-sky-500/60'
                  }`}
                />

                {/* Inline Validation Warning Message */}
                {endFrameValidationError && (
                  <p className="text-[10px] text-rose-400 font-medium pt-0.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0 text-rose-400" />
                    <span>{endFrameValidationError}</span>
                  </p>
                )}
              </div>

              {/* Dynamic Tracking Summary Card */}
              {!endFrameValidationError && parsedEndFrame > (currentFrameIndex + 1) && (
                <div className="bg-[#070d19]/80 border border-navy-border/60 rounded-lg p-2.5 space-y-1.5 text-[10px]">
                  <span className="font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Tracking Summary
                  </span>
                  <div className="flex justify-between text-slate-400 font-mono">
                    <span>Current Frame:</span>
                    <span className="text-slate-200 font-bold">{currentFrameIndex + 1}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 font-mono">
                    <span>End Frame:</span>
                    <span className="text-sky-400 font-bold">{parsedEndFrame}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 font-mono border-t border-navy-border/40 pt-1 mt-1">
                    <span className="text-slate-300 font-semibold">Frames to Process:</span>
                    <span className="text-emerald-400 font-extrabold">{parsedEndFrame - currentFrameIndex}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Playback speed selector */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Tracking Speed
              </label>
              <div className="grid grid-cols-3 gap-1 bg-[#070d19] p-0.5 border border-navy-border rounded">
                {([3, 8, 15] as const).map((speed) => (
                  <button
                    key={speed}
                    disabled={isPropagating}
                    onClick={() => setPropagationSpeed(speed)}
                    className={`text-[9px] font-semibold py-1 rounded transition-colors ${
                      propagationSpeed === speed
                        ? 'text-slate-200 bg-navy-panel font-bold border border-navy-border/40 shadow-sm'
                        : 'text-slate-500 hover:text-slate-300 disabled:opacity-50'
                    }`}
                  >
                    {speed === 3 ? '3 FPS' : speed === 15 ? '15 FPS' : '8 FPS'}
                  </button>
                ))}
              </div>
            </div>

            {/* YOLO Fallback Switch */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  YOLO Fallback
                </span>
                <span className="text-[8px] text-slate-600">Recover lost targets</span>
              </div>
              <button
                disabled={isPropagating}
                onClick={() => setUseYoloFallback(!useYoloFallback)}
                className={`w-8 h-4 rounded-full relative transition-colors ${
                  useYoloFallback ? 'bg-sky-500' : 'bg-slate-800'
                } disabled:opacity-50`}
              >
                <div
                  className={`w-3 h-3 bg-slate-200 rounded-full absolute top-0.5 transition-transform duration-200 ${
                    useYoloFallback ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Active Target Summary Panel */}
            {activeAnnotations.length > 0 && (
              <div className="p-2.5 bg-navy-panel/40 border border-navy-border/40 rounded-lg space-y-1.5">
                <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  Active Target Summary
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(trackerSummary).map(([label, count]) => {
                    const lowLabel = label.toLowerCase();
                    const emoji = lowLabel.includes('fish') ? '🐟' 
                                : lowLabel.includes('crab') ? '🦀'
                                : lowLabel.includes('coral') ? '🪸'
                                : lowLabel.includes('turtle') ? '🐢'
                                : lowLabel.includes('star') ? '⭐'
                                : '🏷️';
                    const hasNew = activeAnnotations.some(ann => ann.label === label && ann.isNew);
                    return (
                      <span
                        key={label}
                        className={`text-[9px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                          hasNew 
                            ? 'text-pink-400 bg-pink-950/20 border-pink-900/30 shadow-[0_0_6px_rgba(217,70,239,0.15)] animate-pulse'
                            : 'text-slate-300 bg-navy-card border-navy-border/40'
                        }`}
                      >
                        <span>{emoji}</span>
                        <span>{label}</span>
                        <span className="font-bold font-mono text-slate-400">({count})</span>
                        {hasNew && <span className="text-[7px] font-extrabold text-pink-400 uppercase tracking-tighter">New</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Propagation Status Display */}
            {(trackingState !== 'Inactive' || propagationStats.status !== 'Idle') && (
              <div className="p-3 bg-navy-panel border border-navy-border/40 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                    Tracking Monitor
                  </span>
                  <span
                    className={`text-[9px] font-bold font-mono uppercase px-2 py-0.5 rounded ${
                      trackingState === 'Propagating'
                        ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-900/20 animate-pulse'
                        : trackingState === 'Paused'
                        ? 'text-amber-400 bg-amber-950/40 border border-amber-900/20'
                        : trackingState === 'Lost'
                        ? 'text-rose-400 bg-rose-950/40 border border-rose-900/20 font-extrabold'
                        : propagationStats.status === 'Completed'
                        ? 'text-sky-400 bg-sky-950/40 border border-sky-900/20'
                        : 'text-slate-400 bg-slate-950/40 border border-slate-900/20'
                    }`}
                  >
                    {trackingState === 'Inactive' ? propagationStats.status : trackingState}
                  </span>
                </div>

                {/* Progress bar */}
                {propagationStats.total > 0 && (
                  <div className="space-y-1">
                    <div className="w-full h-1.5 bg-[#070d19] rounded-full overflow-hidden border border-navy-border/30">
                      <div
                        className="h-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.round(
                            (propagationStats.current / propagationStats.total) * 100
                          ))}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[9px] font-mono text-slate-500">
                      <span>
                        Frame {propagationStats.current} / {propagationStats.total}
                      </span>
                      <span>
                        {Math.min(100, Math.round((propagationStats.current / propagationStats.total) * 100))}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Stats list */}
                <div className="grid grid-cols-2 gap-2 text-[9px] border-t border-navy-border/20 pt-2 font-mono text-slate-400">
                  <div>
                    <span className="text-slate-600 block text-[8px] uppercase tracking-tighter">Active Tracks</span>
                    <span className="font-bold text-slate-300">{propagationStats.objectsTracked} targets</span>
                  </div>
                  <div>
                    <span className="text-slate-600 block text-[8px] uppercase tracking-tighter">Remaining</span>
                    <span className="font-bold text-slate-300">
                      {propagationStats.total > propagationStats.current
                        ? `${propagationStats.total - propagationStats.current} frames`
                        : '0 frames'}
                    </span>
                  </div>
                </div>

                {propagationStats.stopReason && (
                  <div className="text-[9px] text-amber-500 bg-amber-950/10 border border-amber-900/20 p-1.5 rounded font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{propagationStats.stopReason}</span>
                  </div>
                )}
              </div>
            )}

            {/* Action controls */}
            <div className="flex flex-col gap-2 pt-1">
              {trackingState === 'Propagating' ? (
                <button
                  type="button"
                  onClick={handlePropagatePause}
                  className="w-full py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-900 font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-98"
                >
                  <Pause className="w-4 h-4 fill-slate-900" />
                  <span>Pause AI Tracking</span>
                </button>
              ) : trackingState === 'Paused' ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePropagateResume}
                    className="flex-1 py-2 bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-300 hover:to-indigo-400 text-slate-900 font-extrabold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg active:scale-98"
                  >
                    <Play className="w-4 h-4 fill-slate-900" />
                    <span>Resume AI Tracking</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePropagateStop}
                    className="px-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg text-xs flex items-center justify-center transition-colors border border-navy-border active:scale-98"
                    title="Stop AI Session"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              ) : trackingState === 'Lost' ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={activeAnnotations.length === 0}
                    onClick={handlePropagateStart}
                    className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-900 font-extrabold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg active:scale-98 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-4 h-4 text-slate-900 animate-pulse" />
                    <span>Restart AI Tracking</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePropagateStop}
                    className="px-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg text-xs flex items-center justify-center transition-colors border border-navy-border active:scale-98"
                    title="Stop AI Session"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {currentFrame?.skipped && (
                    <p className="text-[10px] text-amber-400 text-center font-medium bg-amber-950/40 border border-amber-500/30 p-1.5 rounded">
                      Cannot initiate AI tracking on a skipped frame.
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={activeAnnotations.length === 0 || !!currentFrame?.skipped || !!endFrameValidationError}
                    onClick={handlePropagateStart}
                    className="w-full py-2 bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-300 hover:to-indigo-400 text-slate-900 font-extrabold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-sky-500/10 active:scale-98 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none"
                  >
                  {propagationStats.status === 'Idle' && propagationStats.stopReason.includes('Saving') ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
                      <span>Initializing...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-slate-900" />
                      <span>Start AI Tracking</span>
                    </>
                  )}
                </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Statistics list */}
        <div className="p-4 border-b border-navy-border">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Annotation Label stats
          </h3>
          <div className="space-y-1.5 text-xs text-slate-400">
            {classLabels.map((lbl) => {
              const count = labelsCount[lbl] || 0;
              return (
                <div key={lbl} className="flex justify-between py-0.5">
                  <span className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded bg-ocean-cyan" /> {lbl}
                  </span>
                  <span className="font-mono text-slate-300">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="p-4 bg-navy-panel/40">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            AI Suggestion
          </h3>
          <div className="p-3 text-center border border-dashed border-sky-950 bg-sky-950/10 rounded-lg text-slate-500 text-xs">
            No predictions generated yet.
          </div>
        </div>
      </aside>

      {/* Confirmation Modal — Skip Frames (Single / Range) */}
      {showSkipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-navy-panel border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <Ban className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Exclude Frames from Training</h3>
                <p className="text-xs text-amber-300">Preserves images while excluding them from YOLO export & AI training.</p>
              </div>
            </div>

            {/* Mode Tab Switcher: Range vs Single */}
            <div className="grid grid-cols-2 gap-1 bg-[#070d19] p-1 border border-navy-border rounded-xl">
              <button
                type="button"
                onClick={() => setSkipTab('range')}
                className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  skipTab === 'range'
                    ? 'bg-amber-500 text-slate-900 shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Skip Range (Batch)
              </button>
              <button
                type="button"
                onClick={() => setSkipTab('single')}
                className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  skipTab === 'single'
                    ? 'bg-amber-500 text-slate-900 shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Current Frame Only
              </button>
            </div>

            {skipTab === 'range' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Start Frame</label>
                    <input
                      type="number"
                      min={1}
                      max={frames.length}
                      value={skipRangeStartInput}
                      onChange={(e) => setSkipRangeStartInput(e.target.value)}
                      className="w-full bg-[#070d19] border border-navy-border rounded-lg px-3 py-2 text-xs font-mono text-slate-100 font-bold focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">End Frame</label>
                    <input
                      type="number"
                      min={1}
                      max={frames.length}
                      value={skipRangeEndInput}
                      onChange={(e) => setSkipRangeEndInput(e.target.value)}
                      className="w-full bg-[#070d19] border border-navy-border rounded-lg px-3 py-2 text-xs font-mono text-slate-100 font-bold focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                {(() => {
                  const s = parseInt(skipRangeStartInput, 10);
                  const e = parseInt(skipRangeEndInput, 10);
                  const count = (!isNaN(s) && !isNaN(e) && s <= e && s >= 1 && e <= frames.length) ? (e - s + 1) : 0;
                  return (
                    <div className="bg-navy-card/90 border border-navy-border/80 rounded-xl p-3.5 space-y-1.5 text-xs text-slate-300">
                      <div className="flex justify-between items-center font-semibold text-slate-200">
                        <span>Frames to Skip:</span>
                        <span className="font-mono text-amber-400 font-bold text-sm">{count} frames</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Frames {s || 1} through {e || frames.length} will be marked as skipped in bulk.
                      </p>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="bg-navy-card/90 border border-navy-border/80 rounded-xl p-4 space-y-2.5 text-xs text-slate-300">
                <p className="font-semibold text-slate-200">Frame {currentFrameIndex + 1} ('{currentFrame?.name}')</p>
                <div className="space-y-1.5 text-emerald-400 font-medium">
                  <div>✓ Frame Image will be preserved.</div>
                  <div>✓ Metadata will be preserved.</div>
                  <div>✓ Frame will NOT be exported in YOLO datasets.</div>
                  <div>✓ Frame will NOT be used during model training.</div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-navy-border/60">
              <button
                onClick={() => setShowSkipModal(false)}
                disabled={isSkipping}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-navy-card border border-navy-border text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              {skipTab === 'range' ? (
                <button
                  onClick={handleConfirmSkipFrameRange}
                  disabled={isSkipping}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-navy-dark transition-all flex items-center space-x-1.5 shadow-lg shadow-amber-500/20 font-bold"
                >
                  {isSkipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                  <span>
                    {isSkipping
                      ? 'Skipping Range...'
                      : `Skip Range (${Math.max(
                          0,
                          (parseInt(skipRangeEndInput, 10) - parseInt(skipRangeStartInput, 10) + 1) || 0
                        )} Frames)`}
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleConfirmSkipFrame}
                  disabled={isSkipping}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-navy-dark transition-all flex items-center space-x-1.5 shadow-lg shadow-amber-500/20 font-bold"
                >
                  {isSkipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                  <span>{isSkipping ? 'Skipping Frame...' : 'Skip Single Frame'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Right-Click Context Menu Floating Popover */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-[#0c162b] border border-navy-border rounded-xl shadow-2xl p-1.5 min-w-[160px] text-xs space-y-1 animate-fadeIn"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const selectedAnn = (annotations[currentFrame?.name || ''] || []).find(a => a.id === contextMenu.annId);
              if (selectedAnn) {
                handleStartEditAnnotation(selectedAnn);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg hover:bg-sky-500/20 text-slate-200 hover:text-sky-300 font-medium transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5 text-sky-400" />
            <span>Edit Annotation</span>
          </button>
          <button
            type="button"
            onClick={() => {
              duplicateAnnotation(contextMenu.annId);
              setContextMenu(null);
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg hover:bg-navy-card text-slate-300 hover:text-white font-medium transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            <span>Duplicate Box</span>
          </button>
          <div className="h-px bg-navy-border/40 my-1" />
          <button
            type="button"
            onClick={() => {
              deleteAnnotation(contextMenu.annId);
              setContextMenu(null);
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Delete Annotation</span>
          </button>
        </div>
      )}

    </div>
  );
};

const WorkspaceWrapped: React.FC = () => (
  <WorkspaceErrorBoundary>
    <Workspace />
  </WorkspaceErrorBoundary>
);

export default WorkspaceWrapped;

