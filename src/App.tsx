import { useState, ChangeEvent, useEffect, useCallback, memo, useMemo } from 'react'
import { Box, Container, Typography, CssBaseline, ThemeProvider, createTheme, Paper, Stack, Button, IconButton, Tooltip, Slider, Switch, FormControlLabel, Select, MenuItem, FormControl, InputLabel, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Backdrop, CircularProgress } from '@mui/material'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ScoreDisplay from './components/ScoreDisplay'
import PianoKeyboard from './components/PianoKeyboard'
import { useMidi } from './hooks/useMidi'
import { usePianoSound } from './hooks/usePianoSound'
import { useWakeLock } from './hooks/useWakeLock'
import { MeasureContext } from './types/piano'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
  },
})

interface SavedScore {
  id: string;
  name: string;
  data: string;
  timestamp: number;
}

// Memoized ScoreDisplay to prevent unnecessary re-renders
const MemoizedScoreDisplay = memo(ScoreDisplay);

// Sample MusicXML for testing with complex key changes and chords
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




// Sample MusicXML with Clef Changes (Grand Staff)
const clefChangeSampleXML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <!-- Measure 1: Both G Clefs -->
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
    <!-- Measure 2: Bottom changes to F Clef -->
    <measure number="2">
      <attributes>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

function App() {
  const activeNotes = useMidi();
  const { isAudioStarted, startAudio, volume, setVolume, playNotes } = usePianoSound();
  const { keepAwake } = useWakeLock();
  
  // Keep screen awake when MIDI activity is detected
  useEffect(() => {
    if (activeNotes.size > 0) {
      keepAwake();
    }
  }, [activeNotes, keepAwake]);
  
  const [scoreLibrary, setScoreLibrary] = useState<SavedScore[]>(() => {
    const saved = localStorage.getItem('piano_score_library');
    return saved ? JSON.parse(saved) : [];
  });

  const [currentScoreId, setCurrentScoreId] = useState<string>(() => {
    return localStorage.getItem('piano_current_score_id') || 'sample';
  });

  const [scoreData, setScoreData] = useState<string>(() => {
    if (currentScoreId === 'sample') return sampleMusicXML;
    if (currentScoreId === 'clef-sample') return clefChangeSampleXML;
    const saved = localStorage.getItem('piano_score_library');
    if (saved) {
      const library: SavedScore[] = JSON.parse(saved);
      const current = library.find(s => s.id === currentScoreId);
      return current ? current.data : sampleMusicXML;
    }
    return sampleMusicXML;
  });

  // Derive fileName from library (resolve dual state management)
  const fileName = useMemo(() => {
    if (currentScoreId === 'sample') return 'Grand Staff Sample';
    if (currentScoreId === 'clef-sample') return 'Clef Change Sample';
    const current = scoreLibrary.find(s => s.id === currentScoreId);
    return current ? current.name : 'Grand Staff Sample';
  }, [currentScoreId, scoreLibrary]);
  
  const [showAllLines, setShowAllLines] = useState<boolean>(() => {
    const saved = localStorage.getItem('piano_show_all_lines');
    return saved === 'true';
  });

  const [showGuideLines, setShowGuideLines] = useState<boolean>(() => {
    const saved = localStorage.getItem('piano_show_guide_lines');
    return saved === null ? true : saved === 'true';
  });

  const [selectedMeasure, setSelectedMeasure] = useState<MeasureContext | null>(null);
  const [selectedMidiNotes, setSelectedMidiNotes] = useState<Set<number>>(new Set());
  const [selectedNoteX, setSelectedNoteX] = useState<number | null>(null);

  // Rename dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingScoreId, setEditingScoreId] = useState<string | null>(null);
  const [newScoreName, setNewScoreName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Save library and state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('piano_score_library', JSON.stringify(scoreLibrary));
      localStorage.setItem('piano_current_score_id', currentScoreId);
      localStorage.setItem('piano_show_all_lines', showAllLines.toString());
      localStorage.setItem('piano_show_guide_lines', showGuideLines.toString());
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e);
    }
  }, [scoreLibrary, currentScoreId, showAllLines, showGuideLines]);

  // Extract title from MusicXML
  const extractTitleFromXML = (xmlString: string, fallbackName: string): string => {
    try {
      if (!xmlString.includes('<?xml')) return fallbackName.replace(/\.[^/.]+$/, "");
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "text/xml");
      const workTitle = xmlDoc.getElementsByTagName("work-title")[0]?.textContent;
      const movementTitle = xmlDoc.getElementsByTagName("movement-title")[0]?.textContent;
      const creditText = xmlDoc.getElementsByTagName("credit-words")[0]?.textContent;
      return workTitle || movementTitle || creditText || fallbackName.replace(/\.[^/.]+$/, "");
    } catch (e) {
      return fallbackName.replace(/\.[^/.]+$/, "");
    }
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    const isMxl = file.name.toLowerCase().endsWith('.mxl');
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        const title = isMxl ? file.name.replace(/\.[^/.]+$/, "") : extractTitleFromXML(result, file.name);
        
        const newScore: SavedScore = {
          id: Math.random().toString(36).substr(2, 9),
          name: title,
          data: result,
          timestamp: Date.now()
        };

        try {
          setScoreLibrary(prev => [newScore, ...prev]);
          setScoreData(result);
          setCurrentScoreId(newScore.id);
          resetSelection();
        } catch (err) {
          alert('Storage is full. Please delete some scores.');
          setIsLoading(false);
        }
      }
    };

    if (isMxl) {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsText(file, 'UTF-8');
    }
  };

  const handleScoreChange = (id: string) => {
    if (id === currentScoreId) return;
    setIsLoading(true);
    if (id === 'sample') {
      setScoreData(sampleMusicXML);
      setCurrentScoreId('sample');
    } else if (id === 'clef-sample') {
      setScoreData(clefChangeSampleXML);
      setCurrentScoreId('clef-sample');
    } else {
      const score = scoreLibrary.find(s => s.id === id);
      if (score) {
        setScoreData(score.data);
        setCurrentScoreId(id);
      }
    }
    resetSelection();
  };

  const handleOpenEditDialog = (e: React.MouseEvent, score: SavedScore) => {
    e.stopPropagation();
    setEditingScoreId(score.id);
    setNewScoreName(score.name);
    setEditDialogOpen(true);
  };

  const handleSaveNewName = () => {
    if (editingScoreId && newScoreName.trim()) {
      setScoreLibrary(prev => {
        const next = prev.map(s => 
          s.id === editingScoreId ? { ...s, name: newScoreName.trim() } : s
        );
        return next;
      });
    }
    setEditDialogOpen(false);
  };

  const handleDeleteScore = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (id === 'sample' || id === 'clef-sample') return;
    
    const newLibrary = scoreLibrary.filter(s => s.id !== id);
    setScoreLibrary(newLibrary);
    
    if (currentScoreId === id) {
      handleScoreChange('sample');
    }
  };

  const resetSelection = () => {
    setSelectedMeasure(null);
    setSelectedMidiNotes(new Set());
    setSelectedNoteX(null);
  };

  const handleVolumeChange = (_event: Event, newValue: number | number[]) => {
    setVolume(newValue as number);
  };

  const handleMeasureClick = useCallback((measure: MeasureContext, midiNotes: Set<number>, noteX: number | null, forcePlay: boolean = false) => {
    // Check if selection changed
    const isDifferentX = noteX !== selectedNoteX;
    const isDifferentMidi = midiNotes.size !== selectedMidiNotes.size || 
                            Array.from(midiNotes).some(n => !selectedMidiNotes.has(n));
    
    const isNewSelection = isDifferentX || isDifferentMidi;

    if (isNewSelection || forcePlay) {
      setSelectedMeasure(measure);
      setSelectedMidiNotes(midiNotes);
      setSelectedNoteX(noteX);

      // Play sound
      if (midiNotes.size > 0) {
        playNotes(Array.from(midiNotes));
      }
    }
  }, [playNotes, selectedNoteX, selectedMidiNotes]);

  const handleTitleReady = useCallback((title: string) => {
    if (!title || title === "Untitled" || title === "Unknown") return;
    setScoreLibrary(prev => {
      const score = prev.find(s => s.id === currentScoreId);
      // Update if current name is default
      if (score && (score.name.includes('.') || score.name === 'Grand Staff Sample')) {
        if (score.name !== title) {
          return prev.map(s => s.id === currentScoreId ? { ...s, name: title } : s);
        }
      }
      return prev;
    });
  }, [currentScoreId]);

  const handleLoadingStateChange = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  // Initialize audio context on first interaction
  useEffect(() => {
    if (isAudioStarted) return;

    const initAudioOnFirstInteraction = () => {
      startAudio().then(() => {
        ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
          window.removeEventListener(event, initAudioOnFirstInteraction);
        });
      });
    };

    ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
      window.addEventListener(event, initAudioOnFirstInteraction, { once: true });
    });

    return () => {
      ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
        window.removeEventListener(event, initAudioOnFirstInteraction);
      });
    };
  }, [isAudioStarted, startAudio]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', pb: '140px' }}>
        <Container maxWidth="lg">
          <Box sx={{ my: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom align="center">
              Interactive Score Piano
            </Typography>
            <Stack spacing={2} sx={{ mb: 3 }}>
              <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
                <Box sx={{ width: 350 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="score-select-label">Score Library</InputLabel>
                    <Select
                      labelId="score-select-label"
                      value={currentScoreId}
                      label="Score Library"
                      onChange={(e) => handleScoreChange(e.target.value)}
                      sx={{ '& .MuiSelect-select': { display: 'flex', alignItems: 'center' } }}
                    >
                      <MenuItem value="sample">
                        <em>Sample: Grand Staff Sample</em>
                      </MenuItem>
                      <MenuItem value="clef-sample">
                        <em>Sample: Clef Change Sample</em>
                      </MenuItem>
                      {scoreLibrary.map((score) => (
                        <MenuItem key={score.id} value={score.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 }}>
                          <Typography variant="body2" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {score.name}
                          </Typography>
                          <Box sx={{ ml: 1, display: 'flex' }}>
                            <IconButton size="small" onClick={(e) => handleOpenEditDialog(e, score)} sx={{ mr: 0.5 }}>
                              <EditIcon fontSize="inherit" />
                            </IconButton>
                            <IconButton size="small" onClick={(e) => handleDeleteScore(e, score.id)}>
                              <DeleteIcon fontSize="inherit" />
                            </IconButton>
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
                
                <Stack direction="row" spacing={2} alignItems="center">
                  <FormControlLabel
                    sx={{ whiteSpace: 'nowrap' }}
                    control={<Switch checked={showAllLines} onChange={(e) => setShowAllLines(e.target.checked)} />}
                    label="Show all lines"
                  />
                  <FormControlLabel
                    sx={{ whiteSpace: 'nowrap' }}
                    control={<Switch checked={showGuideLines} onChange={(e) => setShowGuideLines(e.target.checked)} />}
                    label="Guide Lines"
                  />
                  <Box sx={{ width: 100, display: 'flex', alignItems: 'center' }}>
                    <VolumeUpIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />
                    <Slider 
                      size="small"
                      value={volume} 
                      onChange={handleVolumeChange} 
                      min={-60} 
                      max={10} 
                      onMouseDown={startAudio}
                    />
                  </Box>
                  <Tooltip title={isAudioStarted ? "Audio output enabled" : "Activate on interaction"}>
                    <Button 
                      size="small"
                      variant={isAudioStarted ? "outlined" : "contained"} 
                      color={isAudioStarted ? "success" : "warning"}
                      onClick={startAudio}
                      startIcon={isAudioStarted ? <VolumeUpIcon /> : <VolumeOffIcon />}
                      disabled={isAudioStarted}
                    >
                      {isAudioStarted ? "ON" : "OFF"}
                    </Button>
                  </Tooltip>
                  <Button size="small" variant="contained" component="label" startIcon={<CloudUploadIcon />}>
                    Open
                    <input type="file" hidden accept=".mxl,.xml,.musicxml" onChange={handleFileUpload} />
                  </Button>
                </Stack>
              </Paper>
            </Stack>
            <Paper elevation={3} sx={{ p: 2, minHeight: '600px', position: 'relative' }}>
              <MemoizedScoreDisplay 
                data={scoreData} 
                showAllLines={showAllLines} 
                showGuideLines={showGuideLines}
                onMeasureClick={handleMeasureClick}
                onTitleReady={handleTitleReady}
                onLoadingStateChange={handleLoadingStateChange}
                selectedMeasureNumber={selectedMeasure?.measureNumber}
                selectedMidiNotes={selectedMidiNotes}
                selectedNoteX={selectedNoteX}
              />
            </Paper>
          </Box>
        </Container>
        
        {/* Rename Dialog */}
        <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)}>
          <DialogTitle>Rename Score</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="New Name"
              type="text"
              fullWidth
              variant="standard"
              value={newScoreName}
              onChange={(e) => setNewScoreName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveNewName()}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveNewName} variant="contained">Save</Button>
          </DialogActions>
        </Dialog>

        {/* Loading Overlay */}
        <Backdrop
          sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1, position: 'absolute' }}
          open={isLoading}
        >
          <Stack alignItems="center" spacing={2}>
            <CircularProgress color="inherit" />
            <Typography variant="h6">Loading score...</Typography>
          </Stack>
        </Backdrop>

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
