const axios = require('axios');

function getFunctionsBaseUrl() {
    const explicit = process.env.SUPABASE_FUNCTIONS_BASE_URL;
    if (explicit) return String(explicit).replace(/\/$/, '');
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) return null;
    return `${String(supabaseUrl).replace(/\/$/, '')}/functions/v1`;
}

function getBotSecret() {
    return process.env.BOT_SECRET || null;
}

function getAnonKey() {
    return process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || null;
}

async function postFunction(path, body) {
    const base = getFunctionsBaseUrl();
    if (!base) return { ok: false, error: 'SUPABASE_URL nao configurado.' };
    const secret = getBotSecret();
    if (!secret) return { ok: false, error: 'BOT_SECRET nao configurado.' };
    const anonKey = getAnonKey();
    if (!anonKey) return { ok: false, error: 'SUPABASE_KEY (anon) nao configurado.' };

    const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    try {
        const res = await axios.post(url, body || {}, {
            timeout: 20000,
            headers: {
                'Content-Type': 'application/json',
                // Supabase Edge Functions gateway requires Authorization/apikey.
                'apikey': anonKey,
                'Authorization': `Bearer ${anonKey}`,
                'x-bot-secret': secret
            }
        });
        return { ok: true, data: res.data };
    } catch (e) {
        const status = e.response ? e.response.status : null;
        const detail = e.response ? e.response.data : e.message;
        const payload = (typeof detail === 'string') ? detail : JSON.stringify(detail);
        return { ok: false, error: `HTTP ${status || '-'}: ${payload || 'Falha ao chamar function.'}` };
    }
}

async function registerService(payload) {
    return await postFunction('/register-service', payload);
}

async function createPix(payload) {
    return await postFunction('/create-pix', payload);
}

module.exports = {
    registerService,
    createPix
};
