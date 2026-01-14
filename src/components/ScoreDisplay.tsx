import React, { useEffect, useRef, useState, useMemo } from 'react';
import { OpenSheetMusicDisplay, TransposeCalculator } from 'opensheetmusicdisplay';
import { MeasureContext } from '../types/piano';
import { extractMeasureContexts, calculateYForMidi, getPixelPerUnit, isDiatonic, getMeasureAtPoint } from '../utils/osmdCoordinates';

interface ScoreDisplayProps {
  data: string;
  showAllLines?: boolean;
  showGuideLines?: boolean;
  onMeasureClick?: (measure: MeasureContext | null, selectedMidiNotes: Set<number>, noteX: number | null, forcePlay: boolean) => void;
  onTitleReady?: (title: string) => void;
  onLoadingStateChange?: (isLoading: boolean) => void;
  selectedMeasureNumber?: number | null;
  selectedMidiNotes?: Set<number>;
  selectedNoteX?: number | null;
  activeNotes?: Set<number>;
  highlightBlackKeys?: boolean;
  visualTranspose?: number;
}

const ScoreDisplay: React.FC<ScoreDisplayProps> = ({
  data,
  showAllLines = false,
  showGuideLines = true,
  onMeasureClick,
  onTitleReady,
  onLoadingStateChange,
  selectedMeasureNumber = null,
  selectedMidiNotes = new Set(),
  selectedNoteX = null,
  activeNotes = new Set(),
  highlightBlackKeys = true,
  visualTranspose = 0
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const lastLoadedDataRef = useRef<string | null>(null);
  const lastVisualTransposeRef = useRef<number>(visualTranspose);
  const [contexts, setContexts] = useState<MeasureContext[]>([]);
  const [ppu, setPpu] = useState<number>(10.0);
  const [hoveredMeasure, setHoveredMeasure] = useState<MeasureContext | null>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || contexts.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Update hover state
    const measure = getMeasureAtPoint(x, y, contexts);
    if (measure !== hoveredMeasure) setHoveredMeasure(measure);

    // Execute selection logic if dragging (left button down)
    if (event.buttons === 1 && onMeasureClick) {
      updateSelectionAtPoint(x, y, false); // 移動中は重複を避けるため forcePlay = false
    }
  };

  const handleMouseLeave = () => setHoveredMeasure(null);

  const updateSelectionAtPoint = (x: number, y: number, forcePlay: boolean) => {
    if (!onMeasureClick) return;
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
      
      // onMeasureClick に MIDIノート、X座標、および強制発音フラグを渡す
      onMeasureClick(clickedMeasure, targetMidiNotes, closestX, forcePlay);
    } else {
      // 楽譜外（小節外）をクリックした場合は選択解除を通知
      onMeasureClick(null, new Set(), null, false);
    }
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation(); // App 側の onClick (resetSelection) が呼ばれないようにする
    if (!containerRef.current || contexts.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    updateSelectionAtPoint(x, y, true); // クリック時は常に音を鳴らすため forcePlay = true
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
      drawingParameters: 'compacttight',
      // レンダリング高速化のための詳細設定
      drawLyrics: false,
      drawFingerings: false,
      drawSlurs: false,
      drawMeasureNumbers: true,
    });
    osmdRef.current = osmd;
  }, []);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || !data) return;
    
    // データも移調設定も変更がない場合はスキップ
    if (data === lastLoadedDataRef.current && visualTranspose === lastVisualTransposeRef.current) return;

    const update = async () => {
      try {
        if (onLoadingStateChange) onLoadingStateChange(true);
        if (containerRef.current) containerRef.current.innerHTML = '';
        
        // メインスレッドを一旦解放してローディング表示を確実に出す
        await new Promise(resolve => setTimeout(resolve, 10));

        // Always reload data to ensure clean state for transposition
        await osmd.load(data);
        
        // レンダリングオプションの再適用
        osmd.setOptions({
          drawLyrics: false,
          drawFingerings: false,
          drawSlurs: false,
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
        lastLoadedDataRef.current = data;
        lastVisualTransposeRef.current = visualTranspose;

        const pixelPerUnit = getPixelPerUnit(osmd, containerRef.current!);
        const ctxs = extractMeasureContexts(osmd, pixelPerUnit);
        setPpu(pixelPerUnit);
        setContexts(ctxs);

        const title = osmd.Sheet?.TitleString;
        if (title && onTitleReady) {
          onTitleReady(title);
        }
      } catch (err) { 
        console.error("OSMD Update Error:", err); 
      } finally {
        if (onLoadingStateChange) onLoadingStateChange(false);
      }
    };
    update();
  }, [data, onTitleReady, onLoadingStateChange, visualTranspose]);

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

  // Update note colors
  useEffect(() => {
    if (contexts.length === 0) return;
    
    contexts.forEach(ctx => {
      // GraphicalVoiceEntry (和音) ごとにグループ化
      const gveMap = new Map<any, any[]>();
      ctx.noteDetails.forEach((detail: any) => {
        const gve = detail.graphicalNote.parentVoiceEntry;
        if (!gveMap.has(gve)) gveMap.set(gve, []);
        gveMap.get(gve)!.push(detail);
      });

      gveMap.forEach((details, gve) => {
        const isSelected = selectedMeasureNumber === ctx.measureNumber && 
                           selectedNoteX !== null && 
                           details.some(d => Math.abs(d.x - selectedNoteX) < 1);

        // Calculate default color for the group (chord)
        let baseColor = isSelected ? '#4caf50' : '#000000';

        // 1. VexFlow の StaveNote オブジェクトを取得
        const vf = details[0]?.graphicalNote?.vfnote;
        if (!vf) return;
        const realVfNote = Array.isArray(vf) ? vf[0] : vf;

        // 2. SVG グループ要素を取得
        const gveSvgGroup = realVfNote.attrs?.el || realVfNote.el;

        if (gveSvgGroup instanceof SVGElement) {
          const setCol = (el: SVGElement, color: string) => {
            el.setAttribute('fill', color);
            el.setAttribute('stroke', color);
            el.style.fill = color;
            el.style.stroke = color;
          };

          const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

          // Determine if all notes are being played
          const allActive = details.length > 0 && details.every((d: any) => activeNotes.has(d.midi));

          if (allActive) {
            // A. 全ての音が弾かれている場合：和音全体を赤くする
            const color = '#ff0000';
            gveSvgGroup.querySelectorAll('path, ellipse').forEach(el => setCol(el as SVGElement, color));
          } else {
            // B. 個別の音または未演奏の状態
            // まず全体（符幹など）をベース色でリセット
            gveSvgGroup.querySelectorAll('path, ellipse').forEach(el => setCol(el as SVGElement, baseColor));

            // 符頭要素（NoteHead）を個別に着色
            const noteGroup = gveSvgGroup.querySelector('.vf-note');
            if (noteGroup) {
              const heads = Array.from(noteGroup.querySelectorAll('path, ellipse')).filter(el => 
                !el.classList.contains('vf-stem')
              );

              details.forEach((detail: any) => {
                let noteColor = baseColor;
                
                // --- Highlight Black Keys Logic ---
                if (highlightBlackKeys && !isSelected && isBlackKey(detail.midi)) {
                  // keySig >= 0 (Sharp/Natural) -> Orange (Right side of white key)
                  // keySig < 0 (Flat) -> Light Blue (Left side of white key)
                  noteColor = ctx.keySig >= 0 ? '#fb8c00' : '#03a9f4';
                }

                if (activeNotes.has(detail.midi)) {
                  noteColor = '#ff0000';
                } else if (isSelected && selectedMidiNotes.has(detail.midi)) {
                  noteColor = '#4caf50';
                }

                if (noteColor !== baseColor && heads.length > detail.index) {
                  setCol(heads[detail.index] as SVGElement, noteColor);
                }
              });
            }
          }
        }
      });
    });
  }, [activeNotes, contexts, selectedMeasureNumber, selectedNoteX, selectedMidiNotes]);

  const renderLines = useMemo(() => {
    const lines: React.JSX.Element[] = [];
    if (selectedMeasureNumber !== null) {
      contexts.filter(ctx => ctx.measureNumber === selectedMeasureNumber).forEach(ctx => {
        lines.push(<rect key={`sel-${ctx.systemId}-${ctx.measureNumber}-${ctx.staffId}`} x={ctx.x} y={ctx.y} width={ctx.width} height={ctx.height} fill="rgba(76, 175, 80, 0.05)" stroke="#4caf50" strokeWidth="1" pointerEvents="none" />);
      });
    }
    
    // ガイドラインが無効の場合は線を描画しない
    if (showGuideLines && activeNotes.size > 0) {
      contexts.forEach((ctx) => {
        let minLimit = -1, maxLimit = 1000;
        if (ctx.minMidi !== null && ctx.maxMidi !== null) { minLimit = ctx.minMidi - 2; maxLimit = ctx.maxMidi + 2; }
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
  }, [activeNotes, contexts, ppu, showAllLines, selectedMeasureNumber, showGuideLines]);

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
      onMouseMove={handleMouseMove} 
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