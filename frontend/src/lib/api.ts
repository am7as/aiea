function resolveBase(): string {
  if (typeof window === "undefined") {
    return (
      process.env.API_URL_INTERNAL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://api:8000"
    );
  }
  const env = process.env.NEXT_PUBLIC_API_URL;
  const host = window.location.hostname;
  if (env) {
    try {
      const url = new URL(env);
      if (url.hostname === "localhost" && host !== "localhost") {
        url.hostname = host;
        return url.toString().replace(/\/$/, "");
      }
      return env;
    } catch {
      return env;
    }
  }
  return `${window.location.protocol}//${host}:4021`;
}

/** Browser URL of a material's cropped extraction figure. Same-origin relative
 *  (proxied to the API by a Next rewrite) so it's hydration-safe in the DOM. */
export function materialFigureUrl(materialId: string, name: string, method = "ai"): string {
  return `/api/v1/materials/${materialId}/figures/${encodeURIComponent(name)}?method=${method}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

/** Pull a human-readable message out of a FastAPI error body.
 *
 * `detail` is a plain string for most errors, but endpoints that need to return
 * structure with the message (the validation gate returns the blocking findings
 * alongside it) send an object. Reading only the string case turned those into a
 * bare "409 Conflict", which tells the user nothing. */
function extractDetail(body: unknown, r: Response): string {
  const detail =
    body && typeof body === "object" && "detail" in body
      ? (body as { detail: unknown }).detail
      : undefined;
  if (typeof detail === "string" && detail) return detail;
  if (detail && typeof detail === "object") {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  // Pydantic validation errors arrive as a list of {loc, msg, type}.
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: unknown };
    if (typeof first?.msg === "string") return first.msg;
  }
  return `${r.status} ${r.statusText}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  const r = await fetch(`${resolveBase()}/api/v1${path}`, {
    cache: "no-store",
    ...init,
    headers,
  });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const body = text ? safeJson(text) : undefined;
  if (!r.ok) {
    throw new ApiError(r.status, extractDetail(body, r), body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export type Course = {
  id: string;
  code: string;
  title: string;
  description_md: string;
  topics: string[];
  language: string | null;
  materials_path: string | null;
  brain_path: string | null;
  library_path: string | null;
  workshop_path: string | null;
  created_at: string;
  materials_count: number;
  questions_count: number;
  exams_count: number;
};

export type CourseCreate = {
  code: string;
  title: string;
  description_md?: string;
  topics?: string[];
  language?: string | null;
  quick_parent?: string;
  materials_path?: string;
  brain_path?: string;
  library_path?: string;
  workshop_path?: string;
};

export type CourseUpdate = Partial<CourseCreate>;

export type Material = {
  id: string;
  course_id: string;
  collection: string;
  subpath: string;
  title: string;
  original_filename: string;
  pages: number | null;
  extraction_method: string | null;
  extraction_status: "pending" | "running" | "done" | "error";
  extraction_error: string | null;
  word_count: number | null;
  uploaded_at: string;
  versions: {
    method: string;
    status: "pending" | "running" | "done" | "error";
    is_final: boolean;
    eval_score: number | null;
  }[];
  comparison: { recommend?: string; reason?: string } | null;
};

export type ScanFileEntry = {
  collection: string;
  subpath: string;
  filename: string;
  size: number;
  suffix: string;
  material_id: string | null;
  extraction_status: Material["extraction_status"] | null;
  pages: number | null;
};

export type ScanCollection = { name: string; files: ScanFileEntry[] };

export type ScanResult = {
  materials_path: string;
  collections: ScanCollection[];
  total_files: number;
  registered: number;
  new_registered: number;
};

export async function scanCourse(courseId: string, autoIngest = false): Promise<ScanResult> {
  return api<ScanResult>(
    `/materials/scan?course_id=${encodeURIComponent(courseId)}&auto_ingest=${autoIngest}`,
    { method: "POST" },
  );
}

export async function ingestMaterial(materialId: string): Promise<void> {
  await api<{ status: string }>(`/materials/${materialId}/ingest`, { method: "POST" });
}

export type ContentsFile = {
  name: string;
  relpath: string;
  size: number;
  mtime: string;
  ext: string;
};

export type ContentsSection = {
  name: string;
  count: number;
  files: ContentsFile[];
};

export type RoleContents = {
  path: string | null;
  exists: boolean;
  sections: ContentsSection[];
};

export type CourseContents = {
  materials: RoleContents;
  brain: RoleContents;
  library: RoleContents;
  workshop: RoleContents;
};

export async function getCourseContents(courseId: string): Promise<CourseContents> {
  return api<CourseContents>(`/courses/${courseId}/contents`);
}

export async function updateCoursePaths(
  courseId: string,
  paths: { materials_path?: string; brain_path?: string; library_path?: string; workshop_path?: string },
  scaffold = true,
): Promise<Course> {
  return api<Course>(`/courses/${courseId}/paths`, {
    method: "PATCH",
    body: JSON.stringify({ ...paths, scaffold }),
  });
}

export type FsRoots = { roots: string[]; default: string };

export type FsEntry = { name: string; path?: string; size?: number };

export type FsListing = {
  path: string;
  parent: string | null;
  folders: { name: string; path: string }[];
  files: { name: string; size: number }[];
  file_count: number;
};

export async function fsRoots(): Promise<FsRoots> {
  return api<FsRoots>("/fs/roots");
}

export async function fsList(path: string, showHidden = false): Promise<FsListing> {
  return api<FsListing>(
    `/fs/list?path=${encodeURIComponent(path)}&show_hidden=${showHidden}`,
  );
}

export async function fsMkdir(path: string): Promise<{ path: string; created: boolean }> {
  return api<{ path: string; created: boolean }>("/fs/mkdir", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function bootstrapCourse(
  courseId: string,
  role?: "materials" | "brain" | "library" | "workshop",
): Promise<Course> {
  return api<Course>(`/courses/${courseId}/bootstrap`, {
    method: "POST",
    body: JSON.stringify(role ? { role } : {}),
  });
}

export async function setupCourseFromParent(
  courseId: string,
  parent: string,
  scaffold = true,
): Promise<Course> {
  return api<Course>(`/courses/${courseId}/setup-from-parent`, {
    method: "POST",
    body: JSON.stringify({ parent, scaffold }),
  });
}

export type ParentSubInfo = {
  path: string;
  exists: boolean;
  file_count?: number;
  subfolders?: string[];
};

export type ParentPreview = {
  parent: string;
  exists: boolean;
  subfolders: {
    materials: ParentSubInfo;
    brain: ParentSubInfo;
    library: ParentSubInfo;
    workshop: ParentSubInfo;
  };
};

export async function previewParent(path: string): Promise<ParentPreview> {
  return api<ParentPreview>(`/fs/preview-parent?path=${encodeURIComponent(path)}`);
}

export type DocsNode =
  | { name: string; path: string; type: "folder"; children: DocsNode[] }
  | { name: string; path: string; type: "file" };

export type DocsTree = { root: string; tree: DocsNode[] };

export async function fetchDocsTree(): Promise<DocsTree> {
  return api<DocsTree>("/docs/tree");
}

export async function fetchDocsFile(path: string): Promise<string> {
  const r = await fetch(
    `${resolveBase()}/api/v1/docs/file?path=${encodeURIComponent(path)}`,
    { cache: "no-store" },
  );
  if (!r.ok) {
    const text = await r.text();
    throw new ApiError(r.status, text || `${r.status} ${r.statusText}`);
  }
  return r.text();
}

export async function uploadMaterial(form: FormData): Promise<Material> {
  const r = await fetch(`${resolveBase()}/api/v1/materials/`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  const text = await r.text();
  const body = text ? safeJson(text) : undefined;
  if (!r.ok) {
    throw new ApiError(r.status, extractDetail(body, r), body);
  }
  return body as Material;
}

export type ProviderType = "subscription" | "token" | "lmstudio" | "ollama";
export type ProviderStatus = "unknown" | "healthy" | "warning" | "error";

export type Provider = {
  id: string;
  name: string;
  type: ProviderType;
  config: Record<string, unknown>;
  status: ProviderStatus;
  status_detail: string;
  models: string[];
  connected: boolean;
  last_checked_at: string | null;
  created_at: string;
};

export type ProviderTestResult = {
  status: ProviderStatus;
  detail: string;
  models: string[];
};

export type ConsoleChatReply = {
  reply: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
};

export async function listProviders(): Promise<Provider[]> {
  return api<Provider[]>("/ai/providers");
}

export async function createProvider(input: {
  name: string;
  type: ProviderType;
  config: Record<string, unknown>;
}): Promise<Provider> {
  return api<Provider>("/ai/providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProvider(
  id: string,
  input: { name?: string; config?: Record<string, unknown> },
): Promise<Provider> {
  return api<Provider>(`/ai/providers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await api<void>(`/ai/providers/${id}`, { method: "DELETE" });
}

export async function testProvider(id: string): Promise<Provider> {
  return api<Provider>(`/ai/providers/${id}/test`, { method: "POST" });
}

export async function testProviderConfig(input: {
  type: ProviderType;
  config: Record<string, unknown>;
}): Promise<ProviderTestResult> {
  return api<ProviderTestResult>("/ai/providers/test-config", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function connectProvider(id: string): Promise<Provider> {
  return api<Provider>(`/ai/providers/${id}/connect`, { method: "POST" });
}

export async function disconnectProvider(id: string): Promise<Provider> {
  return api<Provider>(`/ai/providers/${id}/disconnect`, { method: "POST" });
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function providerChat(
  id: string,
  input: { model: string; message: string; history?: ChatTurn[]; session?: string },
): Promise<ConsoleChatReply> {
  return api<ConsoleChatReply>(`/ai/providers/${id}/chat`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type ShimHealth = {
  running: boolean;
  url: string;
  models: string[];
  detail?: string;
};

export async function shimHealth(): Promise<ShimHealth> {
  return api<ShimHealth>("/ai/shim/health");
}

export type RouteRole = "primary" | "secondary";

export type RouteModel = {
  provider_id: string;
  provider_name: string;
  provider_type: string;
  provider_connected: boolean;
  provider_status: ProviderStatus;
  model: string;
  role: RouteRole;
  position: number;
};

export type RouteModelIn = {
  provider_id: string;
  model: string;
  role: RouteRole;
};

export type RouteStatus = "routed" | "unrouted" | "broken";

export type TaskRoute = {
  task: string;
  group: string;
  description: string;
  temperature: number;
  max_tokens: number;
  context_length: number | null;
  context_mode: "isolated" | "shared";
  share_key: string | null;
  system_prompt: string | null;
  active_skills: string[];
  models: RouteModel[];
  status: RouteStatus;
};

export type TaskRouteUpdate = {
  temperature?: number;
  max_tokens?: number;
  context_length?: number | null;
  context_mode?: "isolated" | "shared";
  share_key?: string | null;
  system_prompt?: string | null;
  active_skills?: string[];
  models?: RouteModelIn[];
};

export async function listTaskRoutes(): Promise<TaskRoute[]> {
  return api<TaskRoute[]>("/ai/task-routes");
}

export async function updateTaskRoute(
  task: string,
  update: TaskRouteUpdate,
): Promise<TaskRoute> {
  return api<TaskRoute>(`/ai/task-routes/${encodeURIComponent(task)}`, {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

export async function testTaskRoute(
  task: string,
): Promise<{ ok: boolean; detail: string }> {
  return api<{ ok: boolean; detail: string }>(
    `/ai/task-routes/${encodeURIComponent(task)}/test`,
    { method: "POST" },
  );
}

export type MemoryOverview = {
  root: string;
  sessions: number;
  headers: number;
  tag_count: number;
  generated: string | null;
};

export type MemorySearchHit = { session: string; header: string; matched: number };

export async function memoryOverview(): Promise<MemoryOverview> {
  return api<MemoryOverview>("/memory/overview");
}

export async function memoryTags(): Promise<Record<string, number>> {
  const r = await api<{ counts: Record<string, number> }>("/memory/tags");
  return r.counts;
}

export async function memorySessions(): Promise<string[]> {
  return api<string[]>("/memory/sessions");
}

export async function memorySession(name: string): Promise<{ name: string; markdown: string }> {
  return api<{ name: string; markdown: string }>(
    `/memory/sessions/${encodeURIComponent(name)}`,
  );
}

export async function memorySearch(tags: string[]): Promise<MemorySearchHit[]> {
  const q = tags.map((t) => `tag=${encodeURIComponent(t)}`).join("&");
  return api<MemorySearchHit[]>(`/memory/search?${q}`);
}

export async function memoryReindex(): Promise<{
  sessions: number;
  headers: number;
  tags: number;
}> {
  return api<{ sessions: number; headers: number; tags: number }>("/memory/reindex", {
    method: "POST",
  });
}

export type MemoryExchange = {
  header: string;
  timestamp: string;
  user: string;
  assistant: string;
  tags: string[];
};

export async function memorySessionExchanges(name: string): Promise<MemoryExchange[]> {
  return api<MemoryExchange[]>(
    `/memory/sessions/${encodeURIComponent(name)}/exchanges`,
  );
}

// ─── Materials ──────────────────────────────────────────────────────────────

export async function listMaterials(courseId?: string): Promise<Material[]> {
  const q = courseId ? `?course_id=${encodeURIComponent(courseId)}` : "";
  return api<Material[]>(`/materials/${q}`);
}

export async function ingestPending(courseId: string): Promise<{ enqueued: number }> {
  return api<{ enqueued: number }>(
    `/materials/ingest-pending?course_id=${encodeURIComponent(courseId)}`,
    { method: "POST" },
  );
}

export async function aiExtractMaterial(materialId: string): Promise<void> {
  await api<{ status: string }>(`/materials/${materialId}/extract-ai`, { method: "POST" });
}

export type BatchResult = { enqueued: number; skipped: number };

export async function aiExtractBatch(
  materialIds: string[],
  overwrite = false,
): Promise<BatchResult> {
  return api<BatchResult>(`/materials/extract-ai-batch?overwrite=${overwrite}`, {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds }),
  });
}

export async function ingestBatch(
  materialIds: string[],
  overwrite = false,
): Promise<BatchResult> {
  return api<BatchResult>(`/materials/ingest-batch?overwrite=${overwrite}`, {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds }),
  });
}

export type ExtractionVersion = {
  id: string;
  material_id: string;
  method: string;
  status: "pending" | "running" | "done" | "error";
  extraction_method: string | null;
  pages: number | null;
  word_count: number | null;
  vault_path: string | null;
  error: string | null;
  eval_score: number | null;
  eval_notes: string | null;
  is_final: boolean;
  created_at: string;
  updated_at: string;
};

export type MaterialVersions = {
  material_id: string;
  versions: ExtractionVersion[];
  comparison: { recommend?: string; reason?: string } | null;
  python_text: string | null;
  ai_text: string | null;
  comparison_report: string | null;
  evaluation_report: string | null;
  python_path: string | null;
  ai_path: string | null;
  comparison_path: string | null;
  evaluation_path: string | null;
};

export async function getMaterialVersions(materialId: string): Promise<MaterialVersions> {
  return api<MaterialVersions>(`/materials/${materialId}/versions`);
}

export async function compareBatch(
  materialIds: string[],
  overwrite = false,
): Promise<BatchResult> {
  return api<BatchResult>(`/materials/compare-batch?overwrite=${overwrite}`, {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds }),
  });
}

export async function evaluateBatch(
  materialIds: string[],
  overwrite = false,
): Promise<BatchResult> {
  return api<BatchResult>(`/materials/evaluate-batch?overwrite=${overwrite}`, {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds }),
  });
}

export async function setFinalBatch(
  materialIds: string[],
  method: "python" | "ai",
): Promise<{ finalized: number }> {
  return api<{ finalized: number }>(`/materials/set-final-batch?method=${method}`, {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds }),
  });
}

export async function evaluateExtraction(materialId: string): Promise<void> {
  await api<{ status: string }>(`/materials/${materialId}/evaluate-extraction`, { method: "POST" });
}

export async function setFinalVersion(
  materialId: string,
  method: string,
): Promise<MaterialVersions> {
  return api<MaterialVersions>(`/materials/${materialId}/versions/${method}/set-final`, {
    method: "POST",
  });
}

export async function stopExtraction(materialIds: string[]): Promise<{ stopped: number }> {
  return api<{ stopped: number }>(`/materials/extract-stop`, {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds }),
  });
}

export async function checkExtracted(
  courseId: string,
): Promise<{ checked: number; missing: number }> {
  return api<{ checked: number; missing: number }>(
    `/materials/check-extracted?course_id=${encodeURIComponent(courseId)}`,
    { method: "POST" },
  );
}

export type ExtractionSummary = {
  materials: number;
  python: { done: number; running: number; error: number };
  ai: { done: number; running: number; error: number };
  evaluated: number;
  compared: number;
  final_set: number;
  no_extraction: number;
};

export async function getExtractionSummary(courseId: string): Promise<ExtractionSummary> {
  return api<ExtractionSummary>(
    `/materials/extraction-summary?course_id=${encodeURIComponent(courseId)}`,
  );
}

export async function verifyExtractions(
  courseId: string,
): Promise<{ reconciled: number }> {
  return api<{ reconciled: number }>(
    `/materials/verify-extractions?course_id=${encodeURIComponent(courseId)}`,
    { method: "POST" },
  );
}

export async function pruneMissingMaterials(
  courseId: string,
): Promise<{ pruned: number; subpaths: string[] }> {
  return api<{ pruned: number; subpaths: string[] }>(
    `/materials/prune-missing?course_id=${encodeURIComponent(courseId)}`,
    { method: "POST" },
  );
}

export async function getMaterialText(materialId: string): Promise<string> {
  const r = await fetch(
    `${resolveBase()}/api/v1/materials/${materialId}/text`,
    { cache: "no-store" },
  );
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`);
  return r.text();
}

// ─── Syllabus ───────────────────────────────────────────────────────────────

export type SyllabusChapter = {
  id?: string;
  title?: string;
  materials?: string[];
  emphasis?: string;
  elos?: string[];
  categories?: string[];
};

export type SyllabusElo = {
  id?: string;
  text?: string;
  bloom?: string;
  chapters?: string[];
};

export type Syllabus = {
  exists: boolean;
  content: string;
  chapters: SyllabusChapter[];
  elos: SyllabusElo[];
  body: string;
  status: "none" | "building" | "ready" | "error";
  error: string | null;
  updated_at: string | null;
};

export async function getSyllabus(courseId: string): Promise<Syllabus> {
  return api<Syllabus>(`/courses/${courseId}/syllabus`);
}

export async function putSyllabus(courseId: string, content: string): Promise<Syllabus> {
  return api<Syllabus>(`/courses/${courseId}/syllabus`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function discoverChapterCategories(
  courseId: string,
): Promise<{ status: string; detail: string }> {
  return api<{ status: string; detail: string }>(
    `/courses/${courseId}/syllabus/discover-categories`,
    { method: "POST" },
  );
}

export async function buildSyllabus(
  courseId: string,
): Promise<{ status: string; detail: string }> {
  return api<{ status: string; detail: string }>(
    `/courses/${courseId}/syllabus/build`,
    { method: "POST" },
  );
}

// ─── Questions ──────────────────────────────────────────────────────────────

export type QuestionKind = "mcq" | "short" | "essay" | "problem" | "code" | "true_false";

export type Question = {
  id: string;
  course_id: string;
  kind: string;
  status: string;
  prompt_md: string;
  answer_md: string;
  distractors: string[];
  worked_solution_md: string | null;
  difficulty: number | null;
  bloom: string | null;
  est_minutes: number | null;
  topics: string[];
  chapter_id: string | null;
  category: string | null;
  elo_ids: string[];
  source_material_ids: string[];
  source_pages: number[];
  origin: string;
  created_by: string | null;
  source_ref: string | null;
  evaluation_md: string | null;
  eval_correctness: number | null;
  eval_clarity: number | null;
  feedback_md: string | null;
  translation_sv: string | null;
  scope_alignment: number | null;
  off_topic_reason: string | null;
  closest_reference_id: string | null;
  reference_deviation: number | null;
  reference_match_note: string | null;
  needs_human_review: boolean;
  vault_path: string;
  current_iteration: number;
  created_at: string;
  updated_at: string;
};

export type QuestionGenerateInput = {
  course_id: string;
  material_ids: string[];
  kind: QuestionKind;
  count: number;
  difficulty?: number | null;
  bloom?: string | null;
  topics?: string[] | null;
  chapter_id?: string | null;
  category?: string | null;
  with_diagrams?: boolean;
};

export async function listQuestions(
  courseId?: string,
  opts?: { status?: string; kind?: string },
): Promise<Question[]> {
  const p = new URLSearchParams();
  if (courseId) p.set("course_id", courseId);
  if (opts?.status) p.set("status", opts.status);
  if (opts?.kind) p.set("kind", opts.kind);
  const qs = p.toString();
  return api<Question[]>(`/questions/${qs ? `?${qs}` : ""}`);
}

export async function getQuestion(id: string): Promise<Question> {
  return api<Question>(`/questions/${id}`);
}

export async function generateQuestions(
  input: QuestionGenerateInput,
): Promise<{ status: string; detail: string }> {
  return api<{ status: string; detail: string }>(`/questions/generate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteQuestion(id: string): Promise<void> {
  await api<void>(`/questions/${id}`, { method: "DELETE" });
}

export async function updateQuestion(
  id: string,
  patch: Partial<{
    prompt_md: string;
    answer_md: string;
    worked_solution_md: string;
    distractors: string[];
    difficulty: number;
    bloom: string;
    est_minutes: number;
    category: string;
    status: string;
  }>,
): Promise<Question> {
  return api<Question>(`/questions/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}

export async function answerQuestion(id: string): Promise<void> {
  await api<void>(`/questions/${id}/answer`, { method: "POST" });
}

export async function evaluateQuestion(id: string): Promise<void> {
  await api<void>(`/questions/${id}/evaluate`, { method: "POST" });
}

export async function feedbackQuestion(id: string): Promise<void> {
  await api<void>(`/questions/${id}/feedback`, { method: "POST" });
}

export async function translateQuestion(
  id: string,
  refresh = false,
): Promise<{ question_id: string; translation_sv: string }> {
  const qs = refresh ? "?refresh=true" : "";
  return api(`/questions/${id}/translate${qs}`, { method: "POST" });
}

export async function classifyQuestions(
  courseId: string,
  questionIds?: string[],
): Promise<{ enqueued: number }> {
  return api<{ enqueued: number }>(`/questions/classify-batch`, {
    method: "POST",
    body: JSON.stringify({ course_id: courseId, question_ids: questionIds ?? null }),
  });
}

export async function reconcileQuestions(
  courseId: string,
): Promise<{ course_id: string; removed: number; removed_ids: string[]; kept: number }> {
  return api(`/questions/reconcile?course_id=${courseId}`, { method: "POST" });
}

export async function reconcileExams(courseId: string): Promise<{
  course_id: string;
  removed: number;
  removed_ids: string[];
  nulled: number;
  nulled_ids: string[];
  kept: number;
}> {
  return api(`/exams/reconcile?course_id=${courseId}`, { method: "POST" });
}

// ─── AI tasks (live ARQ queue) ──────────────────────────────────────────────

export type TaskItem = {
  id: string;
  name: string;
  args: string;
  status: "queued" | "running" | "ok" | "error";
  enqueue_time: string | null;
  start_time?: string | null;
  finish_time?: string | null;
  result?: string;
};

export type TasksSnapshot = {
  queued: TaskItem[];
  in_progress: TaskItem[];
  recent: TaskItem[];
  counts: { queued: number; in_progress: number; recent: number };
};

export async function listTasks(): Promise<TasksSnapshot> {
  return api<TasksSnapshot>(`/tasks/`);
}

export async function cancelTask(jobId: string): Promise<{ aborted: boolean }> {
  return api(`/tasks/${jobId}/cancel`, { method: "POST" });
}

export async function retryTask(jobId: string): Promise<{ queued_job_id: string | null }> {
  return api(`/tasks/${jobId}/retry`, { method: "POST" });
}

// ─── Monitor ────────────────────────────────────────────────────────────────

export type MonitorSnapshot = {
  totals: {
    conversations: number;
    messages: number;
    tokens_in: number;
    tokens_out: number;
    tokens_total: number;
    cost_usd: number;
  };
  by_provider: {
    provider: string;
    model: string;
    messages: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
  }[];
  recent_24h: { hour: string | null; messages: number; tokens: number }[];
  providers_configured: { name: string; type: string }[];
};

export async function getMonitor(): Promise<MonitorSnapshot> {
  return api<MonitorSnapshot>(`/monitor/usage`);
}

// ─── Inventory (Skills page) ────────────────────────────────────────────────

export type InventorySnapshot = {
  skills: { name: string; description: string; source: string }[];
  ai_tasks: {
    task: string;
    group: string;
    description: string;
    routes: { role: string; provider: string; model: string }[];
  }[];
  worker_jobs: { name: string; module: string }[];
  api_routes: { methods: string; path: string; name: string }[];
};

export async function getInventory(courseId?: string): Promise<InventorySnapshot> {
  const qs = courseId ? `?course_id=${courseId}` : "";
  return api<InventorySnapshot>(`/inventory/${qs}`);
}

export async function answerQuestionsBatch(
  questionIds: string[],
  overwrite = false,
): Promise<{ enqueued: number; skipped: number }> {
  return api(`/questions/answer-batch`, {
    method: "POST",
    body: JSON.stringify({ question_ids: questionIds, overwrite }),
  });
}

export async function evaluateQuestionsBatch(
  questionIds: string[],
  overwrite = false,
): Promise<{ enqueued: number; skipped: number }> {
  return api(`/questions/evaluate-batch`, {
    method: "POST",
    body: JSON.stringify({ question_ids: questionIds, overwrite }),
  });
}

export async function feedbackQuestionsBatch(
  questionIds: string[],
  overwrite = false,
): Promise<{ enqueued: number; skipped: number }> {
  return api(`/questions/feedback-batch`, {
    method: "POST",
    body: JSON.stringify({ question_ids: questionIds, overwrite }),
  });
}

export async function similarityQuestion(id: string): Promise<void> {
  await api<void>(`/questions/${id}/similarity`, { method: "POST" });
}

export async function similarityQuestionsBatch(
  questionIds: string[],
  overwrite = false,
): Promise<{ enqueued: number; skipped: number }> {
  return api(`/questions/similarity-batch`, {
    method: "POST",
    body: JSON.stringify({ question_ids: questionIds, overwrite }),
  });
}

export async function deleteQuestionsBatch(
  questionIds: string[],
): Promise<{ deleted: number }> {
  return api(`/questions/delete-batch`, {
    method: "POST",
    body: JSON.stringify({ question_ids: questionIds, overwrite: true }),
  });
}

/** Browser URL of a rendered question figure. */
export function questionFigureUrl(questionId: string, name: string): string {
  return `/api/v1/questions/${questionId}/figures/${encodeURIComponent(name)}`;
}

// ─── Exam plan ──────────────────────────────────────────────────────────────

export type ExamPlanCategory = {
  chapter_id: string | null;
  name: string;
  target: number;
  have: number;
};

export type ExamPlan = {
  exists: boolean;
  total_questions: number;
  total_minutes: number;
  notes: string;
  categories: ExamPlanCategory[];
};

export async function getExamPlan(courseId: string): Promise<ExamPlan> {
  return api<ExamPlan>(`/courses/${courseId}/exam-plan`);
}

export async function putExamPlan(
  courseId: string,
  plan: {
    total_questions: number;
    total_minutes: number;
    categories: { chapter_id: string | null; name: string; target: number }[];
    notes?: string;
  },
): Promise<ExamPlan> {
  return api<ExamPlan>(`/courses/${courseId}/exam-plan`, {
    method: "PUT",
    body: JSON.stringify(plan),
  });
}

export async function harvestQuestions(materialIds: string[]): Promise<void> {
  await api<void>(`/questions/harvest`, {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds }),
  });
}

// ─── Exams ──────────────────────────────────────────────────────────────────

export type ExamQuestionRow = {
  question_id: string;
  position: number;
  points: number;
  category: string | null;
  kind: string;
  difficulty: number | null;
  prompt_preview: string;
};

export type ExamSummary = {
  id: string;
  course_id: string;
  title: string;
  origin: string;
  status: string;
  total_minutes: number;
  question_count: number;
  created_at: string;
  tex_path: string | null;
  pdf_path: string | null;
  solution_pdf_path: string | null;
  source_pdf_path: string | null;
  reproduction_score: number | null;
  reproduction_notes: string | null;
  validation_status?: string;
  open_blocking?: number;
};

// ─── Validation ─────────────────────────────────────────────────────────────

export type Finding = {
  id: string;
  rule_id: string;
  severity: "blocking" | "warning" | "note";
  title: string;
  detail_md: string;
  evidence: Record<string, unknown>;
  status: string;
  auto_fixable: boolean;
  question_id: string | null;
  resolution_note: string | null;
};

export type ExamFindings = {
  exam_id: string;
  validation_status: string;
  validated_at: string | null;
  override_reason: string | null;
  counts: { blocking: number; warning: number; note: number };
  findings: Finding[];
};

/** Enqueue validation. deep=true also runs the AI reviewers (slow). */
export async function validateExam(id: string, deep = false): Promise<{ status: string }> {
  return api(`/exams/${id}/validate?deep=${deep}`, { method: "POST" });
}

export async function getExamFindings(id: string, includeResolved = false): Promise<ExamFindings> {
  return api(`/exams/${id}/findings?include_resolved=${includeResolved}`);
}

export async function patchFinding(
  findingId: string,
  status: "open" | "accepted" | "dismissed" | "fixed",
  note?: string,
): Promise<{ status: string }> {
  return api(`/exams/findings/${findingId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, note: note ?? null }),
  });
}

export async function overrideExamValidation(
  id: string,
  reason: string,
): Promise<{ validation_status: string }> {
  return api(`/exams/${id}/override`, { method: "POST", body: JSON.stringify({ reason }) });
}

export type RepairResult = {
  applied: boolean;
  proposal: Record<string, string>;
  change_summary: string;
  blocked_reason: string;
  diff: string;
};

/** Fix one finding. Deterministic rules apply at once; others return a proposal
 * until you send apply=true. */
export async function repairFinding(findingId: string, apply = false): Promise<RepairResult> {
  return api(`/questions/findings/${findingId}/repair`, {
    method: "POST",
    body: JSON.stringify({ apply }),
  });
}

export type PullResult = {
  question_id: string;
  folder: string;
  in_sync: boolean;
  changed_fields: string[];
  diff: Record<string, { before: string; after: string; before_chars: string; after_chars: string }>;
  unknown_sections: string[];
};

/** Read a question's vault markdown back into the database. Diff-only unless apply. */
export async function pullQuestionFromVault(id: string, apply = false): Promise<PullResult> {
  return api(`/questions/${id}/pull-from-vault`, {
    method: "POST",
    body: JSON.stringify({ apply }),
  });
}

export async function validateQuestion(id: string): Promise<{
  counts: { blocking: number; warning: number; note: number };
  findings: Omit<Finding, "id" | "evidence" | "status" | "question_id" | "resolution_note">[];
}> {
  return api(`/questions/${id}/validate`, { method: "POST" });
}

export async function compareExamReproduction(id: string): Promise<{ status: string; exam_id: string }> {
  return api(`/exams/${id}/reproduction-compare`, { method: "POST" });
}

export type ExamDetail = ExamSummary & {
  instructions_md: string;
  questions: ExamQuestionRow[];
};

export async function listExams(courseId: string): Promise<ExamSummary[]> {
  return api<ExamSummary[]>(`/exams?course_id=${courseId}`);
}

export async function getExam(id: string): Promise<ExamDetail> {
  return api<ExamDetail>(`/exams/${id}`);
}

export async function createExam(input: {
  course_id: string;
  title: string;
  total_minutes: number;
}): Promise<ExamSummary> {
  return api<ExamSummary>(`/exams`, { method: "POST", body: JSON.stringify(input) });
}

export async function setExamQuestions(
  id: string,
  questions: { question_id: string; position: number; points: number; category?: string | null }[],
): Promise<ExamDetail> {
  return api<ExamDetail>(`/exams/${id}/questions`, {
    method: "PUT",
    body: JSON.stringify({ questions }),
  });
}

export async function buildAutoExams(input: {
  course_id: string;
  title: string;
  total_minutes: number;
  variants: number;
  slots: { category: string; difficulty?: number | null; points: number }[];
}): Promise<{ exam_ids: string[] }> {
  return api<{ exam_ids: string[] }>(`/exams/build-auto`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function renderExam(id: string): Promise<void> {
  await api<void>(`/exams/${id}/render`, { method: "POST" });
}

export async function compileExam(id: string): Promise<void> {
  await api<void>(`/exams/${id}/compile`, { method: "POST" });
}

export async function deleteExam(id: string): Promise<void> {
  await api<void>(`/exams/${id}`, { method: "DELETE" });
}

export async function renderExamsBatch(
  examIds: string[],
  overwrite = false,
): Promise<{ enqueued: number; skipped: number }> {
  return api(`/exams/render-batch`, {
    method: "POST",
    body: JSON.stringify({ exam_ids: examIds, overwrite }),
  });
}

export async function compileExamsBatch(
  examIds: string[],
  overwrite = false,
): Promise<{ enqueued: number; skipped: number }> {
  return api(`/exams/compile-batch`, {
    method: "POST",
    body: JSON.stringify({ exam_ids: examIds, overwrite }),
  });
}

export async function deleteExamsBatch(
  examIds: string[],
): Promise<{ deleted: number }> {
  return api(`/exams/delete-batch`, {
    method: "POST",
    body: JSON.stringify({ exam_ids: examIds, overwrite: true }),
  });
}

export async function importReferenceExams(courseId: string): Promise<{ imported: number }> {
  return api<{ imported: number }>(`/exams/import-reference?course_id=${courseId}`, {
    method: "POST",
  });
}

export type ExamAnalysis = {
  exam_id: string;
  overall_difficulty: number | null;
  difficulty_profile: Record<string, number>;
  category_mix: { name: string; count: number }[];
  feedback_md: string;
};

export async function analyzeExam(
  id: string,
  materialIds?: string[],
): Promise<ExamAnalysis> {
  return api<ExamAnalysis>(`/exams/${id}/analyze`, {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds ?? null }),
  });
}

/** Browser URL of a built exam file. Default disposition is inline (for
 * iframe preview). Pass {download: true} to get the file with an attachment
 * Content-Disposition header. Pass {v: number} as a cache-buster for iframe
 * previews — needed because browsers aggressively cache PDF responses and
 * won't re-fetch after a rebuild/compile without a URL change. */
export function examFileUrl(
  id: string,
  kind: "tex" | "pdf" | "source" | "solution-pdf",
  opts?: { download?: boolean; v?: number },
): string {
  const parts = [`kind=${kind}`];
  if (opts?.download) parts.push("download=true");
  if (opts?.v != null) parts.push(`v=${opts.v}`);
  return `/api/v1/exams/${id}/file?${parts.join("&")}`;
}

/** Fetch the .tex content as plain text (for the in-app source viewer). */
export async function examFileText(id: string, kind: "tex" | "pdf"): Promise<string> {
  const res = await fetch(examFileUrl(id, kind), { credentials: "omit" });
  if (!res.ok) {
    throw new ApiError(res.status, `failed to read ${kind}: ${res.status}`, null);
  }
  return res.text();
}

// ─── Per-exam source files (in-app editor) ─────────────────────────────────

export type ExamSourceFile = { name: string; size: number; mtime: number };

export async function listExamSources(id: string): Promise<{ files: ExamSourceFile[] }> {
  return api<{ files: ExamSourceFile[] }>(`/exams/${id}/sources`);
}

export async function readExamSource(
  id: string,
  path: string,
): Promise<{ name: string; path: string; content: string }> {
  return api<{ name: string; path: string; content: string }>(
    `/exams/${id}/source?path=${encodeURIComponent(path)}`,
  );
}

export async function writeExamSource(
  id: string,
  path: string,
  content: string,
): Promise<{ status: string; name: string; path: string }> {
  return api(`/exams/${id}/source`, {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  });
}

export async function resetExamTemplate(id: string): Promise<{ status: string; exam_id: string }> {
  return api(`/exams/${id}/reset-template`, { method: "POST" });
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export type OrchestratorMsg = { role: "user" | "assistant"; content: string };

export async function orchestratorChat(input: {
  message: string;
  history: OrchestratorMsg[];
  course_id?: string | null;
  page?: string;
}): Promise<{ reply: string; provider: string; model: string }> {
  return api<{ reply: string; provider: string; model: string }>("/ai/orchestrator", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
