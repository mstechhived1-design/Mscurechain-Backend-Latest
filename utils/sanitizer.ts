/**
 * Sanitizes patient names at the backend level.
 * Replaces placeholder strings with "Unnamed Patient".
 */
export const sanitizePatientName = (name: string | null | undefined): string => {
  if (!name) return "Unnamed Patient";
  
  const lowerName = name.trim().toLowerCase();
  const placeholders = [
    "debug",
    "unknown",
    "unknown patient",
    "unnamed",
    "unnamed patient",
    "placeholder",
    "test patient",
    "test"
  ];

  if (placeholders.includes(lowerName)) {
    return "Unnamed Patient";
  }

  return name;
};
