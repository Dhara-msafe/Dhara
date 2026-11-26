// DHARA fonts. Redesign v3 (26 Nov 2026): Inter is the app's text face for
// titles and body; Fraunces is kept only for the "DHARA" wordmark. Hind stays
// bundled for screens that still name it. Inter has no Indian-script glyphs,
// so Hindi, Tamil etc. fall back to the phone's own Noto fonts.
// Bundled locally so app boot never depends on a network fetch.
// Usage: const [loaded] = useAppFonts();
import { useFonts } from "expo-font";

export const useAppFonts = (): readonly [boolean, Error | null] =>
  useFonts({
    Fraunces: require("../../assets/fonts/Fraunces-Regular.ttf"),
    FrauncesSemiBold: require("../../assets/fonts/Fraunces-SemiBold.ttf"),
    FrauncesBold: require("../../assets/fonts/Fraunces-Bold.ttf"),
    FrauncesBlack: require("../../assets/fonts/Fraunces-Black.ttf"),
    HindLight: require("../../assets/fonts/Hind-Light.ttf"),
    Hind: require("../../assets/fonts/Hind-Regular.ttf"),
    HindMedium: require("../../assets/fonts/Hind-Medium.ttf"),
    HindSemiBold: require("../../assets/fonts/Hind-SemiBold.ttf"),
    HindBold: require("../../assets/fonts/Hind-Bold.ttf"),
    Inter: require("../../assets/fonts/Inter_400Regular.ttf"),
    InterMedium: require("../../assets/fonts/Inter_500Medium.ttf"),
    InterSemiBold: require("../../assets/fonts/Inter_600SemiBold.ttf"),
    InterBold: require("../../assets/fonts/Inter_700Bold.ttf"),
    InterExtraBold: require("../../assets/fonts/Inter_800ExtraBold.ttf"),
  });
