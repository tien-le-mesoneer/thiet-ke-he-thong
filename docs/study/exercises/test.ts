const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = BigInt(ALPHABET.length); // 62n

// MAX_ID must be a power of 2 for the "any odd PRIME is coprime" shortcut to hold.
const MAX_ID = 1n << 31n; // ~2.1 billion IDs
// PRIME must be odd and < MAX_ID. Keep it fixed/secret in your service.
const PRIME = 2_100_045_797n;
const PRIME_INVERSE = modInverse(PRIME, MAX_ID);

/** Sequential counter -> obfuscated, non-sequential public ID */
export function encode(sequentialId: bigint): string {
  if (sequentialId < 0n || sequentialId >= MAX_ID) {
    throw new Error("id out of range");
  }
  const obfuscated = (sequentialId * PRIME) % MAX_ID;
  return toBase62(obfuscated);
}

/** Public ID -> original sequential counter (only your app can do this) */
export function decode(publicId: string): bigint {
  const obfuscated = fromBase62(publicId);
  return (obfuscated * PRIME_INVERSE) % MAX_ID;
}

function toBase62(value: bigint): string {
  if (value === 0n) return ALPHABET[0];
  let v = value;
  let result = "";
  while (v > 0n) {
    const remainder = v % BASE;
    result = ALPHABET[Number(remainder)] + result;
    v /= BASE;
  }
  return result;
}

function fromBase62(s: string): bigint {
  let value = 0n;
  for (const c of s) {
    value = value * BASE + BigInt(ALPHABET.indexOf(c));
  }
  return value;
}

// Extended Euclidean algorithm to find modular inverse of a mod m
function modInverse(a: bigint, m: bigint): bigint {
  const [, s] = extendedGcd(a, m);
  return ((s % m) + m) % m;
}

/** Returns [gcd, s, t] such that a*s + b*t = gcd(a, b) */
function extendedGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) return [a, 1n, 0n];
  const [g, s1, t1] = extendedGcd(b, a % b);
  return [g, t1, s1 - (a / b) * t1];
}

// --- demo ---
for (let i = 1n; i <= 5n; i++) {
  const id = encode(i);
  console.log(`${i} -> ${id} -> decoded back: ${decode(id)}`);
}
console.log(`Mode inverse of PRIME: ${PRIME_INVERSE}`);
