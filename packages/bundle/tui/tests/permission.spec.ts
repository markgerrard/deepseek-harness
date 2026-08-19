import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERMISSION_PRESETS,
  currentPermissionId,
  displayPermissionMode,
  foldPermissionPreset,
  foldPlanActive,
  labelPermissionPreset,
  nextLocalPermissionMode,
  nextPermissionAction,
  permissionActionId,
  permissionCycle,
} from '../src/permission.ts'

const both = {
  planActive: false,
  hasPlan: true,
  preset: 'workspace-write',
  presets: [...DEFAULT_PERMISSION_PRESETS],
}

describe('permission mode labels', () => {
  it('maps DSH presets onto Claude Code-like footer labels', () => {
    expect(labelPermissionPreset('workspace-write')).toBe('default')
    expect(labelPermissionPreset('danger-full-access')).toBe('accept edits')
    expect(labelPermissionPreset('read-only')).toBe('read only')
    expect(labelPermissionPreset(undefined)).toBe('default')
    expect(displayPermissionMode(both)).toBe('default')
    expect(displayPermissionMode({ ...both, planActive: true })).toBe('plan')
    expect(displayPermissionMode({ ...both, preset: 'danger-full-access' })).toBe('accept edits')
    expect(displayPermissionMode({ planActive: false, hasPlan: false, presets: [] })).toBe('default')
  })
})

describe('Shift+Tab cycle', () => {
  it('cycles default → accept edits → plan when both seams exist', () => {
    const modes = permissionCycle(both)
    expect(modes.map(permissionActionId)).toEqual(['workspace-write', 'danger-full-access', 'plan'])
    expect(nextPermissionAction(both)).toEqual({ kind: 'preset', name: 'danger-full-access' })
    expect(nextPermissionAction({ ...both, preset: 'danger-full-access' })).toEqual({
      kind: 'plan', active: true,
    })
    expect(nextPermissionAction({ ...both, planActive: true })).toEqual({
      kind: 'preset', name: 'workspace-write',
    })
    expect(currentPermissionId(both)).toBe('workspace-write')
    expect(currentPermissionId({ ...both, planActive: true })).toBe('plan')
  })

  it('cycles only the mounted presets when plan mode is absent', () => {
    const facts = {
      planActive: false,
      hasPlan: false,
      preset: 'workspace-write',
      presets: [...DEFAULT_PERMISSION_PRESETS],
    }
    expect(permissionCycle(facts).map(permissionActionId)).toEqual([
      'workspace-write', 'danger-full-access',
    ])
    expect(nextPermissionAction(facts)).toEqual({ kind: 'preset', name: 'danger-full-access' })
    expect(nextPermissionAction({ ...facts, preset: 'danger-full-access' })).toEqual({
      kind: 'preset', name: 'workspace-write',
    })
  })

  it('cycles default ↔ plan when only plan mode is mounted', () => {
    const facts = { planActive: false, hasPlan: true, presets: [] as string[] }
    expect(permissionCycle(facts).map(permissionActionId)).toEqual(['default', 'plan'])
    expect(nextPermissionAction(facts)).toEqual({ kind: 'plan', active: true })
    expect(nextPermissionAction({ ...facts, planActive: true })).toEqual({ kind: 'plan', active: false })
    expect(displayPermissionMode(facts)).toBe('default')
  })

  it('starts at the first slot from custom / unknown current values', () => {
    const facts = { ...both, preset: 'custom' }
    expect(nextPermissionAction(facts)).toEqual({ kind: 'preset', name: 'workspace-write' })
    expect(nextPermissionAction({ planActive: false, hasPlan: false, presets: [] })).toBeUndefined()
  })
})

describe('local Shift+Tab fallback', () => {
  it('cycles a local default / accept edits / plan fallback', () => {
    expect(nextLocalPermissionMode(undefined)).toBe('accept edits')
    expect(nextLocalPermissionMode('default')).toBe('accept edits')
    expect(nextLocalPermissionMode('accept edits')).toBe('plan')
    expect(nextLocalPermissionMode('plan')).toBe('default')
  })
})

describe('session-log folds', () => {
  it('reads the last permission/preset and plan/mode events', () => {
    const events = [
      { type: 'permission/preset', data: { preset: 'workspace-write' } },
      { type: 'plan/mode', data: { active: true } },
      { type: 'permission/preset', data: { preset: 'danger-full-access' } },
      { type: 'plan/mode', data: { active: false } },
    ]
    expect(foldPermissionPreset(events)).toBe('danger-full-access')
    expect(foldPlanActive(events)).toBe(false)
    expect(foldPlanActive(events.slice(0, 2))).toBe(true)
    expect(foldPermissionPreset([])).toBeUndefined()
    expect(foldPlanActive([])).toBe(false)
  })
})
