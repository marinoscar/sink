import { useState, useCallback } from 'react';
import type { PersonalAccessToken, PersonalAccessTokensResponse, CreateTokenResponse } from '../types';
import {
  getTokens as fetchTokensApi,
  createToken as createTokenApi,
  revokeToken as revokeTokenApi,
} from '../services/api';

interface UsePersonalAccessTokensResult {
  tokens: PersonalAccessToken[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  fetchTokens: (params?: { page?: number; pageSize?: number }) => Promise<void>;
  createToken: (name: string, expiresInHours: number) => Promise<CreateTokenResponse>;
  revokeToken: (id: string) => Promise<void>;
}

export function usePersonalAccessTokens(): UsePersonalAccessTokensResult {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = useCallback(
    async (params?: { page?: number; pageSize?: number }) => {
      setIsLoading(true);
      setError(null);
      try {
        const response: PersonalAccessTokensResponse = await fetchTokensApi(params);
        setTokens(response.items);
        setTotalItems(response.meta.totalItems);
        setPage(response.meta.page);
        setPageSize(response.meta.pageSize);
        setTotalPages(response.meta.totalPages);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch tokens';
        setError(message);
        setTokens([]);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const createToken = useCallback(
    async (name: string, expiresInHours: number): Promise<CreateTokenResponse> => {
      setError(null);
      try {
        const result = await createTokenApi(name, expiresInHours);
        // Refresh the list
        await fetchTokens({ page, pageSize });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create token';
        setError(message);
        throw err;
      }
    },
    [fetchTokens, page, pageSize],
  );

  const revokeToken = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await revokeTokenApi(id);
        // Refresh the list
        await fetchTokens({ page, pageSize });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to revoke token';
        setError(message);
        throw err;
      }
    },
    [fetchTokens, page, pageSize],
  );

  return {
    tokens,
    totalItems,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    fetchTokens,
    createToken,
    revokeToken,
  };
}
