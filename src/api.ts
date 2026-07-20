// Typed client for the Takt-Web API (Cloudflare Pages Functions under /api).

export type EmployerKind = 'work' | 'private'

export interface Employer {
  id: number
  name: string
  color: string
  icon: string
  kind: EmployerKind
  weekly_goal_min: number
  active: number
  sort_order: number
  is_sport: number
}

export interface AreaHours {
  employer_id: number
  weekday: number // 0=So … 6=Sa
  minutes: number
}

export interface AbsenceTypeConfig {
  key: string
  label: string
  color: string
  icon: string
}

export interface AppSettings {
  accent_color: string
  start_date: string
  bundesland: string
  absence_types: string // JSON-Array (AbsenceTypeConfig[])
  hotkeys: string // JSON-Objekt (CommandId → Kombi-String, z. B. "mod+k")
}

export interface Project {
  id: number
  employer_id: number
  parent_id: number | null
  name: string
  level: number
  active: number
  sort_order: number
}

export interface Target {
  id: number
  employer_id: number
  weekly_soll_min: number
  valid_from: string // ISO-Datum (YYYY-MM-DD)
}

export interface Entry {
  id: number
  employer_id: number
  project_id: number | null
  start_ts: string // ISO 8601
  end_ts: string | null // null = läuft gerade
  duration_min: number | null
  note: string | null
  created_at: string
}

export interface PlannedBlock {
  id: number
  employer_id: number
  project_id: number | null
  weekday: number // 0=So .. 6=Sa
  start_min: number
  end_min: number
  created_at: string
}

export interface NewPlannedBlock {
  employer_id: number
  project_id?: number | null
  weekday: number
  start_min: number
  end_min: number
}

export interface PlannedBlockPatch {
  employer_id?: number
  project_id?: number | null
  weekday?: number
  start_min?: number
  end_min?: number
}

export interface PlannedOverride {
  id: number
  date: string // YYYY-MM-DD
  source_block_id: number | null
  deleted: 0 | 1
  employer_id: number | null
  project_id: number | null
  start_min: number | null
  end_min: number | null
  created_at: string
}

export interface NewPlannedOverride {
  date: string
  source_block_id?: number | null
  deleted?: boolean
  employer_id?: number | null
  project_id?: number | null
  start_min?: number | null
  end_min?: number | null
}

export interface PlannedOverridePatch {
  deleted?: boolean
  employer_id?: number | null
  project_id?: number | null
  start_min?: number
  end_min?: number
}

export type AbsenceType = 'urlaub' | 'krank' | 'sonstiges'

export interface Absence {
  id: number
  start_date: string // YYYY-MM-DD (inklusive)
  end_date: string // YYYY-MM-DD (inklusive)
  type: AbsenceType
  employer_id: number | null
  note: string | null
  all_day: 0 | 1
  start_min: number | null
  end_min: number | null
  created_at: string
}

export interface NewAbsence {
  start_date: string
  end_date?: string
  type: AbsenceType
  employer_id?: number | null
  note?: string | null
  all_day?: boolean
  start_min?: number | null
  end_min?: number | null
}

export interface Todo {
  id: number
  title: string
  due_date: string | null // ISO-Datum (YYYY-MM-DD) oder null
  done: 0 | 1
  favorite: 0 | 1
  sort_order: number
  employer_id: number | null
  project_id: number | null
  created_at: string
}

export interface NewTodo {
  title: string
  due_date?: string | null
  employer_id?: number | null
  project_id?: number | null
  done?: boolean
}

export interface TodoPatch {
  title?: string
  due_date?: string | null
  done?: boolean
  favorite?: boolean
  sort_order?: number
  employer_id?: number | null
  project_id?: number | null
}

export interface NewEntry {
  start_ts: string
  employer_id: number
  project_id?: number | null
  note?: string | null
}

export interface EntryPatch {
  start_ts?: string
  end_ts?: string | null
  employer_id?: number
  project_id?: number | null
  note?: string | null
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* body was not JSON */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  getEmployers: () => request<Employer[]>('/api/employers'),
  getProjects: () => request<Project[]>('/api/projects'),
  getTargets: () => request<Target[]>('/api/targets'),
  getEntries: () => request<Entry[]>('/api/entries'),

  createEmployer: (body: { name: string; color?: string; icon?: string; kind?: EmployerKind; weekly_goal_min?: number }) =>
    request<Employer>('/api/employers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateEmployer: (
    id: number,
    patch: { name?: string; color?: string; icon?: string; kind?: EmployerKind; weekly_goal_min?: number; active?: boolean; sort_order?: number; is_sport?: 0 | 1 },
  ) =>
    request<Employer>(`/api/employers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteEmployer: (id: number) => request<void>(`/api/employers/${id}`, { method: 'DELETE' }),

  createProject: (body: { name: string; employer_id: number }) =>
    request<Project>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateProject: (id: number, patch: { name?: string; employer_id?: number; active?: boolean; sort_order?: number }) =>
    request<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteProject: (id: number) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),

  getAreaHours: () => request<AreaHours[]>('/api/area-hours'),

  setAreaHours: (employerId: number, minutes: number[]) =>
    request<AreaHours[]>(`/api/area-hours/${employerId}`, {
      method: 'PUT',
      body: JSON.stringify({ minutes }),
    }),

  getSettings: () => request<AppSettings>('/api/settings'),

  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  createEntry: (body: NewEntry) =>
    request<Entry>('/api/entries', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateEntry: (id: number, patch: EntryPatch) =>
    request<Entry>(`/api/entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteEntry: (id: number) =>
    request<void>(`/api/entries/${id}`, { method: 'DELETE' }),

  getTodos: () => request<Todo[]>('/api/todos'),

  createTodo: (body: NewTodo) =>
    request<Todo>('/api/todos', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateTodo: (id: number, patch: TodoPatch) =>
    request<Todo>(`/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteTodo: (id: number) =>
    request<void>(`/api/todos/${id}`, { method: 'DELETE' }),

  // date optional: mit date werden die Blöcke des passenden Wochentags geliefert.
  getPlanned: (date?: string) =>
    request<PlannedBlock[]>(date ? `/api/planned?date=${date}` : '/api/planned'),

  createPlanned: (body: NewPlannedBlock) =>
    request<PlannedBlock>('/api/planned', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updatePlanned: (id: number, patch: PlannedBlockPatch) =>
    request<PlannedBlock>(`/api/planned/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deletePlanned: (id: number) =>
    request<void>(`/api/planned/${id}`, { method: 'DELETE' }),

  getOverrides: () => request<PlannedOverride[]>('/api/overrides'),

  createOverride: (body: NewPlannedOverride) =>
    request<PlannedOverride>('/api/overrides', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateOverride: (id: number, patch: PlannedOverridePatch) =>
    request<PlannedOverride>(`/api/overrides/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteOverride: (id: number) =>
    request<void>(`/api/overrides/${id}`, { method: 'DELETE' }),

  getAbsences: () => request<Absence[]>('/api/absences'),

  createAbsence: (body: NewAbsence) =>
    request<Absence>('/api/absences', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAbsence: (id: number, patch: NewAbsence) =>
    request<Absence>(`/api/absences/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteAbsence: (id: number) =>
    request<void>(`/api/absences/${id}`, { method: 'DELETE' }),
}
