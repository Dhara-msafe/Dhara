/**
 * `aes-js` ships no TypeScript types. Minimal local declaration covering
 * only what DHARA's evidence-locker encryption (evidenceCrypto.ts) uses.
 */
declare module 'aes-js' {
  export class Counter {
    constructor(initialValue?: number | Uint8Array);
  }
  export namespace ModeOfOperation {
    class ctr {
      constructor(key: Uint8Array, counter?: Counter);
      encrypt(bytes: Uint8Array): Uint8Array;
      decrypt(bytes: Uint8Array): Uint8Array;
    }
  }
  export const utils: {
    hex: {
      fromBytes(bytes: Uint8Array): string;
      toBytes(hex: string): Uint8Array;
    };
    utf8: {
      fromBytes(bytes: Uint8Array): string;
      toBytes(str: string): Uint8Array;
    };
  };
}
