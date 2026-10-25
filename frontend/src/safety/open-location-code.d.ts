// Minimal type declaration for open-location-code@1.0.3
// This package ships no TypeScript types; this stub satisfies the compiler.
declare module 'open-location-code' {
  export class OpenLocationCode {
    encode(latitude: number, longitude: number, codeLength?: number): string;
    decode(code: string): {
      latitudeCenter: number;
      longitudeCenter: number;
      latitudeLo: number;
      longitudeLo: number;
      latitudeHi: number;
      longitudeHi: number;
      codeLength: number;
    };
    isValid(code: string): boolean;
    isFull(code: string): boolean;
    isShort(code: string): boolean;
    shorten(code: string, latitude: number, longitude: number): string;
    recoverNearest(shortCode: string, latitude: number, longitude: number): string;
  }
}
