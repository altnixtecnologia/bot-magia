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

function resolveRenewPackage(serverKey, planKey, months, amountCents) {
    const config = loadConfig();
    const server = config.servers ? config.servers[serverKey] : null;
    if (!server) return null;

    if (server.renew && server.renew[planKey] && server.renew[planKey][String(months)]) {
        return server.renew[planKey][String(months)];
    }

    const all = server.packages_all || {};
    const candidates = Object.values(all).filter((p) => {
        if (!p) return false;
        if (String(p.is_trial || '').toLowerCase() === 'yes') return false;
        if (String(p.duration_in || '').toUpperCase() !== 'MONTHS') return false;
        if (Number(p.duration) !== Number(months)) return false;
        return true;
    });

    if (!candidates.length) return null;

    const isP2P = (p) => {
        const name = String(p.name || '').toLowerCase();
        return name.includes('p2p') || name.includes('hibri') || name.includes('peer');
    };

    let filtered = candidates;
    if (planKey === 'diamante') {
        filtered = candidates.filter(isP2P);
    } else if (planKey === 'prata') {
        filtered = candidates.filter((p) => !isP2P(p));
    }

    if (filtered.length === 1) return filtered[0].id;
    if (filtered.length > 1) {
        if (amountCents) {
            const byPrice = filtered.find((p) => Number(p.plan_price || 0) === Number(amountCents));
            if (byPrice) return byPrice.id;
        }
        return filtered[0].id;
    }

    if (amountCents) {
        const byPrice = candidates.find((p) => Number(p.plan_price || 0) === Number(amountCents));
        if (byPrice) return byPrice.id;
    }
    return candidates[0].id;
}

async function apiRequest(serverKey, method, path, data) {
    const server = getServerByKey(serverKey);
    if (!server) throw new Error('Servidor Sigma não configurado.');

    const headers = {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (server.token) headers.Authorization = `Bearer ${server.token}`;

    const base = server.baseUrl.replace(/\/$/, '');
    const url = `${base}${path}`;
    const opts = { headers, timeout: 20000 };

    if (method === 'GET') {
        const res = await axios.get(url, { ...opts, params: data || {} });
        return res.data;
    }

    const res = await axios.post(url, data || {}, opts);
    return res.data;
}

async function findCustomerByUsername(serverKey, username) {
    if (!username) return null;
    const data = await apiRequest(serverKey, 'GET', '/api/customers', { username });
    const list = data && data.data ? data.data : data;
    if (!Array.isArray(list)) return null;
    const exact = list.find((c) => String(c.username) === String(username));
    return exact || list[0] || null;
}

async function renewCustomer(serverKey, username, planKey, months, amountCents) {
    const customer = await findCustomerByUsername(serverKey, username);
    if (!customer || !customer.id) {
        return { ok: false, error: 'Cliente nao encontrado no Sigma.' };
    }

    const packageId = resolveRenewPackage(serverKey, planKey, months, amountCents);
    if (!packageId) {
        return { ok: false, error: 'Pacote de renovacao nao encontrado.' };
    }

    const payload = { package_id: packageId, connections: 1 };
    const res = await apiRequest(serverKey, 'POST', `/api/customers/${customer.id}/renew`, payload);
    return { ok: true, data: res };
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
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            // Alguns painéis bloqueiam requests sem User-Agent.
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (server.token) {
            headers.Authorization = `Bearer ${server.token}`;
        }

        try {
            const res = await axios.post(url, {}, {
                headers,
                timeout: 15000
            });
            return { ok: true, data: res.data };
        } catch (e) {
            const status = e.response ? e.response.status : null;
            // Alguns painéis expõem esse endpoint como GET (link direto), não POST.
            if (status === 404 || status === 405) {
                const res = await axios.get(url, { headers, timeout: 15000 });
                return { ok: true, data: res.data };
            }
            throw e;
        }
    } catch (e) {
        const status = e.response ? e.response.status : null;
        const detail = e.response ? e.response.data : e.message;
        const payload = (typeof detail === 'string') ? detail : JSON.stringify(detail);
        return { ok: false, error: `HTTP ${status || '-'}: ${payload || 'Falha ao gerar teste Sigma.'}` };
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
    getServerByKey,
    renewCustomer,
    resolveRenewPackage
};
