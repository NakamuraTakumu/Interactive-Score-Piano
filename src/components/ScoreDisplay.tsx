import React, { useEffect, useRef, useState, useMemo } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { useMidi } from '../hooks/useMidi';
import { MeasureContext } from '../types/piano';
import { extractMeasureContexts, calculateYForMidi, getPixelPerUnit, isDiatonic, getMeasureAtPoint } from '../utils/osmdCoordinates';

interface ScoreDisplayProps {
  data: string;
  showAllLines?: boolean;
  onMeasureClick?: (measure: MeasureContext, selectedMidiNotes: Set<number>, noteX: number | null, forcePlay: boolean) => void;
  onTitleReady?: (title: string) => void;
  onLoadingStateChange?: (isLoading: boolean) => void;
  selectedMeasureNumber?: number | null;
  selectedMidiNotes?: Set<number>;
  selectedNoteX?: number | null;
}

const ScoreDisplay: React.FC<ScoreDisplayProps> = ({
  data,
  showAllLines = false,
  onMeasureClick,
  onTitleReady,
  onLoadingStateChange,
  selectedMeasureNumber = null,
  selectedMidiNotes = new Set(),
  selectedNoteX = null
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const lastLoadedDataRef = useRef<string | null>(null);
  const [contexts, setContexts] = useState<MeasureContext[]>([]);
  const [ppu, setPpu] = useState<number>(10.0);
  const [hoveredMeasure, setHoveredMeasure] = useState<MeasureContext | null>(null);
  const activeNotes = useMidi();

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || contexts.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // ホバー状態の更新
    const measure = getMeasureAtPoint(x, y, contexts);
    if (measure !== hoveredMeasure) setHoveredMeasure(measure);

    // ドラッグ中（左ボタン押し下げ）であれば選択処理を実行
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
    }
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
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
    
    // データが実際に変更された場合のみ重い処理を実行
    if (data === lastLoadedDataRef.current) return;

    const update = async () => {
      try {
        if (onLoadingStateChange) onLoadingStateChange(true);
        if (containerRef.current) containerRef.current.innerHTML = '';
        
        // メインスレッドを一旦解放してローディング表示を確実に出す
        await new Promise(resolve => setTimeout(resolve, 10));

        await osmd.load(data);
        
        // レンダリングオプションの再適用（loadでリセットされる場合があるため）
        osmd.setOptions({
          drawLyrics: false,
          drawFingerings: false,
          drawSlurs: false,
        });

        osmd.render();
        lastLoadedDataRef.current = data;

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
  }, [data, onTitleReady, onLoadingStateChange]);

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

  // 音符の色を更新
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

        const defaultColor = isSelected ? '#4caf50' : '#000000';

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

          // 全ての音が弾かれているか判定
          const allActive = details.length > 0 && details.every((d: any) => activeNotes.has(d.midi));

          if (allActive) {
            // A. 全ての音が弾かれている場合：和音全体（符頭、ステム、連桁などすべて）を赤くする
            gveSvgGroup.querySelectorAll('path, ellipse').forEach(el => setCol(el as SVGElement, '#ff0000'));
          } else {
            // B. 一部の音だけが弾かれている、または何も弾かれていない場合
            // 1. まず全体をデフォルト色（黒または選択色の緑）にリセット
            gveSvgGroup.querySelectorAll('path, ellipse').forEach(el => setCol(el as SVGElement, defaultColor));

            // 2. 符頭要素（NoteHead）のみを特定して個別着色
            const noteGroup = gveSvgGroup.querySelector('.vf-note');
            if (noteGroup) {
              const heads = Array.from(noteGroup.querySelectorAll('path, ellipse')).filter(el => 
                !el.classList.contains('vf-stem')
              );

              details.forEach((detail: any) => {
                let color = defaultColor;
                if (activeNotes.has(detail.midi)) {
                  color = '#ff0000';
                } else if (isSelected && selectedMidiNotes.has(detail.midi)) {
                  color = '#4caf50';
                }

                if (color !== defaultColor && heads.length > detail.index) {
                  setCol(heads[detail.index] as SVGElement, color);
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