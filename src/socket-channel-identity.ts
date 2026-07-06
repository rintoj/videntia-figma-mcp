// Two joins are the same Figma file only if they share a fileKey (Figma's unique
// per-file id), or, for unsaved files with no fileKey, an identical fileName.
// Never match a fileKey-identified entry against a fileName-only one — file
// names collide across distinct files (e.g. duplicated/templated project names).
export function isSameFile(
  a: { fileName?: string; fileKey?: string },
  b: { fileName?: string; fileKey?: string },
): boolean {
  if (a.fileKey || b.fileKey) return a.fileKey === b.fileKey;
  return !!a.fileName && a.fileName === b.fileName;
}
