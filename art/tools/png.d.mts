export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}
export function decodePng(buf: Uint8Array): Rgba;
export function encodePng(img: Rgba): Buffer;
export function blank(width: number, height: number): Rgba;
