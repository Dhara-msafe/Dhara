import { useEffect, useState } from 'react';
import { safetyRoute, type RouteResult } from '../women/api';

export function useRightsCard(scenario: string, language: string) {
  const [result, setResult] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setResult(null);
    safetyRoute({ scenario_key: scenario, lang: language }).then(value => {
      if (!active) return;
      setResult(value); setLoading(false);
      if (!value) setError('Could not load the rights card. Check your connection and try again.');
    });
    return () => { active = false; };
  }, [scenario, language, attempt]);
  return { result, loading, error, retry: () => setAttempt(value => value + 1) };
}