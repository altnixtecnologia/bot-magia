const fs = require('fs');
const path = require('path');
const supabase = require('./supabaseClient');
const messages = require('./messages');
const axios = require('axios');
const catalog = require('./catalog');
const sigmaChatbot = require('./sigmaChatbot');

const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL ||
    'https://painel-deploy.vercel.app/status.html';
const BUSINESS_TZ_OFFSET_MINUTES = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES ?? '-180');
const PAYMENT_POLL_MINUTES = Number(process.env.PAYMENT_POLL_MINUTES ?? '2');
const DUE_POLL_MINUTES = Number(process.env.DUE_POLL_MINUTES ?? '360');
const PAYMENT_LOOKBACK_DAYS = Number(process.env.PAYMENT_LOOKBACK_DAYS ?? '30');
const NOTIFY_ENABLED = (process.env.NOTIFY_ENABLED ?? 'true').toLowerCase() !== 'false';
const ADMIN_WPP_NUMBER = process.env.ADMIN_WPP_NUMBER || null;

const MANUAL_RENEW_SERVERS = new Set(['sparkpainel', 'ninety']);

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

function toCents(amount) {
    const n = Number(amount);
    if (Number.isNaN(n)) return null;
    if (n >= 1000) return Math.round(n);
    return Math.round(n * 100);
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

async function shortenUrl(longUrl, customAlias = '') {
    const encodedUrl = encodeURIComponent(longUrl);
    let apiUrl = `https://is.gd/create.php?format=simple&url=${encodedUrl}`;

    if (customAlias) {
        apiUrl += `&shorturl=${customAlias}`;
    }

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
            }
        });
        if (response.data && !response.data.startsWith('Error:')) {
            return response.data;
        }

        const randomApiUrl = `https://is.gd/create.php?format=simple&url=${encodedUrl}`;
        const randomResponse = await axios.get(randomApiUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
            }
        });
        return (randomResponse.data && !randomResponse.data.startsWith('Error:'))
            ? randomResponse.data
            : longUrl;
    } catch (e) {
        return longUrl;
    }
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

async function fetchClientService(clientId) {
    if (!supabase || !clientId) return null;
    const { data, error } = await supabase
        .from('client_services')
        .select('service_name, login, password, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1);
    if (error) {
        console.error('[Notify] Erro ao buscar servicos:', error.message);
        return null;
    }
    return data && data.length ? data[0] : null;
}

function getPhoneVariants(digits) {
    const variants = new Set();
    if (digits) variants.add(digits);
    if (digits && digits.startsWith('55') && digits.length > 11) {
        variants.add(digits.slice(2));
    }
    if (digits && digits.length === 10) {
        variants.add(`55${digits}`);
    }
    if (digits && digits.length === 11) {
        variants.add(`55${digits}`);
    }
    return Array.from(variants);
}

async function fetchClientByPhone(phone) {
    if (!supabase) return { row: null, error: 'Supabase nao configurado.' };
    const digits = sanitizePhone(phone);
    if (!digits) return { row: null, error: 'Telefone invalido.' };

    const variants = getPhoneVariants(digits);
    if (variants.length) {
        const { data, error } = await supabase
            .from('launcher_config')
            .select('id, client_name, phone, expiration_date, status_token, status, is_trial')
            .in('phone', variants);
        if (error) {
            console.error('[Notify] Erro ao buscar cliente por telefone:', error.message);
            return { row: null, error: 'Erro ao buscar cliente.' };
        }
        if (data && data.length === 1) return { row: data[0], error: null };
        if (data && data.length > 1) {
            return { row: null, error: 'Mais de um cliente encontrado. Use o numero completo com DDI.' };
        }
    }

    const last9 = digits.length >= 9 ? digits.slice(-9) : null;
    const last8 = digits.length >= 8 ? digits.slice(-8) : null;
    const orParts = [];
    if (last9) orParts.push(`phone.ilike.%${last9}%`);
    if (last8) orParts.push(`phone.ilike.%${last8}%`);

    if (orParts.length) {
        const { data, error } = await supabase
            .from('launcher_config')
            .select('id, client_name, phone, expiration_date, status_token, status, is_trial')
            .or(orParts.join(','))
            .limit(5);
        if (error) {
            console.error('[Notify] Erro ao buscar cliente por telefone (ilike):', error.message);
            return { row: null, error: 'Erro ao buscar cliente.' };
        }
        if (data && data.length === 1) return { row: data[0], error: null };
        if (data && data.length > 1) {
            return { row: null, error: 'Mais de um cliente encontrado. Use o numero completo com DDI.' };
        }
    }

    return { row: null, error: 'Cliente nao encontrado.' };
}

function addMonths(baseDate, months) {
    const d = new Date(baseDate.getTime());
    const m = d.getMonth() + Number(months || 0);
    d.setMonth(m);
    return d;
}

async function tryAutoRenew(payment, clientRow) {
    if (!payment || !clientRow) return { ok: false, error: 'Dados insuficientes.' };

    const amountCents = toCents(payment.amount);
    const plan = catalog.resolvePlanByAmount(amountCents);
    if (!plan) return { ok: false, error: 'Valor nao corresponde a nenhum plano.' };

    const service = await fetchClientService(payment.client_id);
    if (!service || !service.login || !service.service_name) {
        return { ok: false, error: 'Servico do cliente nao encontrado.' };
    }

    const serverKey = catalog.findServerKeyByLabel(service.service_name);
    if (!serverKey) return { ok: false, error: 'Servidor do cliente nao identificado.' };
    if (!catalog.serverSupportsPlan(serverKey, plan.planKey)) {
        return { ok: false, error: 'Plano nao compativel com o servidor.' };
    }

    let renewMonths = plan.months;
    let manualAdjust = null;
    if (MANUAL_RENEW_SERVERS.has(serverKey) && plan.months !== 1) {
        manualAdjust = {
            requestedMonths: plan.months,
            planKey: plan.planKey
        };
        renewMonths = 1;
    }

    const renew = await sigmaChatbot.renewCustomer(
        serverKey,
        service.login,
        plan.planKey,
        renewMonths,
        amountCents
    );
    if (!renew.ok) return renew;

    // Atualiza vencimento local (estimado) apenas quando nao exige ajuste manual.
    let nextExp = null;
    if (!manualAdjust) {
        const now = new Date();
        const base = clientRow.expiration_date ? new Date(clientRow.expiration_date) : now;
        const start = base > now ? base : now;
        nextExp = addMonths(start, renewMonths);

        try {
            await supabase
                .from('launcher_config')
                .update({ expiration_date: nextExp.toISOString() })
                .eq('id', clientRow.id);
        } catch (e) {
            console.warn('[Notify] Falha ao atualizar vencimento local:', e.message);
        }
    }

    return {
        ok: true,
        nextExp,
        manualAdjust,
        renewMonths,
        plan,
        serverKey,
        service
    };
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

        const autoRenew = await tryAutoRenew(payment, clientRow);
        if (!autoRenew.ok) {
            console.error(`[Renew] Falha pagamento ${payment.id}: ${autoRenew.error}`);
            continue;
        }

        const name = clientRow.client_name || 'Cliente';
        const expDate = autoRenew.nextExp
            ? dateOnly(new Date(autoRenew.nextExp))
            : (clientRow.expiration_date ? dateOnly(new Date(clientRow.expiration_date)) : null);
        let expBr = expDate ? formatDateBr(expDate) : null;
        if (autoRenew.manualAdjust) {
            expBr = null;
        }

        let text = messages.notificacoesPagamento?.confirmacao || 'Pagamento confirmado.';
        if (!expBr) {
            text = text.replace('\n\nNovo vencimento: *{vencimento}*', '');
        }
        text = text
            .replace('{nome}', name)
            .replace('{valor}', formatCurrency(payment.amount))
            .replace('{vencimento}', expBr || '-');
        if (autoRenew.manualAdjust) {
            text += '\n\nNosso suporte ajustara o vencimento conforme o plano pago.';
        }

        const sent = await sendWhatsApp(client, clientRow.phone, text);
        if (sent) {
            state.payments[payment.id] = new Date().toISOString();
            saveState(state);
        }

        if (autoRenew.manualAdjust && ADMIN_WPP_NUMBER) {
            const digits = ADMIN_WPP_NUMBER.replace(/\D/g, '');
            const adminChatId = `${digits}@c.us`;
            const info = [
                '⚠️ Ajuste manual de renovacao necessario',
                `Cliente: ${clientRow.client_name || '-'}`,
                `Telefone: ${clientRow.phone || '-'}`,
                `Servidor: ${autoRenew.serverKey || '-'}`,
                `Login: ${autoRenew.service && autoRenew.service.login ? autoRenew.service.login : '-'}`,
                `Plano: ${autoRenew.plan ? autoRenew.plan.label : '-'}`,
                `Meses pagos: ${autoRenew.manualAdjust.requestedMonths}`,
                `Renovado automaticamente: ${autoRenew.renewMonths} mes`,
                `Valor: ${formatCurrency(payment.amount)}`
            ].join('\n');
            try {
                await client.sendMessage(adminChatId, info);
            } catch (e) {
                console.error('[Notify] Erro ao avisar admin:', e.message);
            }
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

            const longLink = `${MAGIC_LINK_BASE_URL}?t=${row.status_token}`;
            const aliasSeed = String(row.status_token || '')
                .replace(/[^a-zA-Z0-9]/g, '')
                .slice(-8);
            const link = await shortenUrl(longLink, aliasSeed);
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

async function sendManualDueMessage(client, phone, daysAhead = 3) {
    if (!supabase) return { ok: false, error: 'Supabase nao configurado.' };
    const digits = sanitizePhone(phone);
    if (!digits) return { ok: false, error: 'Telefone invalido.' };

    const lookup = await fetchClientByPhone(digits);
    if (!lookup.row) return { ok: false, error: lookup.error || 'Cliente nao encontrado.' };
    const row = lookup.row;
    if (!row.status_token) return { ok: false, error: 'Cliente sem status_token.' };

    const days = Number(daysAhead);
    if (Number.isNaN(days)) return { ok: false, error: 'Dias invalidos.' };

    const exp = new Date();
    exp.setDate(exp.getDate() + days);
    const expDateStr = dateOnly(exp);
    const expBr = formatDateBr(expDateStr);

    let template = null;
    if (days === 0) {
        template = messages.notificacoesVencimento?.venceHoje;
    } else if (days < 0) {
        template = messages.notificacoesVencimento?.vencido;
        if (template && days !== -2) {
            template = template.replace('há 2 dias', `há ${Math.abs(days)} dias`);
        }
    } else {
        template = messages.notificacoesVencimento?.preVencimento;
        if (template && days !== 5) {
            template = template.replace('5 dias', `${days} dias`);
        }
    }

    if (!template) return { ok: false, error: 'Template de vencimento nao encontrado.' };

    const longLink = `${MAGIC_LINK_BASE_URL}?t=${row.status_token}`;
    const aliasSeed = String(row.status_token || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-8);
    const link = await shortenUrl(longLink, aliasSeed);
    const text = template
        .replace('{nome}', row.client_name || 'Cliente')
        .replace('{data_vencimento}', expBr)
        .replace('{link}', link);

    const targetPhone = sanitizePhone(row.phone) || digits;
    const sent = await sendWhatsApp(client, targetPhone, text);
    return sent ? { ok: true } : { ok: false, error: 'Falha ao enviar mensagem.' };
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

module.exports = { start, sendManualDueMessage };
