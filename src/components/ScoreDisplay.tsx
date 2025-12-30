import React, { useEffect, useRef, useState, useMemo } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { useMidi } from '../hooks/useMidi';
import { MeasureContext } from '../types/piano';
import { extractMeasureContexts, calculateYForMidi, getPixelPerUnit, isDiatonic, getMeasureAtPoint } from '../utils/osmdCoordinates';

interface ScoreDisplayProps {
  data: string;
  showAllLines?: boolean;
  onMeasureClick?: (measure: MeasureContext, selectedMidiNotes: Set<number>, noteX: number | null) => void;
  selectedMeasureNumber?: number | null;
  selectedMidiNotes?: Set<number>;
  selectedNoteX?: number | null;
}

const ScoreDisplay: React.FC<ScoreDisplayProps> = ({ 
  data, 
  showAllLines = false, 
  onMeasureClick,
  selectedMeasureNumber = null,
  selectedMidiNotes = new Set(),
  selectedNoteX = null
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [contexts, setContexts] = useState<MeasureContext[]>([]);
  const [ppu, setPpu] = useState<number>(10.0);
  const [hoveredMeasure, setHoveredMeasure] = useState<MeasureContext | null>(null);
  const activeNotes = useMidi();

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || contexts.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const measure = getMeasureAtPoint(x, y, contexts);
    if (measure !== hoveredMeasure) setHoveredMeasure(measure);
  };

  const handleMouseLeave = () => setHoveredMeasure(null);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || contexts.length === 0 || !onMeasureClick) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const clickedMeasure = getMeasureAtPoint(x, y, contexts);
    
    if (clickedMeasure) {
      const targetMidiNotes = new Set<number>();
      let closestX: number | null = null;
      const relatedMeasures = contexts.filter(ctx => ctx.measureNumber === clickedMeasure.measureNumber && ctx.systemId === clickedMeasure.systemId);

      let minDistance = Infinity;
      relatedMeasures.forEach(m => {
        m.noteDetails.forEach(note => {
          const dist = Math.abs(note.x - x);
          if (dist < minDistance) {
            minDistance = dist;
            closestX = note.x;
          }
        });
      });

      const threshold = 20;
      if (closestX !== null && minDistance < threshold) {
        relatedMeasures.forEach(m => {
          m.noteDetails.forEach((note: any) => {
            if (Math.abs(note.x - closestX!) < 1) targetMidiNotes.add(note.midi);
          });
        });
      } else closestX = null;
      
      onMeasureClick(clickedMeasure, targetMidiNotes, closestX);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
    });
    osmdRef.current = osmd;
  }, []);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || !data) return;
    const update = async () => {
      try {
        if (containerRef.current) containerRef.current.innerHTML = '';
        await osmd.load(data);
        osmd.render();
        const pixelPerUnit = getPixelPerUnit(osmd, containerRef.current!);
        const ctxs = extractMeasureContexts(osmd, pixelPerUnit);
        setPpu(pixelPerUnit);
        setContexts(ctxs);
      } catch (err) { console.error("OSMD Update Error:", err); }
    };
    update();
  }, [data]);

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
    };
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) { if (entry.contentRect.width > 0) handleResize(); }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // 音符の色を更新（シンプルな一括制御）
  useEffect(() => {
    if (contexts.length === 0) return;
    
    contexts.forEach(ctx => {
      ctx.noteDetails.forEach((detail: any) => {
        const gn = detail.graphicalNote;
        if (!gn || typeof gn.setColor !== 'function') return;

        let color = '#000000';
        if (activeNotes.has(detail.midi)) {
          color = '#ff0000';
        } else if (
          selectedMeasureNumber === ctx.measureNumber && 
          selectedNoteX !== null && 
          Math.abs(detail.x - selectedNoteX) < 1
        ) {
          color = '#4caf50';
        }

        gn.setColor(color);
      });
    });
  }, [activeNotes, contexts, selectedMeasureNumber, selectedNoteX]);

  const renderLines = useMemo(() => {
    const lines: React.JSX.Element[] = [];
    if (selectedMeasureNumber !== null) {
      contexts.filter(ctx => ctx.measureNumber === selectedMeasureNumber).forEach(ctx => {
        lines.push(<rect key={`sel-${ctx.systemId}-${ctx.measureNumber}-${ctx.staffId}`} x={ctx.x} y={ctx.y} width={ctx.width} height={ctx.height} fill="rgba(76, 175, 80, 0.05)" stroke="#4caf50" strokeWidth="1" pointerEvents="none" />);
      });
    }
    if (activeNotes.size > 0) {
      contexts.forEach((ctx) => {
        let minLimit = -1, maxLimit = 1000;
        if (ctx.minMidi !== null && ctx.maxMidi !== null) { minLimit = ctx.minMidi - 2; maxLimit = ctx.maxMidi + 2; }
        else { if (ctx.clefType === 'G') minLimit = 55; else if (ctx.clefType === 'F') maxLimit = 65; }
        Array.from(activeNotes).forEach(note => {
          if (showAllLines || (note >= minLimit && note <= maxLimit)) {
            const y = calculateYForMidi(note, ctx, ppu);
            const diatonic = isDiatonic(note, ctx.keySig);
            lines.push(<line key={`l-${ctx.systemId}-${ctx.measureNumber}-${ctx.staffId}-${note}`} x1={ctx.x + 2} y1={y} x2={ctx.x + ctx.width - 2} y2={y} stroke={diatonic ? "red" : "#2196f3"} strokeWidth="3" strokeDasharray={diatonic ? "none" : "4 2"} opacity="0.8" />);
          }
        });
      });
    }
    return lines;
  }, [activeNotes, contexts, ppu, showAllLines, selectedMeasureNumber]);

  return (
    <div style={{ position: 'relative', width: '100%', backgroundColor: '#fff', cursor: 'pointer' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick}>
      <div ref={containerRef} style={{ width: '100%' }} />
      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        {hoveredMeasure && <rect x={hoveredMeasure.x} y={hoveredMeasure.y} width={hoveredMeasure.width} height={hoveredMeasure.height} fill="rgba(25, 118, 210, 0.05)" stroke="rgba(25, 118, 210, 0.1)" strokeWidth="1" />}
        {renderLines}
      </svg>
    </div>
  );
};

export default ScoreDisplay;