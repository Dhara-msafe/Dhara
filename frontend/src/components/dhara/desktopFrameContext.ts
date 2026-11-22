import { createContext, useContext } from 'react';

/**
 * True for screens rendered inside the wide-web DesktopFrame (which always
 * shows the sidebar "SOS · Emergency", except on /emergency itself). Used by
 * UI_V22_ONE_SOS so a screen's own SOS pill steps aside there.
 */
export const InDesktopFrameContext = createContext(false);
export const useInDesktopFrame = () => useContext(InDesktopFrameContext);
