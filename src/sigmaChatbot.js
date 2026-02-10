const fs = require('fs');
const path = require('path');
const axios = require('axios');

const LOCAL_CONFIG_PATH = path.join(__dirname, '..', 'config', 'sigma_servers.local.json');
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'sigma_servers.json');
const STATE_DIR = path.join(__dirname, '..', 'data');
const STATE_PATH = path.join(STATE_DIR, 'sigma_state.json');

function ensureStateDir() {
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
    }
}

function loadConfig() {
    try {
        const configPath = fs.existsSync(LOCAL_CONFIG_PATH)
            ? LOCAL_CONFIG_PATH
            : DEFAULT_CONFIG_PATH;
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('[Sigma] Falha ao ler config:', e.message);
    }

    return {
        active: null,
        servers: {}
    };
}

function loadState() {
    try {
        ensureStateDir();
        if (!fs.existsSync(STATE_PATH)) return {};
        const raw = fs.readFileSync(STATE_PATH, 'utf8');
        return JSON.parse(raw || '{}');
    } catch (e) {
        console.error('[Sigma] Falha ao ler estado:', e.message);
        return {};
    }
}

function saveState(state) {
    try {
        ensureStateDir();
        const tmp = `${STATE_PATH}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, STATE_PATH);
    } catch (e) {
        console.error('[Sigma] Falha ao salvar estado:', e.message);
    }
}

function getActiveServerKey(config, state) {
    if (state && state.active) return state.active;
    return config.active || null;
}

function getActiveServer() {
    const config = loadConfig();
    const state = loadState();
    const key = getActiveServerKey(config, state);
    if (!key) return null;
    const server = config.servers ? config.servers[key] : null;
    if (!server) return null;
    return { key, ...server };
}

function setActiveServer(key) {
    const config = loadConfig();
    if (!config.servers || !config.servers[key]) {
        return { ok: false, message: 'Servidor não encontrado.' };
    }
    const state = loadState();
    state.active = key;
    saveState(state);
    return { ok: true, message: `Servidor ativo: ${key}` };
}

function listServers() {
    const config = loadConfig();
    const state = loadState();
    const active = getActiveServerKey(config, state);
    const keys = Object.keys(config.servers || {});
    return { keys, active };
}

function resolveServerKey(config, key) {
    if (!key) return null;
    if (config.servers && config.servers[key]) return key;

    // Alias de compatibilidade (UI usa "star_vizzion", config antigo usa "playdragon").
    if (key === 'star_vizzion' && config.servers && config.servers.playdragon) {
        return 'playdragon';
    }

    return key;
}

function getServerByKey(key) {
    const config = loadConfig();
    const resolved = resolveServerKey(config, key);
    if (!resolved) return null;
    const server = config.servers ? config.servers[resolved] : null;
    if (!server) return null;
    return { key: resolved, ...server };
}

function getPackageId(server, planKey) {
    if (!server || !server.packages) return null;
    if (server.packages[planKey]) return server.packages[planKey];

    // Fallback: trial_iptv/trial_p2p podem nao existir em configs antigos.
    if (String(planKey || '').startsWith('trial_') && server.packages.trial) {
        return server.packages.trial;
    }

    return null;
}

async function createTrialOnServer(serverKey, planKey = 'trial') {
    const server = getServerByKey(serverKey);
    if (!server) {
        return { ok: false, error: 'Servidor Sigma não configurado.' };
    }
    const packageId = getPackageId(server, planKey);
    if (!packageId) {
        return { ok: false, error: `Pacote Sigma não encontrado para '${planKey}'.` };
    }

    const url = `${server.baseUrl.replace(/\/$/, '')}/api/chatbot/${server.chatbotId}/${packageId}`;
    try {
        const res = await axios.post(url, {}, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        });
        return { ok: true, data: res.data };
    } catch (e) {
        const detail = e.response ? e.response.data : e.message;
        return { ok: false, error: detail || 'Falha ao gerar teste Sigma.' };
    }
}

async function createTrial(planKey = 'trial') {
    const active = getActiveServer();
    if (!active) {
        return { ok: false, error: 'Servidor Sigma não configurado.' };
    }
    return createTrialOnServer(active.key, planKey);
}

module.exports = {
    createTrial,
    createTrialOnServer,
    listServers,
    setActiveServer,
    getActiveServer,
    getServerByKey
};
