import * as os from 'os';
import { execSync } from 'child_process';

export interface ModelRecommendation {
  name: string;
  size: string;
  ram: string;
  speed: string;
  role: string;
  recommended: boolean;
}

export interface HardwareProfile {
  os: string;
  osLabel: string;
  ramGb: number;
  cores: number;
  gpu: string;
  tier: 'basic' | 'normal' | 'good' | 'powerful';
  recommendations: ModelRecommendation[];
}

function detectGpu(): string {
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1',
      { encoding: 'utf8', timeout: 1500 }
    ).trim();
    if (out && !out.includes('failed')) { return out; }
  } catch { /* sin NVIDIA */ }
  return 'CPU (sin GPU NVIDIA detectada)';
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

function tierFromRam(ramGb: number): HardwareProfile['tier'] {
  if (ramGb <= 8)  { return 'basic'; }
  if (ramGb <= 16) { return 'normal'; }
  if (ramGb <= 32) { return 'good'; }
  return 'powerful';
}

function buildRecommendations(tier: HardwareProfile['tier'], osName: string): ModelRecommendation[] {
  const ollamaNote = osName === 'win32'
    ? 'En Windows usa Ollama Desktop o WSL2.'
    : 'En Linux: curl -fsSL https://ollama.com/install.sh | sh';

  const base: Record<HardwareProfile['tier'], ModelRecommendation[]> = {
    basic: [
      { name: 'qwen2.5-coder:1.5b', size: '1.1 GB', ram: '~3 GB', speed: '⚡⚡⚡⚡⚡', role: 'Autocompletado rápido', recommended: true },
      { name: 'phi3:mini', size: '2.2 GB', ram: '~4 GB', speed: '⚡⚡⚡⚡', role: 'Chat ligero', recommended: true },
    ],
    normal: [
      { name: 'local-copilot-turbo', size: '4.7 GB', ram: '~6 GB', speed: '⚡⚡⚡⚡', role: 'Chat + código (recomendado)', recommended: true },
      { name: 'qwen2.5-coder:7b', size: '4.7 GB', ram: '~8 GB', speed: '⚡⚡⚡', role: 'Autocompletado + agente', recommended: true },
      { name: 'llama3.2:3b', size: '2.0 GB', ram: '~5 GB', speed: '⚡⚡⚡⚡', role: 'Chat rápido', recommended: false },
    ],
    good: [
      { name: 'local-copilot-turbo', size: '4.7 GB', ram: '~8 GB', speed: '⚡⚡⚡⚡', role: 'Uso diario', recommended: true },
      { name: 'qwen2.5-coder:14b', size: '9 GB', ram: '~16 GB', speed: '⚡⚡', role: 'Agente / proyectos grandes', recommended: true },
      { name: 'qwen2.5-coder:7b', size: '4.7 GB', ram: '~8 GB', speed: '⚡⚡⚡', role: 'Autocompletado', recommended: false },
    ],
    powerful: [
      { name: 'qwen2.5-coder:14b', size: '9 GB', ram: '~16 GB', speed: '⚡⚡', role: 'Agente experto', recommended: true },
      { name: 'local-copilot-turbo', size: '4.7 GB', ram: '~8 GB', speed: '⚡⚡⚡⚡', role: 'Chat rápido', recommended: true },
      { name: 'llama3.1:8b', size: '4.7 GB', ram: '~10 GB', speed: '⚡⚡⚡', role: 'General', recommended: false },
    ],
  };

  const list = [...base[tier]];
  list.push({
    name: ollamaNote,
    size: '—',
    ram: '—',
    speed: '💡',
    role: 'Instalación',
    recommended: false,
  });
  return list;
}

let cached: HardwareProfile | null = null;

export function getHardwareProfile(): HardwareProfile {
  if (cached) { return cached; }

  const { os: osId, label } = osLabel();
  const ramGb = Math.round(os.totalmem() / 1024 ** 3);
  const cores = os.cpus().length;
  const tier  = tierFromRam(ramGb);

  cached = {
    os: osId,
    osLabel: label,
    ramGb,
    cores,
    gpu: detectGpu(),
    tier,
    recommendations: buildRecommendations(tier, osId),
  };
  return cached;
}