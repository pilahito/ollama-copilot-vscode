import * as os from 'os';
import { execSync } from 'child_process';
import { findInstalledModel, type TaskModels } from './modelRouter';

export interface ModelRecommendation {
  name: string;
  size: string;
  ram: string;
  speed: string;
  role: string;
  recommended: boolean;
  task?: 'chat' | 'completion' | 'agent';
}

export interface HardwareProfile {
  os: string;
  osLabel: string;
  ramGb: number;
  vramGb: number | null;
  cores: number;
  gpu: string;
  tier: 'basic' | 'normal' | 'good' | 'powerful';
  recommendations: ModelRecommendation[];
  ollamaInstallHint: string;
  /** Plan óptimo chat / autocompletado / agente para este PC. */
  taskPlan: TaskModels;
  /** Comandos ollama pull sugeridos al instalar la extensión. */
  suggestedPulls: string[];
}

function detectGpu(): { name: string; vramGb: number | null } {
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1',
      { encoding: 'utf8', timeout: 1500 }
    ).trim();
    if (out && !out.includes('failed')) {
      const parts = out.split(',').map((s) => s.trim());
      const name = parts[0] ?? out;
      const vramMb = parseInt(parts[1] ?? '', 10);
      const vramGb = Number.isFinite(vramMb) ? Math.round(vramMb / 1024) : null;
      return { name, vramGb };
    }
  } catch { /* sin NVIDIA */ }
  return { name: 'CPU (sin GPU NVIDIA detectada)', vramGb: null };
}

function osLabel(): { os: string; label: string } {
  const p = process.platform;
  if (p === 'linux') {
    try {
      const id = execSync('. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"', {
        encoding: 'utf8',
        timeout: 800,
        shell: '/bin/bash',
      }).trim();
      return { os: 'linux', label: id || 'Linux' };
    } catch {
      return { os: 'linux', label: 'Linux' };
    }
  }
  if (p === 'darwin') { return { os: 'darwin', label: 'macOS' }; }
  if (p === 'win32') { return { os: 'win32', label: 'Windows' }; }
  return { os: p, label: p };
}

/** Perfil según RAM y VRAM (GPU acelera modelos 7b–14b). */
export function tierFromHardware(ramGb: number, vramGb: number | null): HardwareProfile['tier'] {
  const effective = ramGb + (vramGb !== null && vramGb >= 8 ? Math.min(vramGb, 16) * 0.35 : 0);
  if (effective <= 10) { return 'basic'; }
  if (effective <= 18) { return 'normal'; }
  if (effective <= 28) { return 'good'; }
  return 'powerful';
}

function tierFromRam(ramGb: number): HardwareProfile['tier'] {
  return tierFromHardware(ramGb, null);
}

/** Plan de modelos ideal según tier y GPU. */
export function buildTaskPlan(tier: HardwareProfile['tier'], vramGb: number | null): TaskModels {
  const hasGpu = vramGb !== null && vramGb >= 8;

  switch (tier) {
    case 'basic':
      return {
        chat: 'phi3:mini',
        completion: 'qwen2.5-coder:1.5b',
        agent: 'qwen2.5-coder:1.5b',
      };
    case 'normal':
      return {
        chat: 'local-copilot-turbo',
        completion: 'qwen2.5-coder:7b',
        agent: hasGpu ? 'qwen2.5-coder:7b' : 'qwen2.5-coder:7b',
      };
    case 'good':
      return {
        chat: 'local-copilot-turbo',
        completion: 'qwen2.5-coder:7b',
        agent: hasGpu ? 'qwen2.5-coder:14b' : 'qwen2.5-coder:7b',
      };
    case 'powerful':
    default:
      return {
        chat: 'qwen2.5-coder:14b',
        completion: 'qwen2.5-coder:7b',
        agent: 'qwen2.5-coder:14b',
      };
  }
}

function buildRecommendations(
  tier: HardwareProfile['tier'],
  osName: string,
  taskPlan: TaskModels,
  vramGb: number | null
): ModelRecommendation[] {
  const ollamaNote = osName === 'win32'
    ? 'En Windows usa Ollama Desktop o WSL2.'
    : 'En Linux: curl -fsSL https://ollama.com/install.sh | sh';

  const mk = (
    name: string,
    size: string,
    ram: string,
    speed: string,
    role: string,
    recommended: boolean,
    task?: ModelRecommendation['task']
  ): ModelRecommendation => ({ name, size, ram, speed, role, recommended, task });

  const base: Record<HardwareProfile['tier'], ModelRecommendation[]> = {
    basic: [
      mk('qwen2.5-coder:1.5b', '1.1 GB', '~3 GB', '⚡⚡⚡⚡⚡', 'Autocompletado ultrarrápido', true, 'completion'),
      mk('phi3:mini', '2.2 GB', '~4 GB', '⚡⚡⚡⚡', 'Chat ligero', true, 'chat'),
      mk('llama3.2:3b', '2.0 GB', '~5 GB', '⚡⚡⚡⚡', 'Chat alternativo', false, 'chat'),
    ],
    normal: [
      mk('local-copilot-turbo', '4.7 GB', '~6 GB', '⚡⚡⚡⚡', 'Chat diario (recomendado)', true, 'chat'),
      mk('qwen2.5-coder:7b', '4.7 GB', '~8 GB', '⚡⚡⚡', 'Autocompletado + agente', true, 'completion'),
      mk('deepseek-coder:6.7b', '3.8 GB', '~8 GB', '⚡⚡⚡', 'Coder alternativo', false, 'agent'),
      mk('starcoder2:7b', '4.0 GB', '~8 GB', '⚡⚡⚡', 'Código multilenguaje', false, 'completion'),
      mk('llama3.2:3b', '2.0 GB', '~5 GB', '⚡⚡⚡⚡', 'Chat rápido', false, 'chat'),
    ],
    good: [
      mk('qwen2.5-coder:14b', '9 GB', '~16 GB', '⚡⚡', 'Agente / proyectos grandes', true, 'agent'),
      mk('local-copilot-turbo', '4.7 GB', '~8 GB', '⚡⚡⚡⚡', 'Chat rápido', true, 'chat'),
      mk('qwen2.5-coder:7b', '4.7 GB', '~8 GB', '⚡⚡⚡', 'Autocompletado', true, 'completion'),
      mk('deepseek-coder:6.7b', '3.8 GB', '~8 GB', '⚡⚡⚡', 'Coder alternativo', false, 'agent'),
      mk('mistral:7b', '4.1 GB', '~8 GB', '⚡⚡⚡', 'Razonamiento general', false, 'chat'),
    ],
    powerful: [
      mk('qwen2.5-coder:14b', '9 GB', '~16 GB', '⚡⚡', 'Agente experto', true, 'agent'),
      mk('qwen2.5-coder:7b', '4.7 GB', '~8 GB', '⚡⚡⚡', 'Autocompletado rápido', true, 'completion'),
      mk('local-copilot-turbo', '4.7 GB', '~8 GB', '⚡⚡⚡⚡', 'Chat veloz', true, 'chat'),
      mk('qwen2.5:14b', '9 GB', '~16 GB', '⚡⚡', 'Profesor / explicaciones', false, 'chat'),
      mk('codellama:13b', '7.4 GB', '~14 GB', '⚡⚡', 'Código legacy', false, 'agent'),
      mk('llama3.1:8b', '4.7 GB', '~10 GB', '⚡⚡⚡', 'General versátil', false, 'chat'),
    ],
  };

  const list = [...base[tier]];

  if (vramGb !== null && vramGb >= 10) {
    list.unshift(
      mk(
        taskPlan.agent,
        '—',
        `GPU ${vramGb} GB`,
        '⚡⚡⚡',
        `Tu GPU acelera el agente (${taskPlan.agent})`,
        true,
        'agent'
      )
    );
  }

  list.push({
    name: ollamaNote,
    size: '—',
    ram: '—',
    speed: '💡',
    role: 'Instalación Ollama',
    recommended: false,
  });
  return list;
}

/** Comandos pull únicos para un PC nuevo. */
export function buildSuggestedPulls(taskPlan: TaskModels, tier: HardwareProfile['tier']): string[] {
  const pulls = new Set<string>([
    taskPlan.chat,
    taskPlan.completion,
    taskPlan.agent,
  ]);

  if (tier === 'normal') {
    pulls.add('local-copilot-turbo');
    pulls.add('qwen2.5-coder:7b');
  }
  if (tier === 'good' || tier === 'powerful') {
    pulls.add('qwen2.5-coder:14b');
    pulls.add('qwen2.5-coder:7b');
    pulls.add('local-copilot-turbo');
  }
  if (tier === 'basic') {
    pulls.add('qwen2.5-coder:1.5b');
    pulls.add('phi3:mini');
  }

  return [...pulls].filter((p) => !p.startsWith('En '));
}

/** Resuelve plan usando modelos ya instalados cuando existan. */
export function resolveTaskPlanForInstalled(
  taskPlan: TaskModels,
  installed: string[]
): TaskModels {
  const resolve = (name: string) => findInstalledModel(installed, name) ?? name;
  return {
    chat: resolve(taskPlan.chat),
    completion: resolve(taskPlan.completion),
    agent: resolve(taskPlan.agent),
  };
}

let cached: HardwareProfile | null = null;

export function getHardwareProfile(): HardwareProfile {
  if (cached) { return cached; }

  const { os: osId, label } = osLabel();
  const ramGb = Math.round(os.totalmem() / 1024 ** 3);
  const cores = os.cpus().length;
  const gpuInfo = detectGpu();
  const tier = tierFromHardware(ramGb, gpuInfo.vramGb);
  const taskPlan = buildTaskPlan(tier, gpuInfo.vramGb);

  const ollamaNote = osId === 'win32'
    ? 'En Windows: https://ollama.com/download'
    : 'Linux: curl -fsSL https://ollama.com/install.sh | sh';

  cached = {
    os: osId,
    osLabel: label,
    ramGb,
    vramGb: gpuInfo.vramGb,
    cores,
    gpu: gpuInfo.name,
    tier,
    taskPlan,
    suggestedPulls: buildSuggestedPulls(taskPlan, tier),
    recommendations: buildRecommendations(tier, osId, taskPlan, gpuInfo.vramGb),
    ollamaInstallHint: ollamaNote,
  };
  return cached;
}

/** Consejo de modelo Ollama según hardware y tipo de tarea. */
export function buildHardwareAdviceBlock(hw: HardwareProfile, prompt: string): string {
  const heavy = /\b(agente|proyecto\s+completo|plugin|mod\b|bot\s+completo|fullstack|impresionante)\b/i.test(prompt);
  const lines = [
    '## Hardware detectado y modelos Ollama recomendados',
    `- SO: ${hw.osLabel} · RAM: ${hw.ramGb} GB · CPU: ${hw.cores} hilos`,
    `- GPU: ${hw.gpu}${hw.vramGb ? ` (${hw.vramGb} GB VRAM)` : ''}`,
    `- Perfil: **${hw.tier}**`,
    `- **Chat:** \`${hw.taskPlan.chat}\` · **Autocompletado:** \`${hw.taskPlan.completion}\` · **Agente:** \`${hw.taskPlan.agent}\``,
  ];

  const top = hw.recommendations.find((r) => r.recommended && !r.name.startsWith('En ') && r.size !== '—');
  if (top) {
    lines.push(`- **Prioridad:** \`ollama pull ${top.name}\` (${top.role})`);
  }

  if (hw.ramGb < 12 && heavy) {
    lines.push('- ⚠️ Con poca RAM, usa modelos 7b o menos para el agente; 14b puede ir lento o fallar.');
  }
  if (hw.vramGb !== null && hw.vramGb < 8) {
    lines.push('- ⚠️ VRAM limitada: prioriza modelos quantizados (q4) y evita 14b+ en GPU.');
  }
  if (hw.vramGb !== null && hw.vramGb >= 10 && hw.ramGb >= 16) {
    lines.push(`- ✓ Tu GPU (${hw.vramGb} GB) acelera \`${hw.taskPlan.agent}\` y \`${hw.taskPlan.completion}\` con CUDA.`);
  }

  lines.push(`- Instalar Ollama: ${hw.ollamaInstallHint}`);
  lines.push(`- Descargar pack recomendado: ${hw.suggestedPulls.map((p) => `ollama pull ${p}`).join(' · ')}`);
  return lines.join('\n');
}

/** Texto corto para popup de bienvenida al instalar. */
export function buildWelcomeMessage(hw: HardwareProfile): string {
  const gpuLine = hw.vramGb ? ` · GPU ${hw.vramGb} GB` : '';
  return (
    `PC detectado: ${hw.ramGb} GB RAM${gpuLine} (${hw.tier}).\n` +
    `Chat: ${hw.taskPlan.chat}\n` +
    `Autocompletado: ${hw.taskPlan.completion}\n` +
    `Agente: ${hw.taskPlan.agent}\n\n` +
    `Si no tienes modelos: ${hw.suggestedPulls.slice(0, 3).map((p) => `ollama pull ${p}`).join(' → ')}`
  );
}