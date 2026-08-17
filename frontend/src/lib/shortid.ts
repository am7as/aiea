// Stable short-ID derivation for questions and exams.
//
//   Question:  {COURSE}-Q-{H|G}-{CC}-{XXXX}   e.g. SSY-Q-G-01-A4F2
//   Exam:      {COURSE}-E-{R|G}-{XXXX}        e.g. SSY-E-R-9B3D
//
// The XXXX block is a deterministic 4-hex digest of the row's UUID, so the
// short code is unique per record and reproducible across reloads — no DB
// column needed. Existing UUIDs stay the canonical id; the short code is a
// human-friendly display alias.

export type ShortIdInput = {
  /** Course code, e.g. "SSY300". Only A-Z digits are kept. */
  courseCode?: string | null;
  /** Row UUID — the source for the deterministic hex suffix. */
  uuid: string;
  /** Chapter id like "ch04" — only digits used for CC. */
  chapterId?: string | null;
  /** Question origin (`harvested` or `ai-generated` / `generated`). */
  origin?: string | null;
};

/** djb2 hash (deterministic, no crypto required). */
function djb2(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function hex4(uuid: string): string {
  // Use the first 4 hex chars of the UUID directly when possible — already
  // deterministic. Fall back to djb2 if the input looks non-hex.
  const cleaned = uuid.replace(/[^0-9a-f]/gi, "");
  const slice = cleaned.slice(0, 4).toUpperCase();
  if (/^[0-9A-F]{4}$/.test(slice)) return slice;
  return djb2(uuid).toString(16).slice(0, 4).toUpperCase();
}

function courseAbbr(code: string | null | undefined): string {
  const c = (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Strip the numeric tail (SSY300 → SSY).
  const m = c.match(/^([A-Z]+)/);
  return (m ? m[1] : c).slice(0, 4) || "AIE";
}

function chapterPair(chapterId: string | null | undefined): string {
  const m = (chapterId ?? "").match(/(\d+)/);
  if (!m) return "00";
  return m[1].padStart(2, "0").slice(-2);
}

function originLetter(origin: string | null | undefined, isExam = false): string {
  const o = (origin ?? "").toLowerCase();
  if (isExam) return o === "reference" ? "R" : "G";
  return o === "harvested" ? "H" : "G";
}

export function questionShortId(q: ShortIdInput): string {
  return [
    courseAbbr(q.courseCode),
    "Q",
    originLetter(q.origin),
    chapterPair(q.chapterId),
    hex4(q.uuid),
  ].join("-");
}

export function examShortId(
  e: Pick<ShortIdInput, "courseCode" | "uuid" | "origin">,
): string {
  return [
    courseAbbr(e.courseCode),
    "E",
    originLetter(e.origin, true),
    hex4(e.uuid),
  ].join("-");
}
