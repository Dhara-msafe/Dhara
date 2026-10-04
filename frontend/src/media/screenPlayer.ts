import { Platform } from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import { createBrowserTtsPlayer } from '../voice/browserPlayer';
import type { TtsPlayer } from '../voice/tts';

export function screenPlayer(uri: string, volume = 1, sharedAudio?: HTMLAudioElement): TtsPlayer {
  if (Platform.OS === 'web') {
    const audio = sharedAudio || new Audio();
    audio.volume = volume;
    return createBrowserTtsPlayer(audio, uri);
  }
  const player = createAudioPlayer({ uri });
  player.volume = volume;
  let finish: (() => void) | undefined;
  let begin: (() => void) | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStart: ((reason: Error) => void) | undefined;
  const subscription = player.addListener('playbackStatusUpdate', status => {
    if (disposed) return;
    if (status.isLoaded) begin?.();
    if (status.didJustFinish) finish?.();
  });
  return {
    play: () => new Promise<void>((resolve, reject) => {
      rejectStart = reject;
      begin = () => {
        begin = undefined;
        clearTimeout(timer);
        try { if (!disposed) player.play(); resolve(); } catch (error) { reject(error); }
      };
      timer = setTimeout(() => reject(new Error('Audio could not load. Please try again.')), 15000);
      if (player.isLoaded) begin();
    }),
    remove: () => { disposed = true; clearTimeout(timer); rejectStart?.(new Error('Playback stopped')); subscription.remove(); player.remove(); },
    onFinish: callback => { finish = callback; },
  };
}