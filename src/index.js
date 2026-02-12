require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const { processMessage, updateStage, updateStageWithError, confirmActivationPayment } = require('./stages');
const { gerarTeste } = require('./api');
const messages = require('./messages');
const menu = require('./menu');
const notifications = require('./notifications');
const sigmaChatbot = require('./sigmaChatbot');
const trialLimits = require('./trialLimits');
const supportLocks = require('./supportLocks');
const supabaseFunctions = require('./supabaseFunctions');

function parseAdminNumbers() {
    const raw = process.env.ADMIN_WPP_NUMBERS || process.env.ADMIN_WPP_NUMBER || '';
    const parts = String(raw).split(/[,;\s]+/).filter(Boolean);
    const digits = parts
        .map((p) => p.replace(/\D/g, ''))
        .filter((p) => p.length >= 10);
    return Array.from(new Set(digits));
}

function isAdminCommand(rawBody) {
    const body = String(rawBody || '').toLowerCase().trim();
    return (
        body === 'pausados' ||
        body === 'pausos' ||
        body === 'locks' ||
        body === 'servidores' ||
        body === 'servers' ||
        body === 'server list' ||
        body.startsWith('pausar ') ||
        body.startsWith('pause ') ||
        body.startsWith('vencimento ') ||
        body.startsWith('vence ') ||
        body.startsWith('aviso ') ||
        body.startsWith('venc3') ||
        body.startsWith('confirmar ') ||
        body.startsWith('confirma ') ||
        body.startsWith('liberar ') ||
        body.startsWith('unpause ') ||
        body.startsWith('servidor ') ||
        body.startsWith('server ')
    );
}

function buildPhoneCandidates(digits) {
    const set = new Set();
    const add = (v) => {
        const d = String(v || '').replace(/\D/g, '');
        if (d && d.length >= 10) set.add(d);
    };
    add(digits);
    if (digits && !String(digits).startsWith('55') && (String(digits).length === 10 || String(digits).length === 11)) {
        add(`55${digits}`);
    }
    if (digits && String(digits).startsWith('55') && String(digits).length > 11) {
        add(String(digits).slice(2));
    }
    return Array.from(set);
}

async function resolveChatIdForNumber(client, digits) {
    const candidates = buildPhoneCandidates(digits);
    for (const cand of candidates) {
        const chatId = `${cand}@c.us`;
        try {
            if (client && typeof client.getNumberId === 'function') {
                const numberId = await client.getNumberId(chatId);
                if (numberId && numberId._serialized) return numberId._serialized;
            }
            return chatId;
        } catch {
            // tenta o proximo candidato
        }
    }
    return `${digits}@c.us`;
}

function pickRandomItems(items, count) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    const max = Math.min(list.length, Math.max(0, count || 0));
    if (!max) return [];
    for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list.slice(0, max);
}

function buildTestMessage(teste) {
    const isP2P = teste && teste.planKey === 'diamante';
    const lines = [
        '✅ *Teste Gerado com Sucesso!*',
        '',
        `🛰️ Servidor: *${teste.servidor || '-'}*`,
        `👤 Usuário: *${teste.usuario || '-'}*`,
        `🔑 Senha: *${teste.senha || '-'}*`
    ];

    if (!isP2P) {
        if (teste.url) lines.push(`🌐 URL: ${teste.url}`);
    }

    if (teste.vencimento) {
        lines.push(`📅 Vencimento: ${teste.vencimento}`);
    }

    if (!isP2P) {
        if (Array.isArray(teste.m3uOptions) && teste.m3uOptions.length) {
            lines.push('', '📃 Opções M3U:');
            teste.m3uOptions.forEach((opt, idx) => {
                lines.push(`${idx + 1}. ${opt.label}: ${opt.url}`);
            });
        }
        lines.push('', 'Sugerimos o app XCIPTV (gratuito) para testar.');
    } else {
        const p2pApps = Array.isArray(teste.p2pApps) ? teste.p2pApps : [];
        if (p2pApps.length) {
            const count = Math.min(p2pApps.length, Math.random() < 0.5 ? 1 : 2);
            const picked = pickRandomItems(p2pApps, count);
            lines.push('', '📱 Apps P2P sugeridos:');
            picked.forEach((app, idx) => {
                if (!app) return;
                if (app.title) lines.push(`✅ ${app.title}`);
                if (app.link) lines.push(`LINK: ${app.link}`);
                const codes = app.codes && typeof app.codes === 'object' ? app.codes : null;
                if (codes) {
                    Object.entries(codes).forEach(([label, value]) => {
                        if (value) lines.push(`${label}: ${value}`);
                    });
                }
                if (idx < picked.length - 1) lines.push('');
            });
        } else if (teste.p2pAppLink) {
            lines.push('', `Baixe o app: ${teste.p2pAppLink}`);
        } else {
            lines.push('', 'Para P2P, solicite o app com nosso suporte.');
        }
    }

    return lines.join('\n');
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    }
});

// --- API PARA RECEBER NOTIFICAÇÕES ---
const app = express();
app.use(express.json());

const API_PORT = process.env.API_PORT || 3000;
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
    console.warn("⚠️  Aviso: API_TOKEN não foi definido no arquivo .env. O endpoint de notificações está desativado.");
} else {
    app.post('/send-message', async (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${API_TOKEN}`) {
            console.warn('[API] Tentativa de acesso não autorizado.');
            return res.status(403).json({ error: 'Acesso não autorizado.' });
        }

        const { to, message } = req.body;
        if (!to || !message) {
            return res.status(400).json({ error: 'Os campos "to" e "message" são obrigatórios.' });
        }

        try {
            // Formata o número para o padrão do whatsapp-web.js (ex: 5511999999999@c.us)
            const chatId = `${to.replace(/\D/g, '')}@c.us`;
            await client.sendMessage(chatId, message);
            console.log(`[API] Mensagem enviada com sucesso para ${chatId}`);
            res.status(200).json({ success: true, message: `Mensagem enviada para ${to}` });
        } catch (error) {
            console.error(`[API] Erro ao enviar mensagem para ${to}:`, error.message);
            res.status(500).json({ success: false, error: 'Falha ao enviar mensagem via WhatsApp.' });
        }
    });

    app.post('/confirm-activation', async (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${API_TOKEN}`) {
            return res.status(403).json({ error: 'Acesso não autorizado.' });
        }

        const { to } = req.body || {};
        if (!to) {
            return res.status(400).json({ error: 'O campo \"to\" é obrigatório.' });
        }

        const digits = String(to).replace(/\D/g, '');
        if (digits.length < 10) {
            return res.status(400).json({ error: 'Telefone inválido.' });
        }

        const result = confirmActivationPayment(`${digits}@c.us`);
        if (!result.ok) {
            return res.status(400).json({ error: result.error });
        }

        try {
            const chatId = await resolveChatIdForNumber(client, digits);
            await client.sendMessage(chatId, result.message);
            return res.status(200).json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e.message || 'Falha ao enviar mensagem.' });
        }
    });

    app.listen(API_PORT, () => {
        console.log(`🚀 API de notificações rodando na porta ${API_PORT}`);
    });
}

client.on('qr', (qr) => {
    console.log('QR Code recebido! Escaneie abaixo:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot Magia está online e pronto!');
    try {
        notifications.start(client);
    } catch (e) {
        console.error('[Notify] Falha ao iniciar o agendador:', e.message);
    }
});

const userLocks = {}; // Objeto para controlar o processamento por usuário

client.on('message', async (message) => {
    if (message.isGroup || message.from === 'status@broadcast') return;
    const bodyRaw = String(message.body || '').trim();
    const body = bodyRaw.toLowerCase();

    // Evita auto-resposta quando o atendente envia mensagem manual para cliente.
    // Mensagens "fromMe" só passam se forem comandos administrativos.
    if (message.fromMe && !isAdminCommand(body)) return;

    const contact = await message.getContact();
    const userJid = contact.id._serialized; // ID real do usuário (ex: 5511999999999@c.us)
    const adminDigitsList = parseAdminNumbers();
    const userDigits = userJid.replace('@c.us', '').replace(/\D/g, '');

    if (adminDigitsList.length && adminDigitsList.includes(userDigits)) {
        if (body.startsWith('pausar ') || body.startsWith('pause ')) {
            const digits = bodyRaw.replace(/^\S+\s+/, '').replace(/\D/g, '');
            if (!digits) {
                await client.sendMessage(message.from, 'Uso: pausar 5511999999999');
            } else {
                const locked = supportLocks.lockPhone(digits);
                if (locked.ok) {
                    updateStage(`${digits}@c.us`, 4);
                    await client.sendMessage(message.from, `✅ Pausado: ${digits}`);
                } else {
                    await client.sendMessage(message.from, `Erro: ${locked.message}`);
                }
            }
            return;
        }
        if (body.startsWith('vencimento ') || body.startsWith('vence ') || body.startsWith('aviso ')) {
            const parts = bodyRaw.trim().split(/\s+/);
            const digits = parts[1] ? parts[1].replace(/\D/g, '') : '';
            const days = parts[2] ? Number(parts[2]) : 3;
            if (!digits) {
                await client.sendMessage(message.from, 'Uso: vencimento 5511999999999 3');
            } else {
                const result = await notifications.sendManualDueMessage(client, digits, days);
                if (result.ok) {
                    await client.sendMessage(message.from, `✅ Aviso enviado (${days} dias) para ${digits}`);
                } else {
                    await client.sendMessage(message.from, `Erro: ${result.error}`);
                }
            }
            return;
        }
        if (body.startsWith('venc3')) {
            const digits = bodyRaw.replace(/^\S+\s*/, '').replace(/\D/g, '');
            if (!digits) {
                await client.sendMessage(message.from, 'Uso: venc3 5511999999999');
            } else {
                const result = await notifications.sendManualDueMessage(client, digits, 3);
                if (result.ok) {
                    await client.sendMessage(message.from, `✅ Aviso enviado (3 dias) para ${digits}`);
                } else {
                    await client.sendMessage(message.from, `Erro: ${result.error}`);
                }
            }
            return;
        }
        if (body.startsWith('confirmar ') || body.startsWith('confirma ')) {
            const digits = bodyRaw.replace(/^\S+\s+/, '').replace(/\D/g, '');
            if (!digits) {
                await client.sendMessage(message.from, 'Uso: confirmar 5511999999999');
            } else {
                const result = confirmActivationPayment(`${digits}@c.us`);
                if (!result.ok) {
                    await client.sendMessage(message.from, `Erro: ${result.error}`);
                    return;
                }
                try {
                    const chatId = await resolveChatIdForNumber(client, digits);
                    await client.sendMessage(chatId, result.message);
                    await client.sendMessage(message.from, `✅ Confirmado e liberado: ${digits}`);
                } catch (e) {
                    await client.sendMessage(message.from, `Erro ao enviar para o cliente: ${e.message}`);
                }
            }
            return;
        }
        if (body.startsWith('liberar ') || body.startsWith('unpause ')) {
            const digits = bodyRaw.replace(/^\S+\s+/, '').replace(/\D/g, '');
            if (!digits) {
                await client.sendMessage(message.from, 'Uso: liberar 5511999999999');
            } else {
                const unlocked = supportLocks.unlockPhone(digits);
                if (unlocked.ok) {
                    updateStage(`${digits}@c.us`, 0);
                    await client.sendMessage(message.from, `✅ Liberado: ${digits}`);
                } else {
                    await client.sendMessage(message.from, `Erro: ${unlocked.message}`);
                }
            }
            return;
        }
        if (body === 'pausados' || body === 'pausos' || body === 'locks') {
            const list = supportLocks.listLocked();
            const text = list.length
                ? `Pausados (${list.length}):\n` + list.join('\n')
                : 'Nenhum numero pausado.';
            await client.sendMessage(message.from, text);
            return;
        }
        if (body.startsWith('servidor ') || body.startsWith('server ')) {
            const parts = bodyRaw.split(' ');
            const key = parts.slice(1).join(' ').trim();
            if (key) {
                const result = sigmaChatbot.setActiveServer(key);
                await client.sendMessage(message.from, result.ok ? result.message : `Erro: ${result.message}`);
            } else {
                const { keys, active } = sigmaChatbot.listServers();
                const listText = keys.length ? keys.join(', ') : 'nenhum';
                await client.sendMessage(message.from, `Servidores: ${listText}\nAtivo: ${active ?? '-'}`);
            }
            return;
        }
        if (body === 'servidores' || body === 'servers' || body === 'server list') {
            const { keys, active } = sigmaChatbot.listServers();
            const listText = keys.length ? keys.join(', ') : 'nenhum';
            await client.sendMessage(message.from, `Servidores: ${listText}\nAtivo: ${active ?? '-'}`);
            return;
        }
    }

    if (supportLocks.isLocked(userDigits)) {
        return;
    }

    // Trava para impedir processamento concorrente para o mesmo usuário
    if (userLocks[userJid]) {
        console.warn(`⚠️  Mensagem de ${userJid} ignorada: processamento anterior ainda em andamento.`);
        return;
    }

    try {
        userLocks[userJid] = true; // Ativa a trava

        console.log(`Mensagem de ${userJid}: ${message.body}`);

        const name = contact.pushname || contact.name || "Cliente";

        const result = await processMessage(userJid, message, name);

        if (!result) return;

        const chat = await message.getChat();
        await chat.sendStateTyping();

        const gerarTesteAction =
            result.action === 'gerar_teste' ||
            (result.action && typeof result.action === 'object' && result.action.type === 'gerar_teste');

        if (gerarTesteAction) {
            await client.sendMessage(message.from, result.text);
            try {
                const options = (result.action && typeof result.action === 'object') ? result.action : null;
                const teste = await gerarTeste(options);
                if (teste.sucesso) {
                    const msgTeste = buildTestMessage(teste);
                    await client.sendMessage(message.from, msgTeste);
                    if (options && options.trial && options.trial.serverKey) {
                        const phone = userJid.replace('@c.us', '').replace(/\D/g, '');
                        const reg = await supabaseFunctions.registerService({
                            phone,
                            service_key: options.trial.serverKey,
                            login: teste.usuario || null,
                            password: teste.senha || null,
                            notes: 'Teste criado pelo bot'
                        });
                        if (!reg.ok) {
                            console.error('[register-service] Falha:', reg.error);
                        }
                        await trialLimits.recordUserServer(phone, options.trial.serverKey);
                    }
                    updateStage(userJid, 0);
                } else {
                    const errorMessage = teste.erro || messages.fluxos.erroTeste;
                    await client.sendMessage(message.from, errorMessage);
                    updateStageWithError(userJid, 1, 'test_failure');
                }
            } catch (e) {
                console.error("Erro crítico ao gerar teste:", e);
                await client.sendMessage(message.from, messages.fluxos.erroTeste);
            }
        } else if (result.text) {
            await client.sendMessage(message.from, result.text);
        }

        // Ação para enviar o QR Code do PIX como imagem
        if (result.action && result.action.type === 'send_pix_qr') {
            // Envia o QR Code como imagem
            const qrCodeMedia = new MessageMedia('image/png', result.action.qrCode.replace('data:image/png;base64,', ''));
            await client.sendMessage(message.from, qrCodeMedia, { caption: 'Use este QR Code para pagar com a câmera do seu app do banco.' });

            // Envia o "Copia e Cola" em uma mensagem separada para facilitar a cópia
            await client.sendMessage(message.from, result.action.copiaECola);

            // Envia a instrução final após todas as outras mensagens
            await client.sendMessage(
                message.from,
                result.action.postMessage || 'Após o pagamento, por favor, envie o comprovante.'
            );
        }

        // Ação para notificar sobre uma nova ativação de app
        if (result.action && result.action.type === 'notify_activation') {
            if (adminDigitsList.length) {
                const { app, mac, receipt } = result.action.data;

                // 1. Formata e envia a mensagem de texto com os dados
                const notificationText = messages.fluxos.notificacaoAtivacao
                    .replace('{nome}', name)
                    .replace('{numero}', userJid.split('@')[0])
                    .replace('{app}', app)
                    .replace('{mac}', mac);
                
                for (const adminDigits of adminDigitsList) {
                    const adminChatId = `${adminDigits}@c.us`;
                    await client.sendMessage(adminChatId, notificationText);
                }

                // 2. Baixa e encaminha o comprovante
                if (receipt && receipt.hasMedia) {
                    console.log('[Ativação] Encaminhando comprovante para o admin...');
                    const media = await receipt.downloadMedia();
                    for (const adminDigits of adminDigitsList) {
                        const adminChatId = `${adminDigits}@c.us`;
                        await client.sendMessage(adminChatId, media, { caption: `Comprovante de ${name} para o app ${app}.` });
                    }
                }
                console.log(`✅ Notificação de ativação enviada para admins.`);
            }
        }
        if (result.action && result.action.type === 'notify_activation_receipt') {
            if (adminDigitsList.length) {
                const { app, valor, receipt } = result.action.data || {};
                const notificationText = (messages.fluxos.notificacaoComprovanteAtivacao || 'Comprovante recebido.')
                    .replace('{nome}', name)
                    .replace('{numero}', userJid.split('@')[0])
                    .replace('{app}', app || '-')
                    .replace('{valor}', (typeof valor === 'number') ? `R$ ${valor.toFixed(2)}` : (valor ? String(valor) : '-'));

                for (const adminDigits of adminDigitsList) {
                    const adminChatId = `${adminDigits}@c.us`;
                    await client.sendMessage(adminChatId, notificationText);
                }

                if (receipt && receipt.hasMedia) {
                    try {
                        const media = await receipt.downloadMedia();
                        for (const adminDigits of adminDigitsList) {
                            const adminChatId = `${adminDigits}@c.us`;
                            await client.sendMessage(adminChatId, media, { caption: `Comprovante de ${name} (Ativacao ${app || '-'})` });
                        }
                    } catch (e) {
                        console.error('[Ativacao] Falha ao encaminhar comprovante:', e.message);
                    }
                }
            }
        }

        // Ação para encaminhar texto livre ao suporte
        if (result.action && result.action.type === 'notify_text') {
            if (adminDigitsList.length) {
                const { name, number, message: textMessage } = result.action.data;
                const notificationText = messages.fluxos.notificacaoTexto
                    .replace('{nome}', name || 'Cliente')
                    .replace('{numero}', number || '-')
                    .replace('{mensagem}', textMessage || '');
                try {
                    for (const adminDigits of adminDigitsList) {
                        const adminChatId = `${adminDigits}@c.us`;
                        await client.sendMessage(adminChatId, notificationText);
                    }
                    console.log(`✅ Mensagem de texto encaminhada para admins.`);
                } catch (e) {
                    console.error(`❌ Erro ao encaminhar mensagem de texto: ${e.message}`);
                }
            } else {
                console.warn("⚠️ ADMIN_WPP_NUMBER(S) não configurado no .env. Texto livre não encaminhado.");
            }
        }

        // Ação de notificar o suporte (ocorre DEPOIS de enviar a mensagem ao cliente)
        // Este bloco agora é isolado para NUNCA travar o bot.
        try {
            if (result.action && result.action.type === 'notify_support') {
                if (adminDigitsList.length) {
                    const notificationText = messages.fluxos.notificacaoSuporte
                        .replace('{nome}', name)
                        .replace('{numero}', userJid.split('@')[0])
                        .replace('{origem}', result.action.origin || 'Não especificada');
                    
                    // Abordagem final e mais direta para contornar o bug da biblioteca.
                    // Envia a mensagem diretamente para o ID do chat, que é a forma mais fundamental de comunicação.
                    for (const adminDigits of adminDigitsList) {
                        const adminChatId = `${adminDigits}@c.us`;
                        await client.sendMessage(adminChatId, notificationText);
                    }
                    console.log(`✅ Notificação de suporte enviada para admins.`);
                } else {
                    console.warn("⚠️ ADMIN_WPP_NUMBER(S) não configurado no .env. Notificação de suporte não enviada.");
                }
                updateStage(userJid, 4); // Move o cliente para o estágio de espera
            }
        } catch (e) {
            console.error(`❌ Erro ISOLADO ao enviar notificação de suporte. O bot NÃO travou.`);
            console.error(`   CAUSA: A biblioteca 'whatsapp-web.js' falhou ao tentar enviar a mensagem (Error: ${e.message}).`);
            console.error("   AÇÃO: Verifique se o número ADMIN_WPP_NUMBER no .env está 100% correto e se o bot já interagiu com este número.");
            // Mesmo com erro na notificação, o cliente é movido para o estágio de espera.
            updateStage(userJid, 4);
        }
    } catch (e) {
        console.error("Erro fatal no manipulador de mensagens:", e);
    } finally {
        userLocks[userJid] = false; // Libera a trava
    }
});

client.initialize();
