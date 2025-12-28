import { useState, ChangeEvent } from 'react'
import { Box, Container, Typography, CssBaseline, ThemeProvider, createTheme, Paper, Chip, Stack, Button } from '@mui/material'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import ScoreDisplay from './components/ScoreDisplay'
import { useMidi } from './hooks/useMidi'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
  },
})

const sampleMusicXML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes></measure>
    <measure number="2"><attributes><key><fifths>1</fifths></key></attributes></measure>
    <measure number="3"><attributes><key><fifths>2</fifths></key></attributes></measure>
    <measure number="4"><attributes><key><fifths>3</fifths></key></attributes></measure>
    <measure number="5"><attributes><key><fifths>4</fifths></key></attributes></measure>
    <measure number="6"><attributes><key><fifths>5</fifths></key></attributes></measure>
    <measure number="7"><attributes><key><fifths>6</fifths></key></attributes></measure>
    <measure number="8"><attributes><key><fifths>-1</fifths></key></attributes></measure>
    <measure number="9"><attributes><key><fifths>-2</fifths></key></attributes></measure>
    <measure number="10"><attributes><key><fifths>-3</fifths></key></attributes></measure>
    <measure number="11"><attributes><key><fifths>-4</fifths></key></attributes></measure>
    <measure number="12"><attributes><key><fifths>-5</fifths></key></attributes></measure>
  </part>
</score-partwise>`;

function App() {
  const activeNotes = useMidi();
  const [scoreData, setScoreData] = useState<string>(sampleMusicXML);
  const [fileName, setFileName] = useState<string>('12_keys_test.xml');

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
              <Button variant="contained" component="label" startIcon={<CloudUploadIcon />}>
                MXL / XML 読み込み
                <input type="file" hidden accept=".mxl,.xml,.musicxml" onChange={handleFileUpload} />
              </Button>
            </Paper>
            <Paper sx={{ p: 2, bgcolor: '#f5f5f5' }}>
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
            </Paper>
          </Stack>
          <Paper elevation={3} sx={{ p: 2, minHeight: '600px' }}>
            <ScoreDisplay data={scoreData} />
          </Paper>
        </Box>
      </Container>
    </ThemeProvider>
  )
}

export default App;