import { useState, ChangeEvent } from 'react'
import { Box, Container, Typography, CssBaseline, ThemeProvider, createTheme, Paper, Chip, Stack, Button, IconButton, Tooltip, Slider, Switch, FormControlLabel } from '@mui/material'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import ScoreDisplay from './components/ScoreDisplay'
import { useMidi } from './hooks/useMidi'
import { usePianoSound } from './hooks/usePianoSound'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
  },
})

// 両方ト音記号 & 8va テスト用 MusicXML
const sampleMusicXML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type>
          <octave-shift type="down" size="8" number="1" default-y="20"/>
        </direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>whole</type>
        <staff>1</staff>
      </note>
      <direction>
        <direction-type>
          <octave-shift type="stop" size="8" number="1"/>
        </direction-type>
      </direction>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>5</voice>
        <type>whole</type>
        <staff>2</staff>
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

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') setScoreData(result);
    };
    reader.readAsBinaryString(file);
  };

  const handleVolumeChange = (_event: Event, newValue: number | number[]) => {
    setVolume(newValue as number);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
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
                <Box sx={{ width: 150, display: 'flex', alignItems: 'center', mr: 2 }}>
                  <VolumeUpIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  <Slider 
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
                    variant={isAudioStarted ? "outlined" : "contained"} 
                    color={isAudioStarted ? "success" : "warning"}
                    onClick={startAudio}
                    startIcon={isAudioStarted ? <VolumeUpIcon /> : <VolumeOffIcon />}
                    disabled={isAudioStarted}
                  >
                    {isAudioStarted ? "Sound ON" : "Enable Sound"}
                  </Button>
                </Tooltip>
                <Button variant="contained" component="label" startIcon={<CloudUploadIcon />}>
                  MXL / XML 読み込み
                  <input type="file" hidden accept=".mxl,.xml,.musicxml" onChange={handleFileUpload} />
                </Button>
              </Stack>
            </Paper>
            <Paper sx={{ p: 2, bgcolor: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="subtitle2" color="textSecondary" gutterBottom>MIDI入力ステータス:</Typography>
                <Stack direction="row" spacing={1}>
                  {activeNotes.size === 0 ? (
                    <Typography variant="body2" color="textSecondary italic">鍵盤を弾いてください...</Typography>
                  ) : (
                    Array.from(activeNotes).sort((a, b) => a - b).map(note => (
                      <Chip key={note} label={`Note: ${note}`} color="primary" variant="outlined" />
                    ))
                  )}
                </Stack>
              </Box>
              <FormControlLabel
                control={<Switch checked={showAllLines} onChange={(e) => setShowAllLines(e.target.checked)} />}
                label="すべての補助線を表示"
              />
            </Paper>
          </Stack>
          <Paper elevation={3} sx={{ p: 2, minHeight: '600px' }}>
            <ScoreDisplay data={scoreData} showAllLines={showAllLines} />
          </Paper>
        </Box>
      </Container>
    </ThemeProvider>
  )
}

export default App;