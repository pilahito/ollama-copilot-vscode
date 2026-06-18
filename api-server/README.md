# 🚀 Ollama API Server - Para Acode y Apps Móviles

Servidor REST que expone tu Ollama local para usar desde **Acode** (Android), apps móviles o cualquier cliente HTTP.

## 📦 Instalación

```bash
cd api-server
npm install
```

## ⚙️ Configuración

1. Copia el archivo de ejemplo:
```bash
cp .env.example .env
```

2. Edita `.env` con tu configuración:
```env
PORT=3000
OLLAMA_URL=http://localhost:11434
DEFAULT_MODEL=llama3.2
API_KEY=tu-clave-secreta-aqui
```

## 🏃 Iniciar el servidor

```bash
# Modo normal
npm start

# Modo desarrollo (auto-reload)
npm run dev
```

## 📱 Configurar en Acode

### 1. Obtén tu IP local

```bash
# Linux
ip addr show | grep "inet " | grep -v 127.0.0.1

# O simplemente
hostname -I
```

### 2. En Acode, configura el plugin de IA:

- **URL del servidor**: `http://TU_IP:3000`
- **API Key**: La que configuraste en `.env`
- **Modelo**: `llama3.2` (o el que tengas)

## 🔌 Endpoints

### `GET /health`
Estado del servidor y conexión con Ollama.

```bash
curl http://localhost:3000/health
```

### `GET /models`
Lista de modelos disponibles.

```bash
curl -H "Authorization: Bearer TU_API_KEY" http://localhost:3000/models
```

### `POST /chat`
Chat con la IA (compatible con formato OpenAI).

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_API_KEY" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hola, ¿cómo estás?"}
    ],
    "model": "llama3.2"
  }'
```

### `POST /complete`
Autocompletado de código.

```bash
curl -X POST http://localhost:3000/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_API_KEY" \
  -d '{
    "prompt": "function suma(a, b) {",
    "model": "codellama:7b"
  }'
```

### `POST /search`
Búsqueda web + respuesta de IA.

```bash
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_API_KEY" \
  -d '{
    "query": "¿Qué es TypeScript?"
  }'
```

### `POST /code/explain`
Explicar código.

```bash
curl -X POST http://localhost:3000/code/explain \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_API_KEY" \
  -d '{
    "code": "const x = arr.filter(n => n > 5).map(n => n * 2);",
    "language": "javascript"
  }'
```

### `POST /code/fix`
Arreglar/mejorar código.

```bash
curl -X POST http://localhost:3000/code/fix \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_API_KEY" \
  -d '{
    "code": "function suma(a, b) { return a + c; }",
    "language": "javascript",
    "issue": "Variable c no está definida"
  }'
```

## 🔒 Seguridad

1. **Siempre configura una API_KEY** en producción
2. **Usa HTTPS** si expones el servidor a internet (con nginx/caddy)
3. **Configura firewall** para limitar acceso por IP

### Ejemplo con nginx (HTTPS):

```nginx
server {
    listen 443 ssl;
    server_name tu-dominio.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🛠️ Integración con Acode Plugins

Si quieres crear un plugin de Acode que use este servidor:

```javascript
// Plugin de Acode - ejemplo
class OllamaPlugin {
  constructor() {
    this.serverUrl = 'http://TU_IP:3000';
    this.apiKey = 'TU_API_KEY';
  }

  async chat(message) {
    const response = await fetch(`${this.serverUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }]
      })
    });
    
    const data = await response.json();
    return data.message.content;
  }

  async complete(code) {
    const response = await fetch(`${this.serverUrl}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ prompt: code })
    });
    
    const data = await response.json();
    return data.completion;
  }
}
```

## 📄 Licencia

MIT © DavidPilahito7
