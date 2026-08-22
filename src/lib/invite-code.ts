// Excludes confusing chars: I, O, 0, 1
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateInviteCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
