import React, { ChangeEvent, useState } from 'react';
import {
  Box, Paper, Stack, Button, IconButton, Tooltip, Slider, Switch, FormControlLabel,
  Select, MenuItem, FormControl, InputLabel, Typography, CircularProgress, ListSubheader,
  Popover, Divider
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PianoIcon from '@mui/icons-material/Piano';
import SettingsIcon from '@mui/icons-material/Settings';
import TuneIcon from '@mui/icons-material/Tune';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import { SavedScore, PianoSettings } from '../types/piano';
import { MidiDevice } from '../hooks/useMidi';
import { GM_INSTRUMENTS } from '../data/gmInstruments';
import { SoundFontOption } from '../data/soundFonts';

interface ControlPanelProps {
  scoreLibrary: SavedScore[];
  currentScoreId: string;
  onScoreChange: (id: string) => void;
  onOpenEditDialog: (e: React.MouseEvent, score: SavedScore) => void;
  onDeleteScore: (e: React.MouseEvent, id: string) => void;
  settings: PianoSettings;
  updateSetting: <K extends keyof PianoSettings>(key: K, value: PianoSettings[K]) => void;
  isAudioStarted: boolean;
  onStartAudio: () => Promise<void>;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  soundFontOptions: SoundFontOption[];
  onSoundFontUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isSamplesLoaded: boolean;
  audioEngine: 'not-started' | 'worklet' | 'main-thread';
  availableMidiDevices: { id: string, name: string }[];
  selectedMidiDeviceId: string;
  onMidiDeviceChange: (id: string) => void;
  activeNotes?: Set<number>;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  scoreLibrary,
  currentScoreId,
  onScoreChange,
  onOpenEditDialog,
  onDeleteScore,
  settings,
  updateSetting,
  isAudioStarted,
  onStartAudio,
  onFileUpload,
  soundFontOptions,
  onSoundFontUpload,
  isSamplesLoaded,
  audioEngine,
  availableMidiDevices,
  selectedMidiDeviceId,
  onMidiDeviceChange,
  activeNotes = new Set()
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  
  // Local state for smooth slider interaction
  const [localSettings, setLocalSettings] = useState<PianoSettings>(settings);

  // Sync local settings when external settings change (e.g. initial load)
  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const groupedInstruments = React.useMemo(() => {
    const grouped = new Map<string, typeof GM_INSTRUMENTS>();
    GM_INSTRUMENTS.forEach((instrument) => {
      const existing = grouped.get(instrument.category) ?? [];
      existing.push(instrument);
      grouped.set(instrument.category, existing);
    });
    return Array.from(grouped.entries());
  }, []);

  const handleSliderChange = (key: keyof PianoSettings) => (_: Event, newValue: number | number[]) => {
    setLocalSettings(prev => ({ ...prev, [key]: newValue as number }));
  };

  const handleSliderCommit = (key: keyof PianoSettings) => (_: Event | React.SyntheticEvent, newValue: number | number[]) => {
    updateSetting(key, newValue as number);
  };

  const handleSettingsClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
    onStartAudio();
  };

  const handleSettingsClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);
  const id = open ? 'settings-popover' : undefined;

  return (
    <Stack spacing={2} sx={{ mb: 3 }} onClick={(e) => e.stopPropagation()}>
      <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexGrow: 1 }}>
          <Box sx={{ width: 300 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="score-select-label">Score Library</InputLabel>
              <Select
                labelId="score-select-label"
                value={currentScoreId}
                label="Score Library"
                onChange={(e) => onScoreChange(e.target.value)}
                renderValue={(selected) => {
                  if (selected === 'sample') return 'Sample: Grand Staff';
                  if (selected === 'clef-sample') return 'Sample: Clef Change';
                  const score = scoreLibrary.find(s => s.id === selected);
                  return score ? score.name : selected;
                }}
              >
                <MenuItem value="sample">
                  <Typography variant="body2">Sample: Grand Staff</Typography>
                </MenuItem>
                <MenuItem value="clef-sample">
                  <Typography variant="body2">Sample: Clef Change</Typography>
                </MenuItem>
                {scoreLibrary.map((score) => (
                  <MenuItem key={score.id} value={score.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 }}>
                    <Typography variant="body2" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {score.name}
                    </Typography>
                    <Box sx={{ ml: 1, display: 'flex' }}>
                      <IconButton size="small" onClick={(e) => onOpenEditDialog(e, score)} sx={{ mr: 0.5 }}><EditIcon fontSize="inherit" /></IconButton>
                      <IconButton size="small" onClick={(e) => onDeleteScore(e, score.id)}><DeleteIcon fontSize="inherit" /></IconButton>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Tooltip title="Settings & MIDI">
            <IconButton onClick={handleSettingsClick} color={open ? "primary" : "default"}>
              <TuneIcon />
            </IconButton>
          </Tooltip>

          {activeNotes.size > 0 && (
            <Box sx={{ ml: 1, px: 1.5, py: 0.5, bgcolor: 'action.hover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'primary.main' }}>
                MIDI: {Array.from(activeNotes).sort((a, b) => a - b).join(', ')}
              </Typography>
            </Box>
          )}
        </Box>
        
        <Stack direction="row" spacing={3} alignItems="center">
          <Box sx={{ width: 120, display: 'flex', alignItems: 'center' }}>
            <VolumeUpIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />
            <Slider 
              size="small"
              value={localSettings.volume} 
              onChange={handleSliderChange('volume')}
              onChangeCommitted={handleSliderCommit('volume')}
              min={-60} max={10} 
              onMouseDown={onStartAudio}
            />
          </Box>
          <Button 
            size="small"
            variant={isAudioStarted ? "outlined" : "contained"} 
            color={isAudioStarted ? "success" : "warning"}
            onClick={onStartAudio}
            startIcon={isAudioStarted ? <VolumeUpIcon /> : <VolumeOffIcon />}
            disabled={isAudioStarted}
          >
            {isAudioStarted ? "ON" : "OFF"}
          </Button>
          <Button size="small" variant="contained" component="label" startIcon={<CloudUploadIcon />}>
            Open
            <input type="file" hidden accept=".mxl,.xml,.musicxml" onChange={onFileUpload} />
          </Button>
        </Stack>
      </Paper>

      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={handleSettingsClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Paper sx={{ p: 3, width: 320 }}>
          <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SettingsIcon fontSize="small" /> Settings & MIDI
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          <Stack spacing={2.5}>
            {/* MIDI Input Section */}
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>MIDI Input Device</Typography>
              <FormControl fullWidth size="small">
                <Select
                  value={selectedMidiDeviceId}
                  onChange={(e) => onMidiDeviceChange(e.target.value)}
                >
                  <MenuItem value="all"><em>All MIDI Devices</em></MenuItem>
                  {availableMidiDevices.map((device) => (
                    <MenuItem key={device.id} value={device.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <KeyboardIcon fontSize="small" color="action" />
                        {device.name}
                      </Box>
                    </MenuItem>
                  ))}
                  {availableMidiDevices.length === 0 && (
                    <MenuItem disabled>No devices detected</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Box>

            {/* Instrument Section */}
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>SoundFont</Typography>
              <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                <Select
                  value={settings.selectedSoundFontId}
                  onChange={(e) => updateSetting('selectedSoundFontId', e.target.value)}
                  onOpen={onStartAudio}
                  renderValue={(selected) => {
                    const current = soundFontOptions.find((option) => option.id === selected);
                    return current ? current.name : String(selected);
                  }}
                >
                  <ListSubheader>Bundled</ListSubheader>
                  {soundFontOptions.filter((option) => option.source === 'bundled').map((option) => (
                    <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                  ))}
                  <ListSubheader>User</ListSubheader>
                  {soundFontOptions.filter((option) => option.source === 'user').map((option) => (
                    <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button size="small" variant="outlined" component="label">
                Add SF2
                <input type="file" hidden accept=".sf2" onChange={onSoundFontUpload} />
              </Button>
            </Box>

            {/* Instrument Section */}
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>Instrument (GeneralUser GS)</Typography>
              <FormControl fullWidth size="small">
                <Select
                  value={settings.gmProgram}
                  onChange={(e) => updateSetting('gmProgram', Number(e.target.value))}
                  onOpen={onStartAudio}
                  renderValue={(selected) => {
                    const current = GM_INSTRUMENTS.find((instrument) => instrument.program === selected);
                    return current ? `${current.program + 1}: ${current.name}` : String(selected);
                  }}
                >
                  {groupedInstruments.flatMap(([category, instruments]) => [
                    <ListSubheader key={`h-${category}`}>{category}</ListSubheader>,
                    ...instruments.map((instrument) => (
                      <MenuItem key={instrument.program} value={instrument.program} sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 3 }}>
                        <PianoIcon fontSize="small" /> {instrument.program + 1}: {instrument.name}
                      </MenuItem>
                    )),
                  ])}
                </Select>
              </FormControl>
              {!isSamplesLoaded && <CircularProgress size={14} sx={{ mt: 1 }} />}
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Audio Engine: {audioEngine}
              </Typography>
            </Box>

            <Divider />

            {/* Display Toggles */}
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <FormControlLabel
                control={<Switch size="small" checked={settings.showAllLines} onChange={(e) => updateSetting('showAllLines', e.target.checked)} />}
                label={<Typography variant="body2">All Lines</Typography>}
              />
              <FormControlLabel
                control={<Switch size="small" checked={settings.showGuideLines} onChange={(e) => updateSetting('showGuideLines', e.target.checked)} />}
                label={<Typography variant="body2">Guides</Typography>}
              />
              <FormControlLabel
                control={<Switch size="small" checked={settings.highlightBlackKeys} onChange={(e) => updateSetting('highlightBlackKeys', e.target.checked)} />}
                label={<Typography variant="body2" sx={{ fontWeight: 'medium' }}>Black Key Color</Typography>}
              />
            </Stack>

            <Divider />

            {/* Existing Advanced Settings */}
            <Box>
              <Typography variant="caption" color="text.secondary">Reverb (Hall Ambience)</Typography>
              <Slider 
                size="small" value={localSettings.reverb} 
                onChange={handleSliderChange('reverb')}
                onChangeCommitted={handleSliderCommit('reverb')}
                min={0} max={1} step={0.01}
                valueLabelDisplay="auto"
              />
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">Audio Transpose (Half-steps)</Typography>
              <Slider 
                size="small" value={localSettings.transpose} 
                onChange={handleSliderChange('transpose')}
                onChangeCommitted={handleSliderCommit('transpose')}
                min={-12} max={12} step={1}
                marks={[{value: 0, label: '0'}]}
                valueLabelDisplay="auto"
              />
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">Visual Transpose (Sheet Music)</Typography>
              <Slider 
                size="small" value={localSettings.visualTranspose} 
                onChange={handleSliderChange('visualTranspose')}
                onChangeCommitted={handleSliderCommit('visualTranspose')}
                min={-12} max={12} step={1}
                marks={[{value: 0, label: '0'}]}
                valueLabelDisplay="auto"
              />
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">Velocity Sensitivity</Typography>
              <Slider 
                size="small" value={localSettings.velocitySensitivity} 
                onChange={handleSliderChange('velocitySensitivity')}
                onChangeCommitted={handleSliderCommit('velocitySensitivity')}
                min={0} max={1} step={0.1}
                valueLabelDisplay="auto"
              />
            </Box>

            <FormControlLabel
              control={<Switch size="small" checked={settings.sustainEnabled} onChange={(e) => updateSetting('sustainEnabled', e.target.checked)} />}
              label={<Typography variant="body2">Always Sustain (Pedal ON)</Typography>}
            />
          </Stack>
        </Paper>
      </Popover>
    </Stack>
  );
};

export default ControlPanel;
