import React, { useEffect, useRef, useState, useMemo } from 'react';
import { OpenSheetMusicDisplay, PointF2D, TransposeCalculator } from 'opensheetmusicdisplay';
import { MeasureContext, NoteDetail, PlaybackTimeline, ScoreDrawingParameters, ScoreRangeDraft, ScoreRangeSelection, SelectionResult, StaffScope } from '../types/piano';
import { extractMeasureContexts, extractPlaybackTimeline, extractSourceNoteMidiMap, calculateYForMidi, getPixelPerUnit, isDiatonic, getMeasureAtPoint, getColumnKeyFromTimestamp, SourceNoteMidiMap } from '../utils/osmdCoordinates';
import { resolveNoteVisualState } from '../utils/noteVisualState';

interface ScoreDisplayProps {
  data: string;
  showAllLines?: boolean;
  showGuideLines?: boolean;
  showMidiMatchLines?: boolean;
  onSelectionChange?: (selection: SelectionResult | null, forcePlay: boolean) => void;
  onRangePreviewStart?: () => void;
  onRangeSelectionComplete?: (range: ScoreRangeSelection) => void;
  onTitleReady?: (title: string) => void;
  onLoadingStateChange?: (isLoading: boolean) => void;
  onPlaybackTimelineReady?: (timeline: PlaybackTimeline | null, error?: string, generation?: number) => void;
  onRangeProjectionInvalid?: () => void;
  activeNotes?: Set<number>;
  playbackColumnKey?: string | null;
  playbackActiveNoteKeys?: Set<string>;
  playbackRangeSelection?: ScoreRangeSelection | null;
  highlightBlackKeys?: boolean;
  visualTranspose?: number;
  scoreDrawingParameters?: ScoreDrawingParameters;
}

interface ColumnMatchCandidate {
  key: string;
  midiNotes: Set<number>;
  x: number;
  y1: number;
  y2: number;
}

interface OrderedColumn {
  columnKey: string;
  x: number;
  y1: number;
  y2: number;
  timestampValue: number | null;
}

interface ColumnHitResult {
  measure: MeasureContext;
  columnKey: string;
  x: number;
}

interface DragPoint {
  x: number;
  y: number;
}

interface RangeSpan {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OriginalSvgStyle {
  fillAttribute: string | null;
  strokeAttribute: string | null;
  fillStyle: string;
  strokeStyle: string;
}

const getColumnKeyTimestampValue = (columnKey: string): number | null => {
  const match = columnKey.match(/^(-?\d+):(-?\d+)\/(\d+)$/);
  if (!match) return null;

  const whole = Number(match[1]);
  const numerator = Number(match[2]);
  const denominator = Number(match[3]);
  if (!Number.isFinite(whole) || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return whole + numerator / denominator;
};

const getPlaybackNoteKey = (detail: NoteDetail): string => detail.noteIdentity;

const setsEqual = (left: Set<number>, right: Set<number>): boolean => {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
};

const getNoteHeadElement = (detail: NoteDetail): SVGElement | null => {
  const vf = detail.graphicalNote?.vfnote;
  const realVfNote = Array.isArray(vf) ? vf[0] : vf;
  const gveSvgGroup = realVfNote?.attrs?.el || realVfNote?.el;

  if (!(gveSvgGroup instanceof SVGElement)) return null;

  const noteGroup = gveSvgGroup.querySelector('.vf-note');
  if (!noteGroup) return null;

  const heads = Array.from(noteGroup.querySelectorAll('path, ellipse')).filter((el): el is SVGElement =>
    el instanceof SVGElement && !el.classList.contains('vf-stem')
  );

  return heads[detail.index] ?? null;
};

const getRelativeNoteHeadCenterX = (detail: NoteDetail, containerRect: DOMRect): number | null => {
  const head = getNoteHeadElement(detail);
  if (!head) return null;

  const rect = head.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  const left = rect.left - containerRect.left;
  const right = rect.right - containerRect.left;
  return (left + right) / 2;
};

const ScoreDisplay: React.FC<ScoreDisplayProps> = ({
  data,
  showAllLines = false,
  showGuideLines = true,
  showMidiMatchLines = false,
  onSelectionChange,
  onRangePreviewStart,
  onRangeSelectionComplete,
  onTitleReady,
  onLoadingStateChange,
  onPlaybackTimelineReady,
  onRangeProjectionInvalid,
  activeNotes = new Set(),
  playbackColumnKey = null,
  playbackActiveNoteKeys = new Set(),
  playbackRangeSelection = null,
  highlightBlackKeys = true,
  visualTranspose = 0,
  scoreDrawingParameters = 'compact'
}) => {
  const NOTE_SELECTION_THRESHOLD = 20;
  const DRAG_RANGE_THRESHOLD = 4;
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const lastLoadedDataRef = useRef<string | null>(null);
  const lastVisualTransposeRef = useRef<number>(visualTranspose);
  const lastScoreDrawingParametersRef = useRef<ScoreDrawingParameters>(scoreDrawingParameters);
  const [contexts, setContexts] = useState<MeasureContext[]>([]);
  const [ppu, setPpu] = useState<number>(10.0);
  const [hoveredMeasure, setHoveredMeasure] = useState<MeasureContext | null>(null);
  const [dragRange, setDragRange] = useState<ScoreRangeDraft | null>(null);
  const dragStartColumnRef = useRef<ColumnHitResult | null>(null);
  const lastDragColumnRef = useRef<ColumnHitResult | null>(null);
  const dragStartPointRef = useRef<DragPoint | null>(null);
  const lastDragPointRef = useRef<DragPoint | null>(null);
  const dragMovedRef = useRef(false);
  const rangePreviewStartedRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const sourceNoteMidiMapRef = useRef<SourceNoteMidiMap>(new Map());
  const originalSvgStyleRef = useRef<WeakMap<SVGElement, OriginalSvgStyle>>(new WeakMap());

  const playbackSelection = useMemo<SelectionResult | null>(() => {
    if (!playbackColumnKey || contexts.length === 0) return null;

    const measure = contexts.find((ctx) =>
      ctx.columnDetails.some((column) => column.columnKey === playbackColumnKey) ||
      ctx.noteDetails.some((detail) => detail.columnKey === playbackColumnKey)
    );
    if (!measure) return null;

    const relatedMeasures = contexts.filter((ctx) =>
      ctx.measureNumber === measure.measureNumber &&
      ctx.systemId === measure.systemId
    );
    const midiNotes = new Set<number>();
    const xValues: number[] = [];

    relatedMeasures.forEach((ctx) => {
      ctx.noteDetails.forEach((detail) => {
        if (detail.columnKey !== playbackColumnKey) return;
        midiNotes.add(detail.midi);
        xValues.push(detail.x);
      });
      ctx.columnDetails.forEach((column) => {
        if (column.columnKey === playbackColumnKey) xValues.push(column.x);
      });
    });

    if (midiNotes.size === 0) return null;

    return {
      measure,
      midiNotes,
      noteX: xValues.length > 0 ? xValues.reduce((sum, value) => sum + value, 0) / xValues.length : null,
      columnKey: playbackColumnKey,
    };
  }, [contexts, playbackColumnKey, visualTranspose]);

  const activeRange = dragRange ?? playbackRangeSelection;

  const orderedColumns = useMemo<OrderedColumn[]>(() => {
    const groupedColumns = new Map<string, { xValues: number[]; y1: number; y2: number }>();

    contexts.forEach((ctx) => {
      ctx.columnDetails.forEach((column) => {
        const existing = groupedColumns.get(column.columnKey);
        if (existing) {
          existing.xValues.push(column.x);
          existing.y1 = Math.min(existing.y1, ctx.y);
          existing.y2 = Math.max(existing.y2, ctx.y + ctx.height);
          return;
        }

        groupedColumns.set(column.columnKey, {
          xValues: [column.x],
          y1: ctx.y,
          y2: ctx.y + ctx.height
        });
      });
    });

    return Array.from(groupedColumns.entries())
      .map(([columnKey, column]) => ({
        columnKey,
        x: column.xValues.reduce((sum, value) => sum + value, 0) / column.xValues.length,
        y1: column.y1,
        y2: column.y2,
        timestampValue: getColumnKeyTimestampValue(columnKey)
      }))
      .sort((left, right) => {
        if (left.timestampValue !== null && right.timestampValue !== null && left.timestampValue !== right.timestampValue) {
          return left.timestampValue - right.timestampValue;
        }
        if (left.timestampValue !== null && right.timestampValue === null) return -1;
        if (left.timestampValue === null && right.timestampValue !== null) return 1;
        if (left.y1 !== right.y1) return left.y1 - right.y1;
        if (left.x !== right.x) return left.x - right.x;
        return left.columnKey.localeCompare(right.columnKey);
      });
  }, [contexts]);

  const columnIndexByKey = useMemo(() => {
    const indexMap = new Map<string, number>();
    orderedColumns.forEach((column, index) => indexMap.set(column.columnKey, index));
    return indexMap;
  }, [orderedColumns]);

  const getRangeColumnKeys = (startColumnKey: string, endColumnKey: string): string[] => {
    const startIndex = columnIndexByKey.get(startColumnKey);
    const endIndex = columnIndexByKey.get(endColumnKey);
    if (startIndex === undefined || endIndex === undefined) return [];

    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    return orderedColumns.slice(from, to + 1).map((column) => column.columnKey);
  };

  const getSelectedStaffScope = (
    startColumn: ColumnHitResult,
    endColumn: ColumnHitResult
  ): StaffScope => {
    const staffIds = Array.from(new Set(contexts.map((ctx) => ctx.staffId))).sort((left, right) => left - right);
    const startIndex = staffIds.indexOf(startColumn.measure.staffId);
    const endIndex = staffIds.indexOf(endColumn.measure.staffId);
    if (startIndex === -1 || endIndex === -1) {
      return { type: 'staffs', staffIds: [startColumn.measure.staffId] };
    }

    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    return { type: 'staffs', staffIds: staffIds.slice(from, to + 1) };
  };

  const rangeSpans = useMemo<RangeSpan[]>(() => {
    if (!activeRange) return [];
    const selectedKeys = new Set(activeRange.columnKeys);
    const selectedStaffIds = activeRange.staffScope.type === 'staffs'
      ? new Set(activeRange.staffScope.staffIds)
      : null;
    const firstColumnKey = activeRange.columnKeys[0];
    const lastColumnKey = activeRange.columnKeys[activeRange.columnKeys.length - 1];
    const groups = new Map<string, {
      measureNumber: number;
      systemId: number;
      staffId: number;
      measureX1: number;
      measureX2: number;
      y1: number;
      y2: number;
      columnXValues: Map<string, number[]>;
    }>();

    contexts.forEach((ctx) => {
      if (selectedStaffIds && !selectedStaffIds.has(ctx.staffId)) return;
      const selectedColumns = ctx.columnDetails.filter((column) => selectedKeys.has(column.columnKey));
      if (selectedColumns.length === 0) return;

      const key = `${ctx.systemId}:${ctx.measureNumber}:${ctx.staffId}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          measureNumber: ctx.measureNumber,
          systemId: ctx.systemId,
          staffId: ctx.staffId,
          measureX1: ctx.x,
          measureX2: ctx.x + ctx.width,
          y1: ctx.y,
          y2: ctx.y + ctx.height,
          columnXValues: new Map<string, number[]>(),
        };
        groups.set(key, group);
      } else {
        group.measureX1 = Math.min(group.measureX1, ctx.x);
        group.measureX2 = Math.max(group.measureX2, ctx.x + ctx.width);
        group.y1 = Math.min(group.y1, ctx.y);
        group.y2 = Math.max(group.y2, ctx.y + ctx.height);
      }

      selectedColumns.forEach((column) => {
        const values = group!.columnXValues.get(column.columnKey) ?? [];
        values.push(column.x);
        group!.columnXValues.set(column.columnKey, values);
      });
    });

    return Array.from(groups.values()).map((group) => {
      const columnX = new Map<string, number>();
      group.columnXValues.forEach((values, key) => {
        columnX.set(key, values.reduce((sum, value) => sum + value, 0) / values.length);
      });

      const xValues = Array.from(columnX.values());
      const firstX = firstColumnKey ? columnX.get(firstColumnKey) : undefined;
      const lastX = lastColumnKey ? columnX.get(lastColumnKey) : undefined;
      const rawX1 = firstX ?? group.measureX1;
      const rawX2 = lastX ?? group.measureX2;
      const x1 = Math.max(group.measureX1, Math.min(rawX1, rawX2) - 6);
      const x2 = Math.min(group.measureX2, Math.max(rawX1, rawX2) + 6);
      const fallbackX1 = Math.max(group.measureX1, Math.min(...xValues) - 6);
      const fallbackX2 = Math.min(group.measureX2, Math.max(...xValues) + 6);
      const left = Number.isFinite(x1) ? x1 : fallbackX1;
      const right = Number.isFinite(x2) ? x2 : fallbackX2;

      return {
        key: `range-${group.systemId}-${group.measureNumber}-${group.staffId}`,
        x: left,
        y: group.y1,
        width: Math.max(8, right - left),
        height: group.y2 - group.y1,
      };
    });
  }, [activeRange, contexts]);

  useEffect(() => {
    if (!playbackRangeSelection || dragRange || rangeSpans.length > 0) return;
    onRangeProjectionInvalid?.();
  }, [dragRange, onRangeProjectionInvalid, playbackRangeSelection, rangeSpans.length]);

  const getTimestampKeyAtClientPoint = (clientX: number, clientY: number): string | null => {
    const graphicSheet = osmdRef.current?.GraphicSheet as any;
    if (!graphicSheet?.domToSvg || !graphicSheet?.svgToOsmd || !graphicSheet?.tryGetTimestampFromPosition) {
      return null;
    }

    try {
      const domPoint = new PointF2D(clientX, clientY);
      const svgPoint = graphicSheet.domToSvg(domPoint);
      const osmdPoint = graphicSheet.svgToOsmd(svgPoint);
      const timestamp = graphicSheet.tryGetTimestampFromPosition(osmdPoint);
      return timestamp ? getColumnKeyFromTimestamp(timestamp) : null;
    } catch (err) {
      console.debug('OSMD timestamp hit-test failed:', err);
      return null;
    }
  };

  const getColumnAtPoint = (
    x: number,
    y: number,
    clientX: number,
    clientY: number,
    requireThreshold: boolean
  ): ColumnHitResult | null => {
    const clickedMeasure = getMeasureAtPoint(x, y, contexts);

    if (!clickedMeasure) return null;

    let closestX: number | null = null;
    const relatedMeasures = contexts.filter(ctx => ctx.measureNumber === clickedMeasure.measureNumber && ctx.systemId === clickedMeasure.systemId);
    const columnMap = new Map<string, number>();

    relatedMeasures.forEach(m => {
      m.columnDetails.forEach(column => {
        if (!columnMap.has(column.columnKey)) columnMap.set(column.columnKey, column.x);
      });
    });

    let minDistance = Infinity;
    let closestColumnKey = getTimestampKeyAtClientPoint(clientX, clientY);
    if (closestColumnKey !== null) closestX = columnMap.get(closestColumnKey) ?? null;

    if (closestColumnKey !== null && closestX !== null) {
      minDistance = 0;
    } else {
      columnMap.forEach((columnX, columnKey) => {
        const dist = Math.abs(columnX - x);
        if (dist < minDistance) {
          minDistance = dist;
          closestX = columnX;
          closestColumnKey = columnKey;
        }
      });
    }

    if (
      closestColumnKey === null ||
      closestX === null ||
      (requireThreshold && minDistance >= NOTE_SELECTION_THRESHOLD)
    ) {
      return null;
    }

    return {
      measure: clickedMeasure,
      columnKey: closestColumnKey,
      x: closestX
    };
  };

  const getSelectionForColumn = (hit: ColumnHitResult | null): SelectionResult | null => {
    if (!hit) return null;

    const targetMidiNotes = new Set<number>();
    const relatedMeasures = contexts.filter(ctx => ctx.measureNumber === hit.measure.measureNumber && ctx.systemId === hit.measure.systemId);

    relatedMeasures.forEach(m => {
      m.noteDetails.forEach(note => {
        if (note.columnKey === hit.columnKey) {
          targetMidiNotes.add(note.midi);
        }
      });
    });

    if (targetMidiNotes.size === 0) return null;

    return {
      measure: hit.measure,
      midiNotes: targetMidiNotes,
      noteX: hit.x,
      columnKey: hit.columnKey
    };
  };

  const getSelectionAtPoint = (
    x: number,
    y: number,
    clientX: number,
    clientY: number,
    requireThreshold: boolean
  ): SelectionResult | null => {
    return getSelectionForColumn(getColumnAtPoint(x, y, clientX, clientY, requireThreshold));
  };

  const updateSelectionAtPoint = (x: number, y: number, clientX: number, clientY: number, forcePlay: boolean) => {
    if (!onSelectionChange) return;
    onSelectionChange(getSelectionAtPoint(x, y, clientX, clientY, true), forcePlay);
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !containerRef.current || contexts.length === 0) return;
    event.stopPropagation();

    const rect = containerRef.current.getBoundingClientRect();
    const columnAtStart = getColumnAtPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      event.clientX,
      event.clientY,
      false
    );
    dragStartColumnRef.current = columnAtStart;
    lastDragColumnRef.current = columnAtStart;
    dragStartPointRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    lastDragPointRef.current = dragStartPointRef.current;
    dragMovedRef.current = false;
    rangePreviewStartedRef.current = false;
    setDragRange(null);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || contexts.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Update hover state
    const measure = getMeasureAtPoint(x, y, contexts);
    if (measure !== hoveredMeasure) setHoveredMeasure(measure);

    if (event.buttons === 1 && dragStartColumnRef.current?.columnKey) {
      const startColumn = dragStartColumnRef.current;
      const startPoint = dragStartPointRef.current ?? { x, y };
      const currentPoint = { x, y };
      const hasMovedEnough =
        Math.abs(currentPoint.x - startPoint.x) >= DRAG_RANGE_THRESHOLD ||
        Math.abs(currentPoint.y - startPoint.y) >= DRAG_RANGE_THRESHOLD;
      if (!hasMovedEnough) return;

      const currentColumn = getColumnAtPoint(x, y, event.clientX, event.clientY, false);
      const endColumn = currentColumn ?? lastDragColumnRef.current ?? startColumn;
      const startColumnKey = startColumn.columnKey;
      const rangeColumnKeys = getRangeColumnKeys(startColumnKey, endColumn.columnKey);
      const nextColumnKeys = rangeColumnKeys.length > 0 ? rangeColumnKeys : [startColumnKey];

      if (currentColumn?.columnKey) {
        lastDragColumnRef.current = currentColumn;
      }
      lastDragPointRef.current = currentPoint;
      dragMovedRef.current = true;
      if (!rangePreviewStartedRef.current) {
        rangePreviewStartedRef.current = true;
        onRangePreviewStart?.();
      }
      setDragRange({
        startColumnKey,
        endColumnKey: endColumn.columnKey,
        columnKeys: nextColumnKeys,
        staffScope: getSelectedStaffScope(
          startColumn,
          endColumn
        )
      });
    }
  };

  const handleMouseLeave = () => setHoveredMeasure(null);

  const handleMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startColumn = dragStartColumnRef.current;
    const endColumn = lastDragColumnRef.current;
    const startPoint = dragStartPointRef.current;
    const endPoint = lastDragPointRef.current;

    dragStartColumnRef.current = null;
    lastDragColumnRef.current = null;
    dragStartPointRef.current = null;
    lastDragPointRef.current = null;
    rangePreviewStartedRef.current = false;
    setDragRange(null);

    if (!startColumn?.columnKey || !endColumn?.columnKey || !startPoint || !endPoint) return;

    const isRangeGesture = dragMovedRef.current ||
      startColumn.columnKey !== endColumn.columnKey ||
      startColumn.measure.staffId !== endColumn.measure.staffId;
    dragMovedRef.current = false;
    if (!isRangeGesture) return;

    const rangeColumnKeys = getRangeColumnKeys(startColumn.columnKey, endColumn.columnKey);
    if (rangeColumnKeys.length === 0) return;

    const nextRange = {
      startColumnKey: startColumn.columnKey,
      endColumnKey: endColumn.columnKey,
      columnKeys: rangeColumnKeys,
      staffScope: getSelectedStaffScope(startColumn, endColumn)
    };

    suppressNextClickRef.current = true;
    onRangeSelectionComplete?.(nextRange);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation(); // App 側の onClick (resetSelection) が呼ばれないようにする
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (!containerRef.current || contexts.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    updateSelectionAtPoint(x, y, event.clientX, event.clientY, true); // クリック時は常に音を鳴らすため forcePlay = true
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
      drawingParameters: scoreDrawingParameters,
      // レンダリング高速化のための詳細設定
      drawLyrics: false,
      drawFingerings: false,
      drawSlurs: true,
      drawMeasureNumbers: true,
    });
    osmdRef.current = osmd;
  }, []);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || !data) return;
    
    // データも移調設定も変更がない場合はスキップ
    if (
      data === lastLoadedDataRef.current &&
      visualTranspose === lastVisualTransposeRef.current &&
      scoreDrawingParameters === lastScoreDrawingParametersRef.current
    ) {
      return;
    }

    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;

    const update = async () => {
      try {
        if (onLoadingStateChange) onLoadingStateChange(true);
        if (containerRef.current) containerRef.current.innerHTML = '';
        
        // メインスレッドを一旦解放してローディング表示を確実に出す
        await new Promise(resolve => setTimeout(resolve, 10));

        // Always reload data to ensure clean state for transposition
        await osmd.load(data);
        if (loadGenerationRef.current !== generation) return;
        const sourceNoteMidiMap = extractSourceNoteMidiMap(osmd);
        sourceNoteMidiMapRef.current = sourceNoteMidiMap;
        
        // レンダリングオプションの再適用
        osmd.setOptions({
          drawLyrics: false,
          drawFingerings: false,
          drawSlurs: true,
          drawingParameters: scoreDrawingParameters,
        });

        // Apply visual transpose
        if (visualTranspose !== 0) {
            if (!osmd.TransposeCalculator) {
                osmd.TransposeCalculator = new TransposeCalculator();
            }
            osmd.Sheet.Transpose = visualTranspose;
            osmd.updateGraphic(); 
        }

        osmd.render();
        if (loadGenerationRef.current !== generation) return;
        lastLoadedDataRef.current = data;
        lastVisualTransposeRef.current = visualTranspose;
        lastScoreDrawingParametersRef.current = scoreDrawingParameters;

        const pixelPerUnit = getPixelPerUnit(osmd, containerRef.current!);
        const ctxs = extractMeasureContexts(osmd, pixelPerUnit);
        setPpu(pixelPerUnit);
        setContexts(ctxs);
        setDragRange(null);

        if (onPlaybackTimelineReady) {
          try {
            onPlaybackTimelineReady(extractPlaybackTimeline(osmd, ctxs, sourceNoteMidiMap), undefined, generation);
          } catch (error) {
            console.error('Playback timeline extraction failed:', error);
            onPlaybackTimelineReady(null, 'Unable to prepare simple playback for this score.', generation);
          }
        }

        const title = osmd.Sheet?.TitleString;
        if (title && onTitleReady) {
          onTitleReady(title);
        }
      } catch (err) { 
        console.error("OSMD Update Error:", err); 
      } finally {
        if (loadGenerationRef.current === generation && onLoadingStateChange) onLoadingStateChange(false);
      }
    };
    update();
  }, [data, onTitleReady, onLoadingStateChange, onPlaybackTimelineReady, scoreDrawingParameters, visualTranspose]);

  useEffect(() => {
    if (!containerRef.current || !osmdRef.current) return;
    const handleResize = () => {
      const osmd = osmdRef.current;
      if (!osmd || !osmd.Sheet) return;
      osmd.render();
      const pixelPerUnit = getPixelPerUnit(osmd, containerRef.current!);
      const ctxs = extractMeasureContexts(osmd, pixelPerUnit);
      setPpu(pixelPerUnit);
      setContexts(ctxs);
      setDragRange(null);
      if (onPlaybackTimelineReady) {
        const generation = loadGenerationRef.current + 1;
        loadGenerationRef.current = generation;
        try {
          onPlaybackTimelineReady(extractPlaybackTimeline(osmd, ctxs, sourceNoteMidiMapRef.current), undefined, generation);
        } catch (error) {
          console.error('Playback timeline extraction failed after resize:', error);
          onPlaybackTimelineReady(null, 'Unable to prepare simple playback for this score.', generation);
        }
      }
    };
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) { if (entry.contentRect.width > 0) handleResize(); }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [onPlaybackTimelineReady, visualTranspose]);

  // Update note colors
  useEffect(() => {
    if (contexts.length === 0) return;

    const rememberOriginalStyle = (element: SVGElement) => {
      if (originalSvgStyleRef.current.has(element)) return;
      originalSvgStyleRef.current.set(element, {
        fillAttribute: element.getAttribute('fill'),
        strokeAttribute: element.getAttribute('stroke'),
        fillStyle: element.style.fill,
        strokeStyle: element.style.stroke,
      });
    };

    const restoreElement = (element: SVGElement) => {
      rememberOriginalStyle(element);
      const original = originalSvgStyleRef.current.get(element);
      if (!original) return;

      if (original.fillAttribute === null) element.removeAttribute('fill');
      else element.setAttribute('fill', original.fillAttribute);
      if (original.strokeAttribute === null) element.removeAttribute('stroke');
      else element.setAttribute('stroke', original.strokeAttribute);
      element.style.fill = original.fillStyle;
      element.style.stroke = original.strokeStyle;
    };

    const applyColor = (element: SVGElement, color: string) => {
      rememberOriginalStyle(element);
      element.setAttribute('fill', color);
      element.setAttribute('stroke', color);
      element.style.fill = color;
      element.style.stroke = color;
    };

    contexts.forEach((ctx) => {
      ctx.noteDetails.forEach((detail) => {
        const head = getNoteHeadElement(detail);
        if (!head) return;

        restoreElement(head);
        const midi = detail.midi;
        head.setAttribute('data-midi', String(midi));
        head.setAttribute('data-note-identity', getPlaybackNoteKey(detail));
        const visualState = resolveNoteVisualState({
          midi,
          keySig: ctx.keySig,
          highlightBlackKeys,
          isMidiActive: activeNotes.has(midi),
          isPlaybackActive: playbackActiveNoteKeys.has(getPlaybackNoteKey(detail)),
        });
        if (visualState.color) applyColor(head, visualState.color);
      });
    });
  }, [activeNotes, contexts, highlightBlackKeys, playbackActiveNoteKeys, visualTranspose]);

  const matchCandidates = useMemo<ColumnMatchCandidate[]>(() => {
    if (!showMidiMatchLines) return [];
    const container = containerRef.current;
    if (!container || contexts.length === 0) return [];

    const containerRect = container.getBoundingClientRect();
    const measureSpans = new Map<string, { y1: number; y2: number }>();
    const groups = new Map<string, {
      measureKey: string;
      midiNotes: Set<number>;
      xValues: number[];
    }>();

    contexts.forEach((ctx) => {
      const measureKey = `${ctx.systemId}:${ctx.measureNumber}`;
      const span = measureSpans.get(measureKey);
      const y1 = ctx.y;
      const y2 = ctx.y + ctx.height;

      if (span) {
        span.y1 = Math.min(span.y1, y1);
        span.y2 = Math.max(span.y2, y2);
      } else {
        measureSpans.set(measureKey, { y1, y2 });
      }
    });

    contexts.forEach((ctx) => {
      ctx.noteDetails.forEach((detail) => {
        const measureKey = `${ctx.systemId}:${ctx.measureNumber}`;
        const key = `${ctx.systemId}:${ctx.measureNumber}:${detail.columnKey}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            measureKey,
            midiNotes: new Set<number>(),
            xValues: []
          };
          groups.set(key, group);
        }

        group.midiNotes.add(detail.midi);

        const headCenterX = getRelativeNoteHeadCenterX(detail, containerRect);
        if (headCenterX !== null) {
          group.xValues.push(headCenterX);
          return;
        }

        group.xValues.push(detail.x);
      });
    });

    return Array.from(groups.entries()).flatMap(([key, group]) => {
      const span = measureSpans.get(group.measureKey);
      if (group.xValues.length === 0 || !span) {
        return [];
      }

      const x = group.xValues.reduce((sum, value) => sum + value, 0) / group.xValues.length;
      return [{
        key,
        midiNotes: group.midiNotes,
        x,
        y1: span.y1,
        y2: span.y2
      }];
    });
  }, [contexts, showMidiMatchLines, visualTranspose]);

  const matchingColumns = useMemo(() => {
    if (!showMidiMatchLines || activeNotes.size === 0) return [];
    return matchCandidates.filter((candidate) => setsEqual(candidate.midiNotes, activeNotes));
  }, [activeNotes, matchCandidates, showMidiMatchLines]);

  const renderLines = useMemo(() => {
    const lines: React.JSX.Element[] = [];
    rangeSpans.forEach((span) => {
      lines.push(
        <rect
          key={span.key}
          data-testid="score-range-overlay"
          x={span.x}
          y={span.y}
          width={span.width}
          height={span.height}
          fill="rgba(76, 175, 80, 0.12)"
          stroke="rgba(76, 175, 80, 0.7)"
          strokeWidth="1"
          pointerEvents="none"
        />
      );
    });

    matchingColumns.forEach((column) => {
      lines.push(
        <line
          key={`match-${column.key}`}
          x1={column.x}
          y1={column.y1}
          x2={column.x}
          y2={column.y2}
          stroke="red"
          strokeWidth="3"
          opacity="0.8"
        />
      );
    });
    
    // ガイドラインが無効の場合は線を描画しない
    if (showGuideLines && activeNotes.size > 0) {
      contexts.forEach((ctx) => {
        if (ctx.noteDetails.length === 0) return;

        let minLimit = -1, maxLimit = 1000;
        if (ctx.minMidi !== null && ctx.maxMidi !== null) { 
          minLimit = ctx.minMidi - 2;
          maxLimit = ctx.maxMidi + 2;
        }
        else { if (ctx.clefType === 'G') minLimit = 55; else if (ctx.clefType === 'F') maxLimit = 65; }
        
        Array.from(activeNotes).forEach(note => {
          if (showAllLines || (note >= minLimit && note <= maxLimit)) {
            const y = calculateYForMidi(note, ctx, ppu);
            const diatonic = isDiatonic(note, ctx.keySig, ctx.keyMode);
            lines.push(<line key={`l-${ctx.systemId}-${ctx.measureNumber}-${ctx.staffId}-${note}`} x1={ctx.x + 2} y1={y} x2={ctx.x + ctx.width - 2} y2={y} stroke={diatonic ? "red" : "#2196f3"} strokeWidth="3" strokeDasharray={diatonic ? "none" : "4 2"} opacity="0.8" />);
          }
        });
      });
    }
    return lines;
  }, [activeNotes, contexts, matchingColumns, ppu, rangeSpans, showAllLines, showGuideLines, visualTranspose]);

  return (
    <div 
      style={{ 
        position: 'relative', 
        width: '100%', 
        backgroundColor: '#fff', 
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none'
      }} 
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove} 
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave} 
      onClick={handleClick}
    >
      <div ref={containerRef} style={{ width: '100%' }} />
      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        {hoveredMeasure && <rect x={hoveredMeasure.x} y={hoveredMeasure.y} width={hoveredMeasure.width} height={hoveredMeasure.height} fill="rgba(25, 118, 210, 0.05)" stroke="rgba(25, 118, 210, 0.1)" strokeWidth="1" />} 
        {renderLines}
      </svg>
    </div>
  );
};

export default ScoreDisplay;
