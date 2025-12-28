import React, { useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { useMidi } from '../hooks/useMidi';
import { MeasureContext } from '../types/piano';
import { extractMeasureContexts, calculateYForMidi, getPixelPerUnit, isDiatonic } from '../utils/osmdCoordinates';

interface ScoreDisplayProps {
  data: string;
}

const ScoreDisplay: React.FC<ScoreDisplayProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [contexts, setContexts] = useState<MeasureContext[]>([]);
  const [ppu, setPpu] = useState<number>(10.0);
  const activeNotes = useMidi();

  useEffect(() => {
    if (!containerRef.current) return;
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
    });
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

  return (
    <div style={{ position: 'relative', width: '100%', backgroundColor: '#fff' }}>
      <div ref={containerRef} style={{ width: '100%' }} />
      <svg
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          pointerEvents: 'none', overflow: 'visible'
        }}
      >
        {activeNotes.size > 0 && contexts.map((ctx, i) => (
          Array.from(activeNotes).map(note => {
            const y = calculateYForMidi(note, ctx, ppu);
            const isInScale = isDiatonic(note, ctx.keySig);
            
            // 小節を分離して見せるためのマージン (左右2pxずつ)
            const margin = 2;

            return (
              <line
                key={`${i}-${note}`}
                x1={ctx.x + margin}
                y1={y}
                x2={ctx.x + ctx.width - margin}
                y2={y}
                stroke={isInScale ? "red" : "#2196f3"} // 調内なら赤、臨時記号なら青
                strokeWidth="3"
                strokeDasharray={isInScale ? "none" : "4 2"} // 臨時記号なら点線
                opacity="0.8"
              />
            );
          })
        ))}
      </svg>
    </div>
  );
};

export default ScoreDisplay;