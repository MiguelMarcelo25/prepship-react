/**
 * MarkupsContext
 * Manages per-carrier markup state and persistence
 */

import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import type { MarkupsMap, Markup, MarkupType } from '../types/markups';
import { API_BASE_URL, authHeaders } from '../api/config';

const MARKUP_STORAGE_KEY = 'prepship_rb_markups';
const API_BASE = API_BASE_URL;

export interface MarkupsContextValue {
  // State
  markups: MarkupsMap;
  loading: boolean;
  error: string | null;

  // Methods
  applyMarkup(basePrice: number, markup: Markup): number;
  saveMarkup(pidOrCarrier: number | string, type: MarkupType, value: number): Promise<void>;
  clearRateCache(): Promise<void>;
  refreshMarkups(): Promise<void>;
}

const MarkupsContext = createContext<MarkupsContextValue | null>(null);

export function MarkupsProvider({ children }: { children: React.ReactNode }) {
  const [markups, setMarkups] = useState<MarkupsMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const markupsRef = useRef<MarkupsMap>({});

  // Keep ref in sync
  useEffect(() => {
    markupsRef.current = markups;
  }, [markups]);

  // Load markups on mount
  useEffect(() => {
    loadMarkups();
  }, []);

  async function loadMarkups() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings/rbMarkups`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MarkupsMap = await res.json();
      setMarkups(data || {});
      // Sync to localStorage
      localStorage.setItem(MARKUP_STORAGE_KEY, JSON.stringify(data || {}));
      setError(null);
    } catch (err) {
      console.error('Failed to load markups:', err);
      // Fallback to localStorage
      try {
        const cached = localStorage.getItem(MARKUP_STORAGE_KEY);
        if (cached) {
          setMarkups(JSON.parse(cached));
        }
      } catch (parseErr) {
        console.error('Failed to parse cached markups:', parseErr);
      }
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const applyMarkup = useCallback((basePrice: number, markup: Markup): number => {
    if (!markup || !markup.value) return basePrice;
    return markup.type === 'pct'
      ? basePrice * (1 + markup.value / 100)
      : basePrice + markup.value;
  }, []);

  const clearRateCache = useCallback(async () => {
    const res = await fetch(`${API_BASE}/cache/clear-and-refetch`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ scope: 'all' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, []);

  const saveMarkup = useCallback(
    async (pidOrCarrier: number | string, type: MarkupType, value: number) => {
      const updated = { ...markupsRef.current, [pidOrCarrier]: { type, value } };
      markupsRef.current = updated;
      setMarkups(updated);

      try {
        localStorage.setItem(MARKUP_STORAGE_KEY, JSON.stringify(updated));
      } catch (storageError) {
        console.warn('Failed to cache markups locally:', storageError);
      }

      try {
        const res = await fetch(`${API_BASE}/settings/rbMarkups`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(updated),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setError(null);
      } catch (err) {
        console.error('Failed to save markup:', err);
        const nextError = err instanceof Error ? err.message : 'Failed to save markup';
        setError(nextError);
        throw err instanceof Error ? err : new Error(nextError);
      }
    },
    [],
  );

  const refreshMarkups = useCallback(() => loadMarkups(), []);

  const value: MarkupsContextValue = {
    markups,
    loading,
    error,
    applyMarkup,
    saveMarkup,
    clearRateCache,
    refreshMarkups
  };

  return (
    <MarkupsContext.Provider value={value}>
      {children}
    </MarkupsContext.Provider>
  );
}

export function useMarkups(): MarkupsContextValue {
  const ctx = React.useContext(MarkupsContext);
  if (!ctx) throw new Error('useMarkups called outside MarkupsProvider');
  return ctx;
}
