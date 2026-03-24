import { Container, Typography, Box } from '@mui/material';
import { TokensTable } from '../components/tokens/TokensTable';

export default function PersonalAccessTokensPage() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Access Tokens
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Personal access tokens allow scripts and CLI tools to authenticate with the API.
          Tokens are valid JWTs that work with any authenticated endpoint.
        </Typography>
      </Box>
      <TokensTable />
    </Container>
  );
}
