const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'data');
const PATH_STATE = path.join(STATE_DIR, 'activation_pending.json');

function ensureDir() {
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
    }
}

function loadAll() {
    try {
        ensureDir();
        if (!fs.existsSync(PATH_STATE)) return {};
        const raw = fs.readFileSync(PATH_STATE, 'utf8');
        return JSON.parse(raw || '{}') || {};
    } catch (e) {
        console.error('[ActivationPending] Falha ao ler:', e.message);
        return {};
    }
}

function saveAll(state) {
    try {
        ensureDir();
        const tmp = `${PATH_STATE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state || {}, null, 2));
        fs.renameSync(tmp, PATH_STATE);
    } catch (e) {
        console.error('[ActivationPending] Falha ao salvar:', e.message);
    }
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 8) return null;
    return digits;
}

function set(phone, payload) {
    const digits = normalizePhone(phone);
    if (!digits) return { ok: false, error: 'Telefone invalido.' };
    const state = loadAll();
    state[digits] = {
        ts: new Date().toISOString(),
        payload: payload || {}
    };
    saveAll(state);
    return { ok: true };
}

function get(phone) {
    const digits = normalizePhone(phone);
    if (!digits) return null;
    const state = loadAll();
    return state[digits] || null;
}

function clear(phone) {
    const digits = normalizePhone(phone);
    if (!digits) return { ok: false, error: 'Telefone invalido.' };
    const state = loadAll();
    if (state[digits]) {
        delete state[digits];
        saveAll(state);
    }
    return { ok: true };
}

module.exports = {
    set,
    get,
    clear
};

