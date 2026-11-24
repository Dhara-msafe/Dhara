// 22 Nov (Vivek): Chat history and Saved answers are hidden tabs. Going "back"
// inside the tab navigator always lands on the first tab (Home), so their back
// arrow navigates to the screen that opened them instead. Callers pass
// ?from=me | settings | ask; anything else (e.g. opened from a link) goes to Me.
export function tabBackTarget(from?: string | string[]): string {
  const f = Array.isArray(from) ? from[0] : from;
  if (f === 'settings') return '/(tabs)/settings';
  if (f === 'ask') return '/(tabs)';
  return '/(tabs)/me';
}
