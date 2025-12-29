import React, { useEffect, useRef, useState, useMemo } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { useMidi } from '../hooks/useMidi';
import { MeasureContext } from '../types/piano';
import { extractMeasureContexts, calculateYForMidi, getPixelPerUnit, isDiatonic } from '../utils/osmdCoordinates';

interface ScoreDisplayProps {
  data: string;
  showAllLines?: boolean;
}

const ScoreDisplay: React.FC<ScoreDisplayProps> = ({ data, showAllLines = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [contexts, setContexts] = useState<MeasureContext[]>([]);
  const [ppu, setPpu] = useState<number>(10.0);
  const activeNotes = useMidi();

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
      } catch (err) {
        console.error("OSMD Update Error:", err);
      }
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
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
           handleResize();
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // MIDI入力に応じて音符の色をリアルタイムで更新
  useEffect(() => {
    if (contexts.length === 0) return;

    contexts.forEach(ctx => {
      ctx.noteDetails.forEach(detail => {
        const isActive = activeNotes.has(detail.midi);
        const color = isActive ? '#ff0000' : '#000000';
        
        // OSMD の GraphicalNote オブジェクトの setColor メソッドを呼び出す
        // これにより SVG 要素の色が直接書き換わる
        if (detail.graphicalNote && typeof detail.graphicalNote.setColor === 'function') {
          detail.graphicalNote.setColor(color);
        }
      });
    });
  }, [activeNotes, contexts]);

  // コンテキストごとに独立して表示判定を行う
  const renderLines = useMemo(() => {
    if (activeNotes.size === 0) return null;

    const lines: React.JSX.Element[] = [];

    contexts.forEach((ctx, i) => {
      // 判定範囲の決定
      let minLimit = -1;
      let maxLimit = 1000;

      if (ctx.minMidi !== null && ctx.maxMidi !== null) {
        // 音符がある場合: 音域 + マージン
        const margin = 2;
        minLimit = ctx.minMidi - margin;
        maxLimit = ctx.maxMidi + margin;
      } else {
        // 音符がない場合: 音部記号によるデフォルト範囲
        if (ctx.clefType === 'G') {
          minLimit = 55; // G3付近から上
        } else if (ctx.clefType === 'F') {
          maxLimit = 65; // F4付近から下
        }
      }

      Array.from(activeNotes).forEach(note => {
        // showAllLines が true の場合は範囲チェックをスキップ
        if (showAllLines || (note >= minLimit && note <= maxLimit)) {
          const y = calculateYForMidi(note, ctx, ppu);
          const diatonic = isDiatonic(note, ctx.keySig);
          const margin = 2;

          lines.push(
            <line
              key={`${ctx.systemId}-${ctx.measureNumber}-${ctx.staffId}-${note}`}
              x1={ctx.x + margin}
              y1={y}
              x2={ctx.x + ctx.width - margin}
              y2={y}
              stroke={diatonic ? "red" : "#2196f3"}
              strokeWidth="3"
              strokeDasharray={diatonic ? "none" : "4 2"}
              opacity="0.8"
            />
          );
        }
      });
    });

    return lines;
  }, [activeNotes, contexts, ppu, showAllLines]);

  return (
    <div style={{ position: 'relative', width: '100%', backgroundColor: '#fff' }}>
      <div ref={containerRef} style={{ width: '100%' }} />
      <svg
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          pointerEvents: 'none', overflow: 'visible'
        }}
      >
        {renderLines}
      </svg>
    </div>
  );
};

export default ScoreDisplay;