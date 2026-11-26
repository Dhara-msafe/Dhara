import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { sizeClassFor, type SizeClass } from './sizeClass';

/** Current phone size class; updates on rotation, split-screen and fold. */
export function useSizeClass(): SizeClass & { windowWidth: number; windowHeight: number } {
  const { width, height } = useWindowDimensions();
  return useMemo(() => ({ ...sizeClassFor(width, height), windowWidth: width, windowHeight: height }), [width, height]);
}
