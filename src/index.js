require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const { processMessage, updateStage, updateStageWithError } = require('./stages');
const { gerarTeste } = require('./api');
const messages = require('./messages');
const menu = require('./menu');
const notifications = require('./notifications');
const sigmaChatbot = require('./sigmaChatbot');

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

    const contact = await message.getContact();
    const userJid = contact.id._serialized; // ID real do usuário (ex: 5511999999999@c.us)
    const adminNumber = process.env.ADMIN_WPP_NUMBER;
    const adminDigits = adminNumber ? adminNumber.replace(/\D/g, '') : null;
    const userDigits = userJid.replace('@c.us', '').replace(/\D/g, '');

    if (adminDigits && userDigits === adminDigits) {
        const bodyRaw = message.body.trim();
        const body = bodyRaw.toLowerCase();
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
                    const msgTeste = messages.fluxos.fimTeste
                        .replace('{servidor}', teste.servidor || '-')
                        .replace('{usuario}', teste.usuario)
                        .replace('{senha}', teste.senha)
                        .replace('{url}', teste.url)
                        .replace('{vencimento}', teste.vencimento);
                    await client.sendMessage(message.from, msgTeste);
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
            await client.sendMessage(message.from, 'Após o pagamento, por favor, envie o comprovante.');
        }

        // Ação para notificar sobre uma nova ativação de app
        if (result.action && result.action.type === 'notify_activation') {
            const adminNumber = process.env.ADMIN_WPP_NUMBER;
            if (adminNumber) {
                const { app, mac, receipt } = result.action.data;
                const adminChatId = `${adminNumber}@c.us`;

                // 1. Formata e envia a mensagem de texto com os dados
                const notificationText = messages.fluxos.notificacaoAtivacao
                    .replace('{nome}', name)
                    .replace('{numero}', userJid.split('@')[0])
                    .replace('{app}', app)
                    .replace('{mac}', mac);
                
                await client.sendMessage(adminChatId, notificationText);

                // 2. Baixa e encaminha o comprovante
                if (receipt && receipt.hasMedia) {
                    console.log('[Ativação] Encaminhando comprovante para o admin...');
                    const media = await receipt.downloadMedia();
                    await client.sendMessage(adminChatId, media, { caption: `Comprovante de ${name} para o app ${app}.` });
                }
                console.log(`✅ Notificação de ativação enviada para ${adminNumber}.`);
            }
        }

        // Ação para encaminhar texto livre ao suporte
        if (result.action && result.action.type === 'notify_text') {
            const adminNumber = process.env.ADMIN_WPP_NUMBER;
            if (adminNumber) {
                const adminChatId = `${adminNumber}@c.us`;
                const { name, number, message: textMessage } = result.action.data;
                const notificationText = messages.fluxos.notificacaoTexto
                    .replace('{nome}', name || 'Cliente')
                    .replace('{numero}', number || '-')
                    .replace('{mensagem}', textMessage || '');
                try {
                    await client.sendMessage(adminChatId, notificationText);
                    console.log(`✅ Mensagem de texto encaminhada para ${adminNumber}.`);
                } catch (e) {
                    console.error(`❌ Erro ao encaminhar mensagem de texto: ${e.message}`);
                }
            } else {
                console.warn("⚠️ ADMIN_WPP_NUMBER não configurado no .env. Texto livre não encaminhado.");
            }
        }

        // Ação de notificar o suporte (ocorre DEPOIS de enviar a mensagem ao cliente)
        // Este bloco agora é isolado para NUNCA travar o bot.
        try {
            if (result.action && result.action.type === 'notify_support') {
                const adminNumber = process.env.ADMIN_WPP_NUMBER;
                if (adminNumber) {
                    const adminChatId = `${adminNumber}@c.us`;
                    const notificationText = messages.fluxos.notificacaoSuporte
                        .replace('{nome}', name)
                        .replace('{numero}', userJid.split('@')[0])
                        .replace('{origem}', result.action.origin || 'Não especificada');
                    
                    // Abordagem final e mais direta para contornar o bug da biblioteca.
                    // Envia a mensagem diretamente para o ID do chat, que é a forma mais fundamental de comunicação.
                    await client.sendMessage(adminChatId, notificationText);
                    console.log(`✅ Notificação de suporte enviada para ${adminNumber}.`);
                } else {
                    console.warn("⚠️ ADMIN_WPP_NUMBER não configurado no .env. Notificação de suporte não enviada.");
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
