export function normalizeAddress(input: string): string {
  const raw = typeof input === 'string' ? input : '';
  if (!raw.trim()) return '';
  return raw
    .toLowerCase()
    .replace(/[.,;:!?'"`’“”()[\]{}<>\\/|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
