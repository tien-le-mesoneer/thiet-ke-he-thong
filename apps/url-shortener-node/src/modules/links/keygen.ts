import Sqids from "sqids";
import { config } from "../../config.js";

// sqids gives a reversible, non-sequential, url-safe encoding of an integer.
// minLength pads short ids so early codes aren't 1-2 chars.
// A fixed shuffled alphabet (62 unique chars, strictly [0-9a-zA-Z]) makes
// codes non-guessable without needing a separate cipher, and keeps codes
// URL-safe with no encoding required.
const sqids = new Sqids({
  minLength: config.codeMinLength,
  alphabet: "trknZY97fO4DaEmPbyhdvl0QMWuX5TH3oeqC1pjciIzs68GLKRgAUB2xFwJVNS",
});

export function encode(id: number): string {
  return sqids.encode([id]);
}

export function decode(code: string): number {
  const nums = sqids.decode(code);
  if (nums.length !== 1) throw new Error(`invalid code: ${code}`);
  return nums[0]!;
}
