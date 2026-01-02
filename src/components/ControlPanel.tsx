import React, { ChangeEvent } from 'react';
import { 
  Box, Paper, Stack, Button, IconButton, Tooltip, Slider, Switch, FormControlLabel, 
  Select, MenuItem, FormControl, InputLabel, Typography 
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { SavedScore } from '../types/piano';

interface ControlPanelProps {
  scoreLibrary: SavedScore[];
  currentScoreId: string;
  onScoreChange: (id: string) => void;
  onOpenEditDialog: (e: React.MouseEvent, score: SavedScore) => void;
  onDeleteScore: (e: React.MouseEvent, id: string) => void;
  showAllLines: boolean;
  setShowAllLines: (show: boolean) => void;
  showGuideLines: boolean;
  setShowGuideLines: (show: boolean) => void;
  volume: number;
  onVolumeChange: (event: Event, newValue: number | number[]) => void;
  isAudioStarted: boolean;
  onStartAudio: () => void;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  scoreLibrary,
  currentScoreId,
  onScoreChange,
  onOpenEditDialog,
  onDeleteScore,
  showAllLines,
  setShowAllLines,
  showGuideLines,
  setShowGuideLines,
  volume,
  onVolumeChange,
  isAudioStarted,
  onStartAudio,
  onFileUpload
}) => {
  return (
    <Stack spacing={2} sx={{ mb: 3 }}>
      <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ width: 350 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="score-select-label">Score Library</InputLabel>
            <Select
              labelId="score-select-label"
              value={currentScoreId}
              label="Score Library"
              onChange={(e) => onScoreChange(e.target.value)}
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
                    <IconButton size="small" onClick={(e) => onOpenEditDialog(e, score)} sx={{ mr: 0.5 }}>
                      <EditIcon fontSize="inherit" />
                    </IconButton>
                    <IconButton size="small" onClick={(e) => onDeleteScore(e, score.id)}>
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
              onChange={onVolumeChange} 
              min={-60} 
              max={10} 
              onMouseDown={onStartAudio}
            />
          </Box>
          <Tooltip title={isAudioStarted ? "Audio output enabled" : "Activate on interaction"}>
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
          </Tooltip>
          <Button size="small" variant="contained" component="label" startIcon={<CloudUploadIcon />}>
            Open
            <input type="file" hidden accept=".mxl,.xml,.musicxml" onChange={onFileUpload} />
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
};

export default ControlPanel;
