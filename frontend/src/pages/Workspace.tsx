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
  AlertCircle
} from 'lucide-react';
import { 
  getFramesList, 
  getFrameImageUrl, 
  getAnnotations, 
  saveAnnotations, 
  getClasses 
} from '../services/videoService';

interface MockAnnotation {
  id: string;
  label: string;
  bbox: [number, number, number, number]; // [xmin, ymin, xmax, ymax]
  color?: string;
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

  // Canvas Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const activeFrameRef = useRef<HTMLDivElement | null>(null);
  const imageBoundsRef = useRef({ left: 0, top: 0, width: 800, height: 450 });
  const originalImageSizeRef = useRef({ width: 1920, height: 1080 });
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 800, height: 450 });
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  const frames = useMemo(() => framesData?.frames || [], [framesData?.frames]);
  const currentFrame = frames[currentFrameIndex];

  const activeAnnotations = useMemo(() => 
    currentFrame ? (annotations[currentFrame.name] || []) : [],
    [currentFrame, annotations]
  );

  const selectedAnnotation = useMemo(() => 
    activeAnnotations.find((ann) => ann.id === selectedAnnotationId),
    [activeAnnotations, selectedAnnotationId]
  );

  // Computed properties
  const totalAnnotated = Object.keys(annotations).filter(key => annotations[key].length > 0).length;
  const progressPercent = frames.length > 0 ? Math.round((totalAnnotated / frames.length) * 100) : 0;

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
          id: Math.random().toString(36).substr(2, 9),
          label: ann.label,
          bbox: ann.bbox, // [xmin, ymin, xmax, ymax]
          color: DEFAULT_ANNOTATION_COLOR,
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

  // Add annotation to local state
  const addAnnotation = useCallback((frameName: string, ann: MockAnnotation) => {
    setAnnotations((prev) => {
      const currentList = prev[frameName] || [];
      return {
        ...prev,
        [frameName]: [...currentList, ann],
      };
    });
  }, []);

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
  }, [currentFrame]);

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
  }, [currentFrame]);

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
  }, [currentFrame]);

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
          handleSetTool('select');
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
          handleSetTool('select');
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
    if (!canvasRef.current) return;

    const initialWidth = containerRef.current?.clientWidth || 800;
    const initialHeight = containerRef.current?.clientHeight || 450;

    const fbCanvas = new Canvas(canvasRef.current, {
      width: initialWidth,
      height: initialHeight,
      selection: true,
      backgroundColor: '#070d19',
    });

    fabricCanvasRef.current = fbCanvas;

    // Selection handlers
    const onSelection = (e: any) => {
      const selectedObj = e.selected?.[0];
      if (selectedObj && (selectedObj as any).data) {
        setSelectedAnnotationId((selectedObj as any).data.id);
      }
    };

    fbCanvas.on('selection:created', onSelection);
    fbCanvas.on('selection:updated', onSelection);
    fbCanvas.on('selection:cleared', () => {
      setSelectedAnnotationId(null);
    });

    // Helper to align floating text above rect boundaries
    const updateTextLabelPos = (rect: Rect) => {
      const textObj = (rect as any).textObject;
      if (!textObj) return;
      textObj.set({
        left: rect.left,
        top: (rect.top || 0) - 16,
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
      const scale = bounds.width / originalImageSizeRef.current.width;

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
    });

    // Clamp coordinates during moving to keep them inside image bounds
    fbCanvas.on('object:moving', (e) => {
      const obj = e.target;
      if (!obj) return;
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
      fbCanvas.renderAll();
    });

    // Clamp coordinates during scaling to keep them inside image bounds
    fbCanvas.on('object:scaling', (e) => {
      const obj = e.target;
      if (!obj) return;
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
        const color = DEFAULT_ANNOTATION_COLOR;

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
          cornerColor: color,
          cornerSize: isSelected ? 10 : 7,
          transparentCorners: false,
          originX: 'left',
          originY: 'top',
          selectable: activeTool === 'select',
          evented: activeTool === 'select',
          data: ann,
        });

        // Small dynamic label text above bounding box
        const labelText = new FabricText(ann.label, {
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
    };
    imgEl.onerror = (err) => {
      console.error('Error loading image via HTML Image:', err);
    };

    return () => {
      isCurrent = false;
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
              const hasLabels = (annotations[frame.name] || []).length > 0;
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

                  {hasLabels ? (
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
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
          </div>
        </div>

        {/* Large Viewport Canvas Area */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#070d19]">
          {/* Real HTML5 Canvas target for Fabric.js */}
          <canvas ref={canvasRef} />

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
      <aside className="w-72 border-l border-navy-border bg-[#0b1426] flex flex-col flex-shrink-0 h-full overflow-y-auto">
        <div className="p-4 border-b border-navy-border">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Annotations on Frame ({activeAnnotations.length})
          </h3>
          
          {activeAnnotations.length === 0 ? (
            <div className="p-6 text-center border border-dashed border-navy-border rounded-lg bg-[#0c162b]/30">
              <span className="text-xs text-slate-500">No objects labeled on this frame.</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {activeAnnotations.map((ann) => {
                const isSelected = selectedAnnotationId === ann.id;
                return (
                  <div
                    key={ann.id}
                    onClick={() => setSelectedAnnotationId(ann.id)}
                    className={`p-3 rounded-lg border transition-all duration-200 flex items-center justify-between cursor-pointer ${
                      isSelected 
                        ? 'bg-navy-card border-ocean-cyan shadow-md' 
                        : 'bg-[#0c162b]/40 border-navy-border/40 hover:bg-[#0c162b]/70'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div 
                        className="w-3.5 h-3.5 rounded flex-shrink-0" 
                        style={{ backgroundColor: DEFAULT_ANNOTATION_COLOR }}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-slate-200">{ann.label}</span>
                        <span className="text-[10px] font-mono text-slate-500 truncate">
                          bbox: [{ann.bbox.join(', ')}]
                        </span>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAnnotation(ann.id);
                      }}
                      title="Remove Box" 
                      className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Selected Bounding Box Live Coordinates Display */}
          {selectedAnnotation && (
            <div className="p-3 bg-navy-panel border border-sky-500/20 rounded-lg mt-3">
              <span className="block text-[9px] font-bold text-sky-400 uppercase tracking-wider mb-2">
                Selected Box Coordinates
              </span>
              <div className="grid grid-cols-4 gap-1 text-center font-mono text-[10px]">
                <div className="bg-[#0c162b] p-1 py-1.5 rounded border border-navy-border/50">
                  <span className="block text-[8px] text-slate-500">XMIN</span>
                  <span className="text-slate-200 font-bold">{selectedAnnotation.bbox[0]}</span>
                </div>
                <div className="bg-[#0c162b] p-1 py-1.5 rounded border border-navy-border/50">
                  <span className="block text-[8px] text-slate-500">YMIN</span>
                  <span className="text-slate-200 font-bold">{selectedAnnotation.bbox[1]}</span>
                </div>
                <div className="bg-[#0c162b] p-1 py-1.5 rounded border border-navy-border/50">
                  <span className="block text-[8px] text-slate-500">XMAX</span>
                  <span className="text-slate-200 font-bold">{selectedAnnotation.bbox[2]}</span>
                </div>
                <div className="bg-[#0c162b] p-1 py-1.5 rounded border border-navy-border/50">
                  <span className="block text-[8px] text-slate-500">YMAX</span>
                  <span className="text-slate-200 font-bold">{selectedAnnotation.bbox[3]}</span>
                </div>
              </div>
            </div>
          )}

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

    </div>
  );
};

export default Workspace;
