import { useState, ChangeEvent } from 'react'
import { Box, Container, Typography, CssBaseline, ThemeProvider, createTheme, Paper, Chip, Stack, Button, IconButton, Tooltip, Slider, Switch, FormControlLabel } from '@mui/material'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import ScoreDisplay from './components/ScoreDisplay'
import PianoKeyboard from './components/PianoKeyboard'
import { useMidi } from './hooks/useMidi'
import { usePianoSound } from './hooks/usePianoSound'
import { MeasureContext } from './types/piano'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
  },
})

// 複雑な調の変化と和音（Chord）を含むテスト用 MusicXML
const sampleMusicXML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <!-- Measure 1: C Major - Single Notes -->
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
      </note>
    </measure>
    <!-- Measure 2: G Major - Chord (G, B, D) -->
    <measure number="2">
      <attributes>
        <key><fifths>1</fifths></key>
      </attributes>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
    <!-- Measure 3: Eb Major - Chord (Eb, G, Bb) -->
    <measure number="3">
      <attributes>
        <key><fifths>-3</fifths></key>
      </attributes>
      <note>
        <pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
    <!-- Measure 4: F# Major - Chord (F#, A#, C#) -->
    <measure number="4">
      <attributes>
        <key><fifths>6</fifths></key>
      </attributes>
      <note>
        <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>A</step><alter>1</alter><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>C</step><alter>1</alter><octave>5</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
    <!-- Measure 5: C Major - Cluster -->
    <measure number="5">
      <attributes>
        <key><fifths>0</fifths></key>
      </attributes>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
      <note>
        <chord/>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

function App() {
  const activeNotes = useMidi();
  const { isAudioStarted, startAudio, volume, setVolume } = usePianoSound();
  const [scoreData, setScoreData] = useState<string>(sampleMusicXML);
  const [fileName, setFileName] = useState<string>('grand_staff_test.xml');
  const [showAllLines, setShowAllLines] = useState<boolean>(false);
  const [selectedMeasure, setSelectedMeasure] = useState<MeasureContext | null>(null);
  const [selectedMidiNotes, setSelectedMidiNotes] = useState<Set<number>>(new Set());
  const [selectedNoteX, setSelectedNoteX] = useState<number | null>(null);

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        setScoreData(result);
        setSelectedMeasure(null);
        setSelectedMidiNotes(new Set());
        setSelectedNoteX(null);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleVolumeChange = (_event: Event, newValue: number | number[]) => {
    setVolume(newValue as number);
  };

  const handleMeasureClick = (measure: MeasureContext, midiNotes: Set<number>, noteX: number | null) => {
    setSelectedMeasure(measure);
    setSelectedMidiNotes(midiNotes);
    setSelectedNoteX(noteX);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', pb: '140px' }}>
        <Container maxWidth="lg">
          <Box sx={{ my: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom align="center">
              Gemini Piano Practice
            </Typography>
            <Stack spacing={2} sx={{ mb: 3 }}>
              <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="subtitle1">現在のファイル: <strong>{fileName}</strong></Typography>
                </Box>
                <Stack direction="row" spacing={2} alignItems="center">
                  <FormControlLabel
                    sx={{ mr: 2, whiteSpace: 'nowrap' }}
                    control={<Switch checked={showAllLines} onChange={(e) => setShowAllLines(e.target.checked)} />}
                    label="補助線すべて"
                  />
                  <Box sx={{ width: 120, display: 'flex', alignItems: 'center', mr: 2 }}>
                    <VolumeUpIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />
                    <Slider 
                      size="small"
                      aria-label="Volume" 
                      value={volume} 
                      onChange={handleVolumeChange} 
                      min={-60} 
                      max={10} 
                      disabled={!isAudioStarted}
                    />
                  </Box>
                  <Tooltip title={isAudioStarted ? "音声出力有効" : "クリックして音声を有効化"}>
                    <Button 
                      size="small"
                      variant={isAudioStarted ? "outlined" : "contained"} 
                      color={isAudioStarted ? "success" : "warning"}
                      onClick={startAudio}
                      startIcon={isAudioStarted ? <VolumeUpIcon /> : <VolumeOffIcon />}
                      disabled={isAudioStarted}
                    >
                      {isAudioStarted ? "Sound ON" : "Sound"}
                    </Button>
                  </Tooltip>
                  <Button size="small" variant="contained" component="label" startIcon={<CloudUploadIcon />}>
                    Open
                    <input type="file" hidden accept=".mxl,.xml,.musicxml" onChange={handleFileUpload} />
                  </Button>
                </Stack>
              </Paper>
            </Stack>
            <Paper elevation={3} sx={{ p: 2, minHeight: '600px' }}>
              <ScoreDisplay 
                data={scoreData} 
                showAllLines={showAllLines} 
                onMeasureClick={handleMeasureClick}
                selectedMeasureNumber={selectedMeasure?.measureNumber}
                selectedMidiNotes={selectedMidiNotes}
                selectedNoteX={selectedNoteX}
              />
            </Paper>
          </Box>
        </Container>
        
        <Box sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100 }}>
          <PianoKeyboard 
            activeNotes={activeNotes} 
            highlightNotes={selectedMidiNotes}
            keySig={selectedMeasure?.keySig}
          />
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App;