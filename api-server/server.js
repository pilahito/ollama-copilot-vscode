/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Ollama API Server — Servidor REST COMPLETO para Acode y apps móviles
 *  (c) 2026 DavidPilahito7 · Licensed under the MIT License.
 * ─────────────────────────────────────────────────────────────────────────────
 *  
 *  Servidor sin limitaciones que expone Ollama como API REST completa.
 *  Soporta modo Chat y modo Agente (con modificación de archivos).
 *
 *  Endpoints:
 *    GET  /health           - Estado del servidor
 *    GET  /models           - Lista de modelos disponibles
 *    POST /chat             - Chat con la IA (sin límites)
 *    POST /chat/stream      - Chat con streaming SSE
 *    POST /complete         - Autocompletado de código
 *    POST /generate         - Generación libre de texto
 *    POST /search           - Búsqueda web + IA
 *    POST /agent            - Modo agente (analiza y modifica archivos)
 *    POST /code/explain     - Explicar código
 *    POST /code/fix         - Arreglar código
 *    POST /code/refactor    - Refactorizar código
 *    POST /code/test        - Generar tests
 *    POST /files/read       - Leer archivo remoto
 *    POST /files/write      - Escribir archivo remoto
 *    POST /files/list       - Listar directorio
 *    POST /ollama/*         - Proxy directo a Ollama (sin límites)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */oda

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// ── Configuración ────────────────────────────────────────────────────────────

const CONFIG = {
  port: process.env.PORT || 3000,
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  defaultModel: process.env.DEFAULT_MODEL || 'llama3.2',
  completionModel: process.env.COMPLETION_MODEL || 'codellama:7b',
  apiKey: process.env.API_KEY || '',
  allowedIps: process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : [],
  debug: process.env.DEBUG === 'true'
};

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Logger
app.use((req, res, next) => {
  if (CONFIG.debug) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// Autenticación por API Key
app.use((req, res, next) => {
  // Saltar autenticación para /health
  if (req.path === '/health') return next();
  
  if (CONFIG.apiKey) {
    const authHeader = req.headers.authorization;
    const providedKey = authHeader?.replace('Bearer ', '');
    
    if (providedKey !== CONFIG.apiKey) {
      return res.status(401).json({ 
        error: 'No autorizado',
        message: 'API Key inválida o no proporcionada'
      });
    }
  }
  next();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Realiza una petición HTTP a Ollama
 */
function ollamaRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.ollamaUrl + path);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000 // 2 minutos
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de conexión con Ollama'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Búsqueda web con DuckDuckGo (gratis, sin API key)
 */
async function searchWeb(query) {
  try {
    const fetch = (await import('node-fetch')).default;
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const results = [];
    
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource || 'Resultado',
        url: data.AbstractURL,
        snippet: data.AbstractText.slice(0, 300)
      });
    }
    
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || 'Relacionado',
            url: topic.FirstURL,
            snippet: topic.Text.slice(0, 200)
          });
        }
      }
    }
    
    return results;
  } catch {
    return [];
  }
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /recommend
 * Recomienda modelos de IA según el hardware del usuario
 */
app.get('/recommend', (req, res) => {
  const ram = parseInt(req.query.ram) || 8; // GB de RAM
  const vram = parseInt(req.query.vram) || 0; // GB de VRAM (GPU)
  const cpu = req.query.cpu || 'medium'; // low, medium, high
  
  const recommendations = {
    // ══════════════════════════════════════════════════════════════════════════
    // 🟢 BAJO CONSUMO (4-8 GB RAM, sin GPU dedicada)
    // Para PCs antiguos, laptops básicas, Raspberry Pi
    // ══════════════════════════════════════════════════════════════════════════
    low: {
      category: '🟢 Bajo Consumo',
      description: 'Para PCs con 4-8 GB RAM, sin GPU dedicada',
      models: [
        {
          name: 'tinyllama:1.1b',
          size: '637 MB',
          ram: '2 GB',
          speed: '⚡⚡⚡⚡⚡',
          quality: '⭐⭐',
          best_for: 'Chat básico, respuestas rápidas',
          install: 'ollama pull tinyllama:1.1b'
        },
        {
          name: 'phi3:mini',
          size: '2.2 GB',
          ram: '4 GB',
          speed: '⚡⚡⚡⚡',
          quality: '⭐⭐⭐',
          best_for: 'Código simple, chat, razonamiento básico',
          install: 'ollama pull phi3:mini'
        },
        {
          name: 'gemma:2b',
          size: '1.7 GB',
          ram: '4 GB',
          speed: '⚡⚡⚡⚡',
          quality: '⭐⭐⭐',
          best_for: 'Tareas generales, buen equilibrio',
          install: 'ollama pull gemma:2b'
        },
        {
          name: 'qwen2:1.5b',
          size: '934 MB',
          ram: '3 GB',
          speed: '⚡⚡⚡⚡⚡',
          quality: '⭐⭐⭐',
          best_for: 'Multilingüe, código básico',
          install: 'ollama pull qwen2:1.5b'
        },
        {
          name: 'codegemma:2b',
          size: '1.6 GB',
          ram: '4 GB',
          speed: '⚡⚡⚡⚡',
          quality: '⭐⭐⭐',
          best_for: 'Autocompletado de código',
          install: 'ollama pull codegemma:2b'
        }
      ]
    },
    
    // ══════════════════════════════════════════════════════════════════════════
    // 🟡 CONSUMO MEDIO (8-16 GB RAM, GPU opcional)
    // Para PCs de oficina, laptops gaming entry-level
    // ══════════════════════════════════════════════════════════════════════════
    medium: {
      category: '🟡 Consumo Medio',
      description: 'Para PCs con 8-16 GB RAM, GPU de 4-6 GB opcional',
      models: [
        {
          name: 'llama3.2:3b',
          size: '2.0 GB',
          ram: '6 GB',
          speed: '⚡⚡⚡⚡',
          quality: '⭐⭐⭐⭐',
          best_for: 'Chat inteligente, código, razonamiento',
          install: 'ollama pull llama3.2:3b',
          recommended: true
        },
        {
          name: 'mistral:7b',
          size: '4.1 GB',
          ram: '8 GB',
          speed: '⚡⚡⚡',
          quality: '⭐⭐⭐⭐',
          best_for: 'Muy versátil, excelente calidad/velocidad',
          install: 'ollama pull mistral:7b',
          recommended: true
        },
        {
          name: 'codellama:7b',
          size: '3.8 GB',
          ram: '8 GB',
          speed: '⚡⚡⚡',
          quality: '⭐⭐⭐⭐',
          best_for: 'Programación, autocompletado avanzado',
          install: 'ollama pull codellama:7b'
        },
        {
          name: 'gemma:7b',
          size: '5.0 GB',
          ram: '10 GB',
          speed: '⚡⚡⚡',
          quality: '⭐⭐⭐⭐',
          best_for: 'Tareas generales, muy equilibrado',
          install: 'ollama pull gemma:7b'
        },
        {
          name: 'phi3:medium',
          size: '7.9 GB',
          ram: '12 GB',
          speed: '⚡⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'Razonamiento avanzado, matemáticas',
          install: 'ollama pull phi3:medium'
        },
        {
          name: 'deepseek-coder:6.7b',
          size: '3.8 GB',
          ram: '8 GB',
          speed: '⚡⚡⚡',
          quality: '⭐⭐⭐⭐',
          best_for: 'Código profesional, debugging',
          install: 'ollama pull deepseek-coder:6.7b'
        }
      ]
    },
    
    // ══════════════════════════════════════════════════════════════════════════
    // 🔴 ALTO CONSUMO (16-32 GB RAM, GPU de 8+ GB)
    // Para PCs gaming, workstations
    // ══════════════════════════════════════════════════════════════════════════
    high: {
      category: '🔴 Alto Consumo',
      description: 'Para PCs con 16-32 GB RAM, GPU de 8-12 GB',
      models: [
        {
          name: 'llama3.1:8b',
          size: '4.7 GB',
          ram: '10 GB',
          speed: '⚡⚡⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'Excelente en todo, muy recomendado',
          install: 'ollama pull llama3.1:8b',
          recommended: true
        },
        {
          name: 'codellama:13b',
          size: '7.4 GB',
          ram: '16 GB',
          speed: '⚡⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'Código profesional de alta calidad',
          install: 'ollama pull codellama:13b'
        },
        {
          name: 'mixtral:8x7b',
          size: '26 GB',
          ram: '32 GB',
          speed: '⚡⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'Calidad cercana a GPT-4, muy potente',
          install: 'ollama pull mixtral:8x7b'
        },
        {
          name: 'deepseek-coder:33b',
          size: '19 GB',
          ram: '24 GB',
          speed: '⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'Código de nivel experto',
          install: 'ollama pull deepseek-coder:33b'
        },
        {
          name: 'qwen2:72b',
          size: '41 GB',
          ram: '48 GB',
          speed: '⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'Máxima calidad, rival de GPT-4',
          install: 'ollama pull qwen2:72b'
        }
      ]
    },
    
    // ══════════════════════════════════════════════════════════════════════════
    // 🟣 ULTRA (32+ GB RAM, GPU de 16+ GB)
    // Para servidores, workstations profesionales
    // ══════════════════════════════════════════════════════════════════════════
    ultra: {
      category: '🟣 Ultra / Servidor',
      description: 'Para servidores con 32+ GB RAM, GPU de 16+ GB',
      models: [
        {
          name: 'llama3.1:70b',
          size: '40 GB',
          ram: '48 GB',
          speed: '⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'Calidad de GPT-4, tareas complejas',
          install: 'ollama pull llama3.1:70b'
        },
        {
          name: 'codellama:70b',
          size: '40 GB',
          ram: '48 GB',
          speed: '⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'Código de nivel enterprise',
          install: 'ollama pull codellama:70b'
        },
        {
          name: 'command-r-plus',
          size: '59 GB',
          ram: '64 GB',
          speed: '⚡',
          quality: '⭐⭐⭐⭐⭐',
          best_for: 'RAG, búsqueda, agentes',
          install: 'ollama pull command-r-plus'
        }
      ]
    }
  };
  
  // Determinar categoría según hardware
  let category;
  if (vram >= 16 || ram >= 32) {
    category = 'ultra';
  } else if (vram >= 8 || ram >= 16) {
    category = 'high';
  } else if (ram >= 8) {
    category = 'medium';
  } else {
    category = 'low';
  }
  
  // Si se especifica CPU bajo, bajar un nivel
  if (cpu === 'low' && category !== 'low') {
    category = category === 'ultra' ? 'high' : category === 'high' ? 'medium' : 'low';
  }
  
  res.json({
    detected: {
      ram: `${ram} GB`,
      vram: vram > 0 ? `${vram} GB` : 'Sin GPU dedicada',
      cpu,
      recommendedCategory: category
    },
    recommendations: recommendations[category],
    allCategories: Object.keys(recommendations).map(key => ({
      key,
      ...recommendations[key],
      models: recommendations[key].models.length
    })),
    tips: [
      '💡 Usa modelos cuantizados (q4_0, q4_1) para ahorrar memoria',
      '💡 Cierra otras aplicaciones pesadas antes de usar la IA',
      '💡 Los modelos :latest suelen ser los más optimizados',
      '💡 Si la IA va lenta, prueba un modelo más pequeño',
      '💡 GPU NVIDIA con CUDA acelera mucho la generación'
    ]
  });
});

/**
 * GET /health
 * Estado del servidor y conexión con Ollama
 */
app.get('/health', async (req, res) => {
  try {
    const ollama = await ollamaRequest('GET', '/api/tags');
    res.json({
      status: 'ok',
      server: 'Ollama API Server',
      version: '1.0.0',
      ollama: {
        connected: ollama.status === 200,
        url: CONFIG.ollamaUrl,
        models: ollama.data?.models?.length || 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'degraded',
      server: 'Ollama API Server',
      version: '1.0.0',
      ollama: {
        connected: false,
        url: CONFIG.ollamaUrl,
        error: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /models
 * Lista de modelos disponibles en Ollama
 */
app.get('/models', async (req, res) => {
  try {
    const result = await ollamaRequest('GET', '/api/tags');
    
    if (result.status !== 200) {
      return res.status(502).json({
        error: 'No se pudo conectar con Ollama',
        ollamaUrl: CONFIG.ollamaUrl
      });
    }
    
    const models = result.data?.models?.map(m => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at
    })) || [];
    
    res.json({
      models,
      default: CONFIG.defaultModel,
      completion: CONFIG.completionModel
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /chat
 * Chat con la IA (compatible con formato OpenAI)
 * 
 * Body:
 *   - messages: Array de { role: 'user'|'assistant'|'system', content: string }
 *   - model: (opcional) Modelo a usar
 *   - stream: (opcional) true para streaming
 */
app.post('/chat', async (req, res) => {
  try {
    const { messages, model, stream = false, temperature = 0.7 } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Se requiere un array de messages'
      });
    }
    
    const useModel = model || CONFIG.defaultModel;
    
    if (stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const url = new URL(CONFIG.ollamaUrl + '/api/chat');
      const payload = JSON.stringify({
        model: useModel,
        messages,
        stream: true,
        options: { temperature }
      });
      
      const httpReq = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (httpRes) => {
        httpRes.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              try {
                const json = JSON.parse(line);
                if (json.message?.content) {
                  res.write(`data: ${JSON.stringify({ content: json.message.content })}\n\n`);
                }
                if (json.done) {
                  res.write('data: [DONE]\n\n');
                }
              } catch {}
            }
          }
        });
        httpRes.on('end', () => res.end());
      });
      
      httpReq.on('error', (e) => {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      });
      
      httpReq.write(payload);
      httpReq.end();
    } else {
      // Respuesta normal
      const result = await ollamaRequest('POST', '/api/chat', {
        model: useModel,
        messages,
        stream: false,
        options: { temperature }
      });
      
      if (result.status !== 200) {
        return res.status(502).json({
          error: 'Error en Ollama',
          details: result.data
        });
      }
      
      res.json({
        model: useModel,
        message: result.data.message,
        done: true
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /complete
 * Autocompletado de código
 * 
 * Body:
 *   - prompt: Código a completar
 *   - model: (opcional) Modelo a usar
 *   - suffix: (opcional) Código después del cursor
 */
app.post('/complete', async (req, res) => {
  try {
    const { prompt, model, suffix = '', maxTokens = 128 } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Se requiere prompt' });
    }
    
    const useModel = model || CONFIG.completionModel;
    
    const result = await ollamaRequest('POST', '/api/generate', {
      model: useModel,
      prompt: prompt,
      suffix: suffix,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: maxTokens,
        stop: ['\n\n\n', '```']
      }
    });
    
    if (result.status !== 200) {
      return res.status(502).json({
        error: 'Error en Ollama',
        details: result.data
      });
    }
    
    res.json({
      model: useModel,
      completion: result.data.response || '',
      done: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /search
 * Búsqueda web + respuesta de IA
 * 
 * Body:
 *   - query: Pregunta del usuario
 *   - model: (opcional) Modelo a usar
 */
app.post('/search', async (req, res) => {
  try {
    const { query, model } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Se requiere query' });
    }
    
    // Buscar en internet
    const webResults = await searchWeb(query);
    
    // Construir contexto
    let context = '';
    if (webResults.length > 0) {
      context = '📚 Información de Internet:\n';
      for (const r of webResults) {
        context += `• ${r.title}: ${r.snippet}\n`;
      }
      context += '\n---\nUsa esta información para responder:\n\n';
    }
    
    // Preguntar a la IA
    const useModel = model || CONFIG.defaultModel;
    const result = await ollamaRequest('POST', '/api/chat', {
      model: useModel,
      messages: [
        { role: 'system', content: 'Eres un asistente útil. Responde en español de forma clara y concisa.' },
        { role: 'user', content: context + query }
      ],
      stream: false
    });
    
    res.json({
      model: useModel,
      webResults,
      answer: result.data?.message?.content || 'Sin respuesta',
      done: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /code/explain
 * Explicar código
 */
app.post('/code/explain', async (req, res) => {
  try {
    const { code, language, model } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Se requiere code' });
    }
    
    const useModel = model || CONFIG.defaultModel;
    const result = await ollamaRequest('POST', '/api/chat', {
      model: useModel,
      messages: [
        { 
          role: 'system', 
          content: 'Eres un experto programador. Explica el código de forma clara y en español.' 
        },
        { 
          role: 'user', 
          content: `Explica este código${language ? ` (${language})` : ''}:\n\n\`\`\`${language || ''}\n${code}\n\`\`\`` 
        }
      ],
      stream: false
    });
    
    res.json({
      model: useModel,
      explanation: result.data?.message?.content || 'Sin explicación',
      done: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /code/fix
 * Arreglar/mejorar código
 */
app.post('/code/fix', async (req, res) => {
  try {
    const { code, language, issue, model } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Se requiere code' });
    }
    
    const useModel = model || CONFIG.defaultModel;
    const prompt = issue 
      ? `Arregla este problema en el código: "${issue}"\n\nCódigo:\n\`\`\`${language || ''}\n${code}\n\`\`\``
      : `Mejora y corrige posibles errores en este código:\n\`\`\`${language || ''}\n${code}\n\`\`\``;
    
    const result = await ollamaRequest('POST', '/api/chat', {
      model: useModel,
      messages: [
        { 
          role: 'system', 
          content: 'Eres un experto programador. Devuelve SOLO el código corregido, sin explicaciones.' 
        },
        { role: 'user', content: prompt }
      ],
      stream: false
    });
    
    res.json({
      model: useModel,
      fixedCode: result.data?.message?.content || code,
      done: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /agent
 * Modo agente - Analiza y genera soluciones completas
 */
app.post('/agent', async (req, res) => {
  try {
    const { prompt, query, model, projectPath } = req.body;
    const userPrompt = prompt || query;
    
    if (!userPrompt) {
      return res.status(400).json({ error: 'Se requiere prompt o query' });
    }
    
    const useModel = model || CONFIG.defaultModel;
    
    const systemPrompt = `Eres Local, un ingeniero de software senior EXPERTO y AUTÓNOMO.
Tu misión es resolver problemas de código de forma COMPLETA y PROFESIONAL.

🧠 CAPACIDADES:
- Dominas TODOS los lenguajes: TypeScript, JavaScript, Python, Java, Go, Rust, C++, etc.
- Frameworks: React, Vue, Angular, Next.js, Node.js, Django, FastAPI, Spring, etc.
- DevOps: Docker, Kubernetes, CI/CD, Linux, bases de datos

📋 REGLAS:
1. SIEMPRE genera código COMPLETO y FUNCIONAL
2. Los comentarios van en ESPAÑOL
3. Usa las MEJORES PRÁCTICAS del lenguaje/framework
4. Incluye manejo de errores y documentación

Responde de forma clara y estructurada.`;

    const result = await ollamaRequest('POST', '/api/chat', {
      model: useModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      options: { temperature: 0.7, num_predict: 4096 }
    });
    
    res.json({
      model: useModel,
      explanation: result.data?.message?.content || 'Sin respuesta',
      actions: [],
      done: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /generate
 * Generación libre de texto sin límites
 */
app.post('/generate', async (req, res) => {
  try {
    const { prompt, model, system, temperature = 0.7, maxTokens = 4096 } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Se requiere prompt' });
    }
    
    const useModel = model || CONFIG.defaultModel;
    
    const result = await ollamaRequest('POST', '/api/generate', {
      model: useModel,
      prompt: prompt,
      system: system || '',
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens
      }
    });
    
    res.json({
      model: useModel,
      response: result.data?.response || '',
      done: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /code/refactor
 * Refactorizar código
 */
app.post('/code/refactor', async (req, res) => {
  try {
    const { code, language, instructions, model } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Se requiere code' });
    }
    
    const useModel = model || CONFIG.defaultModel;
    const prompt = instructions 
      ? `Refactoriza este código según estas instrucciones: "${instructions}"\n\nCódigo:\n\`\`\`${language || ''}\n${code}\n\`\`\``
      : `Refactoriza y mejora este código aplicando las mejores prácticas:\n\`\`\`${language || ''}\n${code}\n\`\`\``;
    
    const result = await ollamaRequest('POST', '/api/chat', {
      model: useModel,
      messages: [
        { 
          role: 'system', 
          content: 'Eres un experto programador. Devuelve el código refactorizado con comentarios explicando los cambios importantes.' 
        },
        { role: 'user', content: prompt }
      ],
      stream: false
    });
    
    res.json({
      model: useModel,
      refactoredCode: result.data?.message?.content || code,
      done: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /code/test
 * Generar tests para código
 */
app.post('/code/test', async (req, res) => {
  try {
    const { code, language, framework, model } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Se requiere code' });
    }
    
    const useModel = model || CONFIG.defaultModel;
    const testFramework = framework || (language === 'python' ? 'pytest' : 'jest');
    
    const prompt = `Genera tests completos para este código usando ${testFramework}:\n\`\`\`${language || ''}\n${code}\n\`\`\``;
    
    const result = await ollamaRequest('POST', '/api/chat', {
      model: useModel,
      messages: [
        { 
          role: 'system', 
          content: `Eres un experto en testing. Genera tests completos y bien estructurados usando ${testFramework}. Incluye casos edge y comentarios.` 
        },
        { role: 'user', content: prompt }
      ],
      stream: false
    });
    
    res.json({
      model: useModel,
      tests: result.data?.message?.content || '',
      framework: testFramework,
      done: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /ollama/*
 * Proxy directo a Ollama - SIN LÍMITES
 */
app.all('/ollama/*', async (req, res) => {
  try {
    const ollamaPath = req.path.replace('/ollama', '');
    const method = req.method;
    
    if (method === 'GET') {
      const result = await ollamaRequest('GET', ollamaPath);
      res.status(result.status).json(result.data);
    } else {
      const result = await ollamaRequest(method, ollamaPath, req.body);
      res.status(result.status).json(result.data);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /ollama/chat/stream
 * Streaming directo desde Ollama
 */
app.post('/stream', async (req, res) => {
  try {
    const { messages, model, temperature = 0.7 } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const url = new URL(CONFIG.ollamaUrl + '/api/chat');
    const payload = JSON.stringify({
      model: model || CONFIG.defaultModel,
      messages,
      stream: true,
      options: { temperature }
    });
    
    const httpReq = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (httpRes) => {
      httpRes.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line);
              if (json.message?.content) {
                res.write(`data: ${JSON.stringify({ content: json.message.content })}\n\n`);
              }
              if (json.done) {
                res.write('data: [DONE]\n\n');
              }
            } catch {}
          }
        }
      });
      httpRes.on('end', () => res.end());
    });
    
    httpReq.on('error', (e) => {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });
    
    httpReq.write(payload);
    httpReq.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Iniciar servidor ─────────────────────────────────────────────────────────

app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🚀 Ollama API Server - Para Acode y Apps             ║
╠═══════════════════════════════════════════════════════════════╣
║  Servidor:    http://0.0.0.0:${CONFIG.port.toString().padEnd(30)}║
║  Ollama:      ${CONFIG.ollamaUrl.padEnd(45)}║
║  Modelo:      ${CONFIG.defaultModel.padEnd(45)}║
║  Auth:        ${CONFIG.apiKey ? 'API Key requerida' : 'Deshabilitada (¡configura API_KEY!)'}${' '.repeat(CONFIG.apiKey ? 27 : 10)}║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    GET  /health        - Estado del servidor                  ║
║    GET  /models        - Modelos disponibles                  ║
║    POST /chat          - Chat con IA                          ║
║    POST /complete      - Autocompletado                       ║
║    POST /search        - Búsqueda web + IA                    ║
║    POST /code/explain  - Explicar código                      ║
║    POST /code/fix      - Arreglar código                      ║
╚═══════════════════════════════════════════════════════════════╝

📱 Para usar desde Acode:
   URL: http://TU_IP_LOCAL:${CONFIG.port}
   Header: Authorization: Bearer TU_API_KEY

`);
});
