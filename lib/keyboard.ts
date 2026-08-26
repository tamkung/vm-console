/**
 * Maps a physical keyboard code to its English layout ASCII keysym
 * if a modifier is held and the active keysym is a non-ASCII key (e.g. Thai character).
 */
export const getEnglishKeysym = (
  code: string,
  shiftKey: boolean
): number | null => {
  if (code.startsWith("Key")) {
    const char = code.substring(3);
    const finalChar = shiftKey ? char.toUpperCase() : char.toLowerCase();
    return finalChar.charCodeAt(0);
  }
  if (code.startsWith("Digit")) {
    const digit = code.substring(5);
    return digit.charCodeAt(0);
  }
  return null;
};
