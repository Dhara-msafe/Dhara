// DHARA brand fonts — Fraunces (display serif) + Hind (body, with Devanagari
// support). Bundled locally so app boot never depends on a network fetch.
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
  });
