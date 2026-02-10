const fs = require('fs');
const path = require('path');
const supabase = require('./supabaseClient');

const STATE_DIR = path.join(__dirname, '..', 'data');
const STATE_PATH = path.join(STATE_DIR, 'trial_limits.json');
const TABLE = process.env.BOT_TEST_HISTORY_TABLE || 'bot_test_history';

function ensureStateDir() {
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
    }
}

function loadState() {
    try {
        ensureStateDir();
        if (!fs.existsSync(STATE_PATH)) {
            return { global: {}, users: {} };
        }
        const raw = fs.readFileSync(STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        return {
            global: parsed.global || {},
            users: parsed.users || {}
        };
    } catch (e) {
        console.error('[TrialLimits] Falha ao carregar estado:', e.message);
        return { global: {}, users: {} };
    }
}

function saveState(state) {
    try {
        ensureStateDir();
        const tmp = `${STATE_PATH}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, STATE_PATH);
    } catch (e) {
        console.error('[TrialLimits] Falha ao salvar estado:', e.message);
    }
}

function normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    return digits || null;
}

function getGlobalRemaining(serverKey, cooldownSeconds) {
    if (!serverKey || !cooldownSeconds || cooldownSeconds <= 0) return 0;
    const state = loadState();
    const lastAt = state.global[serverKey];
    if (!lastAt) return 0;
    const elapsed = Date.now() - Number(lastAt);
    const remaining = cooldownSeconds * 1000 - elapsed;
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function markGlobalAttempt(serverKey) {
    if (!serverKey) return;
    const state = loadState();
    state.global[serverKey] = Date.now();
    saveState(state);
}

async function hasUserServer(phoneRaw, serverKey) {
    const phone = normalizePhone(phoneRaw);
    if (!phone || !serverKey) return false;

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from(TABLE)
                .select('id')
                .eq('phone', phone)
                .eq('server_key', serverKey)
                .limit(1);
            if (!error && data && data.length) return true;
            if (error) {
                console.warn('[TrialLimits] Supabase error:', error.message);
            }
        } catch (e) {
            console.warn('[TrialLimits] Supabase exception:', e.message);
        }
    }

    const state = loadState();
    return Boolean(state.users[phone] && state.users[phone][serverKey]);
}

async function recordUserServer(phoneRaw, serverKey) {
    const phone = normalizePhone(phoneRaw);
    if (!phone || !serverKey) return;

    if (supabase) {
        try {
            const { error } = await supabase
                .from(TABLE)
                .insert({ phone, server_key: serverKey });
            if (!error) return;
            // Se ja existe, ok. Outros erros caem no fallback.
            console.warn('[TrialLimits] Supabase insert error:', error.message);
        } catch (e) {
            console.warn('[TrialLimits] Supabase insert exception:', e.message);
        }
    }

    const state = loadState();
    if (!state.users[phone]) state.users[phone] = {};
    state.users[phone][serverKey] = new Date().toISOString();
    saveState(state);
}

module.exports = {
    normalizePhone,
    getGlobalRemaining,
    markGlobalAttempt,
    hasUserServer,
    recordUserServer
};
