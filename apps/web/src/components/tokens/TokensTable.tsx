import { useState, useEffect } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Button,
  Box,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { Delete as DeleteIcon, Add as AddIcon } from '@mui/icons-material';
import { usePersonalAccessTokens } from '../../hooks/usePersonalAccessTokens';
import { CreateTokenDialog } from './CreateTokenDialog';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusChip(token: { isActive: boolean; revokedAt: string | null; expiresAt: string }) {
  if (token.revokedAt) {
    return <Chip label="Revoked" size="small" color="error" variant="outlined" />;
  }
  if (new Date(token.expiresAt) < new Date()) {
    return <Chip label="Expired" size="small" color="warning" variant="outlined" />;
  }
  return <Chip label="Active" size="small" color="success" variant="outlined" />;
}

export function TokensTable() {
  const {
    tokens,
    totalItems,
    page,
    pageSize,
    isLoading,
    error,
    fetchTokens,
    createToken,
    revokeToken,
  } = usePersonalAccessTokens();

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  useEffect(() => {
    fetchTokens({ page: 1, pageSize: 20 });
  }, [fetchTokens]);

  const handlePageChange = (_: unknown, newPage: number) => {
    fetchTokens({ page: newPage + 1, pageSize });
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    fetchTokens({ page: 1, pageSize: parseInt(event.target.value, 10) });
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setIsRevoking(true);
    try {
      await revokeToken(revokeTarget.id);
      setRevokeTarget(null);
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Access Tokens</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          Create Token
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : tokens.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          No access tokens yet. Create one to get started.
        </Typography>
      ) : (
        <>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell>Last Used</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {token.name}
                      </Typography>
                    </TableCell>
                    <TableCell>{getStatusChip(token)}</TableCell>
                    <TableCell>{formatDate(token.createdAt)}</TableCell>
                    <TableCell>{formatDate(token.expiresAt)}</TableCell>
                    <TableCell>
                      {token.lastUsedAt ? formatDate(token.lastUsedAt) : 'Never'}
                    </TableCell>
                    <TableCell align="right">
                      {token.isActive && (
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setRevokeTarget({ id: token.id, name: token.name })}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={totalItems}
            page={page - 1}
            onPageChange={handlePageChange}
            rowsPerPage={pageSize}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[10, 20, 50]}
          />
        </>
      )}

      <CreateTokenDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={createToken}
      />

      {/* Revoke confirmation dialog */}
      <Dialog open={!!revokeTarget} onClose={() => !isRevoking && setRevokeTarget(null)}>
        <DialogTitle>Revoke Token</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to revoke "{revokeTarget?.name}"? This action cannot be undone.
            Any scripts using this token will stop working.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)} disabled={isRevoking}>
            Cancel
          </Button>
          <Button onClick={handleRevoke} color="error" variant="contained" disabled={isRevoking}>
            {isRevoking ? 'Revoking...' : 'Revoke'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
