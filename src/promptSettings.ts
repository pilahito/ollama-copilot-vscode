import * as vscode from 'vscode';
import {
  SYSTEM_PROMPT,
  TEACHER_PROMPT,
  TEACHER_FIX_PROMPT,
} from './prompts';

export interface PromptFields {
  chat: string;
  teacher: string;
  teacherFix: string;
  agent: string;
}

export const PROMPT_DEFAULTS: PromptFields = {
  chat: SYSTEM_PROMPT,
  teacher: TEACHER_PROMPT,
  teacherFix: TEACHER_FIX_PROMPT,
  agent: '',
};

const CONFIG_KEYS: Record<keyof PromptFields, string> = {
  chat: 'promptChat',
  teacher: 'promptTeacher',
  teacherFix: 'promptTeacherFix',
  agent: 'promptAgent',
};

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('local');
}

/** Prompt efectivo usado en runtime (custom o por defecto). */
export function getEffectivePrompt(field: keyof PromptFields): string {
  const custom = getConfig().get<string>(CONFIG_KEYS[field], '').trim();
  if (field === 'agent') {
    return custom;
  }
  return custom || PROMPT_DEFAULTS[field];
}

/** Valores para mostrar en el editor de ajustes. */
export function getEditablePrompts(): PromptFields {
  const c = getConfig();
  return {
    chat: c.get('promptChat', '').trim() || PROMPT_DEFAULTS.chat,
    teacher: c.get('promptTeacher', '').trim() || PROMPT_DEFAULTS.teacher,
    teacherFix: c.get('promptTeacherFix', '').trim() || PROMPT_DEFAULTS.teacherFix,
    agent: c.get('promptAgent', '').trim() || PROMPT_DEFAULTS.agent,
  };
}

export function isUsingCustomPrompt(field: keyof PromptFields): boolean {
  return !!getConfig().get<string>(CONFIG_KEYS[field], '').trim();
}

export async function savePrompts(prompts: Partial<PromptFields>): Promise<void> {
  const c = getConfig();
  const entries = Object.entries(CONFIG_KEYS) as [keyof PromptFields, string][];

  for (const [field, key] of entries) {
    if (!(field in prompts)) { continue; }
    const raw = (prompts[field] ?? '').trim();
    const defaultVal = PROMPT_DEFAULTS[field].trim();
    const toSave = raw === defaultVal ? '' : raw;
    await c.update(key, toSave, vscode.ConfigurationTarget.Global);
  }
}

export async function restorePromptDefaults(fields?: (keyof PromptFields)[]): Promise<void> {
  const c = getConfig();
  const targets = fields ?? (Object.keys(CONFIG_KEYS) as (keyof PromptFields)[]);
  for (const field of targets) {
    await c.update(CONFIG_KEYS[field], '', vscode.ConfigurationTarget.Global);
  }
}