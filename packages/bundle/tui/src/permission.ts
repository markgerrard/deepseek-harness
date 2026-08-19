/**
 * Claude Code-like permission-mode labels over DSH plan mode and
 * `/permission` presets. The TUI does not invent a second permission system:
 * it maps `ctx.planMode` + `ctx.permissionPresets` (or the `/plan` /
 * `/permission` commands) onto the footer and Shift+Tab cycle.
 * @module @deepseek-ai/dsh-tui/permission
 */

/** One cycle target: enter/leave plan, or switch a permission preset. */
export type PermissionAction =
  | { readonly kind: 'plan'; readonly active: boolean }
  | { readonly kind: 'preset'; readonly name: string }

/** Live facts the controller reads from DSH services or the session log. */
export interface PermissionFacts {
  /** Plan mode is active or pending. */
  readonly planActive: boolean
  /** Whether `ctx.planMode` / `/plan` is available. */
  readonly hasPlan: boolean
  /** Current permission preset (`workspace-write`, `danger-full-access`, …). */
  readonly preset?: string
  /** Switchable preset names in table order. `custom` is never a target. */
  readonly presets: readonly string[]
}

/** Shipped DSH preset table when the service is missing but `/permission` is registered. */
export const DEFAULT_PERMISSION_PRESETS = ['workspace-write', 'danger-full-access'] as const

/** Local Shift+Tab cycle used when plan / permission seams are not mounted. */
export const LOCAL_PERMISSION_MODES = ['default', 'accept edits', 'plan'] as const

/**
 * Next local footer label when DSH plan / permission seams are missing.
 * @param current - footer label, or undefined before the first paint.
 * @returns the next Claude Code-like mode.
 */
export function nextLocalPermissionMode(current: string | undefined): string {
  const found = LOCAL_PERMISSION_MODES.findIndex(mode => mode === current)
  const index = found < 0 ? 0 : found
  return LOCAL_PERMISSION_MODES[(index + 1) % LOCAL_PERMISSION_MODES.length] ?? 'accept edits'
}

/**
 * Claude Code-like footer label for the current DSH mode.
 * `workspace-write` → `default`, `danger-full-access` → `accept edits`.
 * Always returns a label so Shift+Tab is visible even with nothing mounted.
 * @param facts - plan + preset facts.
 * @returns a short footer label.
 */
export function displayPermissionMode(facts: PermissionFacts): string {
  if (facts.planActive) return 'plan'
  return labelPermissionPreset(facts.preset)
}

/**
 * Human label for one permission preset.
 * @param name - raw preset id, or undefined when only plan is mounted.
 * @returns `default` / `accept edits` / the honest name.
 */
export function labelPermissionPreset(name: string | undefined): string {
  if (name === undefined || name === '' || name === 'workspace-write') return 'default'
  if (name === 'danger-full-access') return 'accept edits'
  return name.replace(/-/g, ' ')
}

/**
 * Build the Shift+Tab cycle from what DSH actually mounted.
 * Plan (when available) then each switchable preset. Plan-only assemblies
 * cycle `default` (plan off) ↔ `plan`.
 * @param facts - plan + preset facts.
 * @returns ordered cycle targets (may be empty).
 */
export function permissionCycle(facts: PermissionFacts): readonly PermissionAction[] {
  const presets = facts.presets.filter(name => name !== 'custom' && name !== '')
  if (facts.hasPlan && presets.length === 0) {
    return [{ kind: 'plan', active: false }, { kind: 'plan', active: true }]
  }
  const modes: PermissionAction[] = []
  for (const name of presets) modes.push({ kind: 'preset', name })
  if (facts.hasPlan) modes.push({ kind: 'plan', active: true })
  return modes
}

/**
 * Next Shift+Tab action. Unknown / custom current values start at the first slot.
 * @param facts - plan + preset facts.
 * @returns the next action, or undefined when there is nothing to cycle.
 */
export function nextPermissionAction(facts: PermissionFacts): PermissionAction | undefined {
  const modes = permissionCycle(facts)
  if (modes.length === 0) return undefined
  const current = currentPermissionId(facts)
  const index = modes.findIndex(mode => permissionActionId(mode) === current)
  const next = modes[(index + 1) % modes.length]
  return next
}

/**
 * Stable id for a cycle slot (`plan`, `default`, or the raw preset name).
 * @param action - one cycle target.
 * @returns the id used to match the current mode.
 */
export function permissionActionId(action: PermissionAction): string {
  if (action.kind === 'plan') return action.active ? 'plan' : 'default'
  return action.name
}

/**
 * Id of the current mode for cycle matching.
 * @param facts - plan + preset facts.
 * @returns `plan`, a preset name, or `default`.
 */
export function currentPermissionId(facts: PermissionFacts): string {
  if (facts.planActive) return 'plan'
  if (facts.preset !== undefined && facts.preset !== '' && facts.preset !== 'custom') return facts.preset
  if (facts.preset === undefined && facts.presets.includes('workspace-write')) return 'workspace-write'
  return facts.preset === 'custom' ? 'custom' : 'default'
}

/**
 * Fold the last `permission/preset` event from a session log.
 * @param events - session events in log order.
 * @returns the last selected preset, or undefined.
 */
export function foldPermissionPreset(events: readonly { readonly type: string; readonly data: unknown }[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'permission/preset') continue
    if (event.data === null || typeof event.data !== 'object') continue
    const preset = (event.data as { preset?: unknown }).preset
    if (typeof preset === 'string' && preset !== '') return preset
  }
  return undefined
}

/**
 * Fold the last `plan/mode` event from a session log.
 * @param events - session events in log order.
 * @returns whether plan mode is active.
 */
export function foldPlanActive(events: readonly { readonly type: string; readonly data: unknown }[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'plan/mode') continue
    if (event.data === null || typeof event.data !== 'object') continue
    return (event.data as { active?: unknown }).active === true
  }
  return false
}
