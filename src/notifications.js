const fs = require('fs');
const path = require('path');
const supabase = require('./supabaseClient');
const messages = require('./messages');

const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL ||
    'https://painel-deploy.vercel.app/status.html';
const BUSINESS_TZ_OFFSET_MINUTES = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES ?? '-180');
const PAYMENT_POLL_MINUTES = Number(process.env.PAYMENT_POLL_MINUTES ?? '2');
const DUE_POLL_MINUTES = Number(process.env.DUE_POLL_MINUTES ?? '360');
const PAYMENT_LOOKBACK_DAYS = Number(process.env.PAYMENT_LOOKBACK_DAYS ?? '30');
const NOTIFY_ENABLED = (process.env.NOTIFY_ENABLED ?? 'true').toLowerCase() !== 'false';

const STATE_DIR = path.join(__dirname, '..', 'data');
const STATE_PATH = path.join(STATE_DIR, 'notification_state.json');

function ensureStateDir() {
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
    }
}

function loadState() {
    try {
        ensureStateDir();
        if (!fs.existsSync(STATE_PATH)) {
            return { payments: {}, due: {} };
        }
        const raw = fs.readFileSync(STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        return {
            payments: parsed.payments || {},
            due: parsed.due || {}
        };
    } catch (e) {
        console.error('[Notify] Falha ao carregar estado:', e.message);
        return { payments: {}, due: {} };
    }
}

function saveState(state) {
    try {
        ensureStateDir();
        const tmp = `${STATE_PATH}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, STATE_PATH);
    } catch (e) {
        console.error('[Notify] Falha ao salvar estado:', e.message);
    }
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(Number(value || 0));
}

function dateOnly(date) {
    const d = new Date(date.getTime() + BUSINESS_TZ_OFFSET_MINUTES * 60000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function dateStrToUtcMs(dateStr) {
    const parts = dateStr.split('-').map((v) => Number(v));
    if (parts.length !== 3 || parts.some((v) => Number.isNaN(v))) return null;
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function dayDiff(dateA, dateB) {
    const a = dateStrToUtcMs(dateA);
    const b = dateStrToUtcMs(dateB);
    if (a === null || b === null) return null;
    return Math.round((a - b) / 86400000);
}

function formatDateBr(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function sanitizePhone(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 10) return null;
    return digits;
}

async function sendWhatsApp(client, phone, message) {
    const digits = sanitizePhone(phone);
    if (!digits) return false;
    try {
        const chatId = `${digits}@c.us`;
        await client.sendMessage(chatId, message);
        return true;
    } catch (e) {
        console.error('[Notify] Erro ao enviar WhatsApp:', e.message);
        return false;
    }
}

async function fetchClientsByIds(clientIds) {
    if (!clientIds.length) return [];
    const { data, error } = await supabase
        .from('launcher_config')
        .select('id, client_name, phone, expiration_date, status_token, status, is_trial')
        .in('id', clientIds);
    if (error) {
        console.error('[Notify] Erro ao buscar clientes:', error.message);
        return [];
    }
    return data || [];
}

async function checkPayments(client, state) {
    if (!supabase) return;
    const since = new Date(
        Date.now() - PAYMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
        .from('payments')
        .select('id, client_id, amount, paid_at, status')
        .in('status', ['received', 'confirmed'])
        .gte('paid_at', since)
        .order('paid_at', { ascending: false })
        .limit(200);

    if (error) {
        console.error('[Notify] Erro ao buscar pagamentos:', error.message);
        return;
    }

    const payments = data || [];
    const pending = payments.filter((p) => p && p.id && !state.payments[p.id]);
    if (!pending.length) return;

    const clientIds = [...new Set(pending.map((p) => p.client_id).filter(Boolean))];
    const clients = await fetchClientsByIds(clientIds);
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    for (const payment of pending) {
        const clientRow = clientMap.get(payment.client_id);
        if (!clientRow) continue;

        const name = clientRow.client_name || 'Cliente';
        const expDate = clientRow.expiration_date
            ? dateOnly(new Date(clientRow.expiration_date))
            : null;
        const expBr = expDate ? formatDateBr(expDate) : null;

        let text = messages.notificacoesPagamento?.confirmacao || 'Pagamento confirmado.';
        if (!expBr) {
            text = text.replace('\n\nNovo vencimento: *{vencimento}*', '');
        }
        text = text
            .replace('{nome}', name)
            .replace('{valor}', formatCurrency(payment.amount))
            .replace('{vencimento}', expBr || '-');

        const sent = await sendWhatsApp(client, clientRow.phone, text);
        if (sent) {
            state.payments[payment.id] = new Date().toISOString();
            saveState(state);
        }
    }
}

async function checkDue(client, state) {
    if (!supabase) return;
    let offset = 0;
    const limit = 1000;
    const todayStr = dateOnly(new Date());

    while (true) {
        const { data, error } = await supabase
            .from('launcher_config')
            .select('id, client_name, phone, expiration_date, status_token, status, is_trial')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('[Notify] Erro ao buscar clientes:', error.message);
            return;
        }
        const clients = data || [];
        if (!clients.length) break;

        for (const row of clients) {
            if (!row || !row.expiration_date) continue;
            if (row.status === 'blocked') continue;
            if (row.is_trial === true) continue;
            if (!row.phone || !row.status_token) continue;

            const expDateStr = dateOnly(new Date(row.expiration_date));
            const diff = dayDiff(expDateStr, todayStr);
            let keyType = null;
            let template = null;

            if (diff === 5) {
                keyType = 'pre';
                template = messages.notificacoesVencimento?.preVencimento;
            } else if (diff === 0) {
                keyType = 'today';
                template = messages.notificacoesVencimento?.venceHoje;
            } else if (diff === -2) {
                keyType = 'after2';
                template = messages.notificacoesVencimento?.vencido;
            }

            if (!template || !keyType) continue;
            const stateKey = `${row.id}|${keyType}|${expDateStr}`;
            if (state.due[stateKey]) continue;

            const link = `${MAGIC_LINK_BASE_URL}?t=${row.status_token}`;
            const text = template
                .replace('{nome}', row.client_name || 'Cliente')
                .replace('{data_vencimento}', formatDateBr(expDateStr))
                .replace('{link}', link);

            const sent = await sendWhatsApp(client, row.phone, text);
            if (sent) {
                state.due[stateKey] = new Date().toISOString();
                saveState(state);
            }
        }

        offset += clients.length;
        if (clients.length < limit) break;
    }
}

function cleanupState(state) {
    const now = Date.now();
    const maxAge = 90 * 24 * 60 * 60 * 1000;
    const clean = (bucket) => {
        for (const key of Object.keys(bucket)) {
            const ts = Date.parse(bucket[key]);
            if (!Number.isNaN(ts) && now - ts > maxAge) {
                delete bucket[key];
            }
        }
    };
    clean(state.payments);
    clean(state.due);
}

function start(client) {
    if (!NOTIFY_ENABLED) {
        console.log('[Notify] Agendador desativado via NOTIFY_ENABLED=false');
        return;
    }
    if (!supabase) {
        console.warn('[Notify] Supabase não configurado. Notificações desativadas.');
        return;
    }

    const state = loadState();
    cleanupState(state);
    saveState(state);

    const runPayments = async () => {
        try {
            await checkPayments(client, state);
        } catch (e) {
            console.error('[Notify] Erro em checkPayments:', e.message);
        }
    };

    const runDue = async () => {
        try {
            await checkDue(client, state);
        } catch (e) {
            console.error('[Notify] Erro em checkDue:', e.message);
        }
    };

    runPayments();
    runDue();

    setInterval(runPayments, PAYMENT_POLL_MINUTES * 60 * 1000);
    setInterval(runDue, DUE_POLL_MINUTES * 60 * 1000);

    console.log(
        `[Notify] Agendador iniciado. Pagamentos: ${PAYMENT_POLL_MINUTES} min | Vencimentos: ${DUE_POLL_MINUTES} min`
    );
}

module.exports = { start };
