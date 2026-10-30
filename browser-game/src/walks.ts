// Walk-cycle sprite sheets made from the animated clips (art/tools/walk.py). Only clips
// that show the whole creature are used; the others keep their still image.
import walks from "./walks.json";

export interface WalkSheet { frames: number; cols: number; fw: number; fh: number; fps: number }

export const WALKS: Record<string, WalkSheet> = walks;

export function walkUrl(name: string): string {
  return `${import.meta.env.BASE_URL}walk/${name}.webp`;
}
