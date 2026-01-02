import React from 'react';
import { Dialog, DialogTitle, DialogContent, TextField, DialogActions, Button } from '@mui/material';

interface ScoreRenameDialogProps {
  open: boolean;
  onClose: () => void;
  newScoreName: string;
  setNewScoreName: (name: string) => void;
  onSave: () => void;
}

const ScoreRenameDialog: React.FC<ScoreRenameDialogProps> = ({
  open,
  onClose,
  newScoreName,
  setNewScoreName,
  onSave
}) => {
  return (
    <Dialog open={open} onClose={onClose}>
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
          onKeyDown={(e) => e.key === 'Enter' && onSave()}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onSave} variant="contained">Save</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ScoreRenameDialog;
