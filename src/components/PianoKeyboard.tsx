import React from 'react';
import { Box } from '@mui/material';
import { isDiatonic } from '../utils/osmdCoordinates';

interface PianoKeyboardProps {
  activeNotes: Set<number>;
  highlightNotes?: Set<number>; // Green highlight for clicked notes
  keySig?: number | null; // 調
  minNote?: number; 
  maxNote?: number; 
}

const PianoKeyboard: React.FC<PianoKeyboardProps> = ({ 
  activeNotes, 
  highlightNotes = new Set(),
  keySig = null,
  minNote = 21, 
  maxNote = 108 
}) => {
  const whiteKeys: number[] = [];
  const blackKeys: number[] = [];

  const isBlackKey = (midi: number) => {
    const pc = midi % 12;
    return [1, 3, 6, 8, 10].includes(pc);
  };

  for (let i = minNote; i <= maxNote; i++) {
    if (isBlackKey(i)) blackKeys.push(i);
    else whiteKeys.push(i);
  }

  const whiteKeyIndexMap = new Map<number, number>();
  whiteKeys.forEach((note, index) => whiteKeyIndexMap.set(note, index));

  const whiteKeyWidth = 20;
  const whiteKeyHeight = 100;
  const blackKeyWidth = whiteKeyWidth * 0.65;
  const blackKeyHeight = whiteKeyHeight * 0.6;

  const totalWidth = whiteKeys.length * whiteKeyWidth;

  const getKeyColor = (note: number, isBlack: boolean) => {
    // Priority: 1. Active(Red) 2. Selected(Green) 3. Scale(Blue) 4. Normal
    if (activeNotes.has(note)) return '#ff5252'; 
    if (highlightNotes.has(note)) return '#4caf50'; // 選択された音（緑）
    
    const inScale = keySig !== null && isDiatonic(note, keySig);
    if (isBlack) {
      return inScale ? '#2196f3' : '#111111';
    } else {
      return inScale ? '#e3f2fd' : '#ffffff';
    }
  };

  return (
    <Box sx={{ 
      width: '100%', 
      overflowX: 'auto', 
      py: 2, 
      display: 'flex', 
      justifyContent: 'center',
      bgcolor: '#1a1a1a',
      borderTop: '3px solid #333'
    }}>
      <svg 
        width={totalWidth} 
        height={whiteKeyHeight} 
        viewBox={`0 0 ${totalWidth} ${whiteKeyHeight}`}
        style={{ userSelect: 'none', filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.5))' }}
      >
        {whiteKeys.map((note, i) => (
          <rect
            key={note}
            x={i * whiteKeyWidth}
            y={0}
            width={whiteKeyWidth - 1}
            height={whiteKeyHeight}
            fill={getKeyColor(note, false)}
            stroke="#ccc"
            strokeWidth="0.5"
            rx={1}
          />
        ))}

        {blackKeys.map((note) => {
          let prevWhite = note - 1;
          while (!whiteKeyIndexMap.has(prevWhite) && prevWhite > 0) prevWhite--;
          const whiteIdx = whiteKeyIndexMap.get(prevWhite) ?? 0;
          const x = (whiteIdx + 1) * whiteKeyWidth - (blackKeyWidth / 2);

          return (
            <rect
              key={note}
              x={x}
              y={0}
              width={blackKeyWidth}
              height={blackKeyHeight}
              fill={getKeyColor(note, true)}
              stroke={(keySig !== null && isDiatonic(note, keySig)) || highlightNotes.has(note) ? '#000' : '#000'}
              strokeWidth="1"
              rx={2}
            />
          );
        })}
      </svg>
    </Box>
  );
};

export default PianoKeyboard;