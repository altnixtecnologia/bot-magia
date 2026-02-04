const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { processMessage, updateStage } = require('./stages');
const { gerarTeste } = require('./api');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    }
});

client.on('qr', (qr) => {
    console.log('QR Code recebido! Escaneie abaixo:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot Magia está online e pronto!');
});

client.on('message', async (message) => {
    if (message.isGroup || message.from === 'status@broadcast') return;

    console.log(`Mensagem de ${message.from}: ${message.body}`);

    // Processa a lógica
    const result = await processMessage(message.from, message.body);

    if (!result) return;

    // Se tiver texto para responder
    if (result.text) {
        const chat = await message.getChat();
        await chat.sendStateTyping(); // Mostra "Digitando..."
        
        // Pequeno delay para parecer humano
        setTimeout(async () => {
            await client.sendMessage(message.from, result.text);
            
            // Se a ação for gerar teste, faz isso AGORA
            if (result.action === 'gerar_teste') {
                try {
                    const teste = await gerarTeste();
                    
                    if (teste.sucesso) {
                        const msgTeste = `✅ *Teste Gerado com Sucesso!*\n\n👤 Usuário: *${teste.usuario}*\n🔑 Senha: *${teste.senha}*\n🌐 URL: ${teste.url}\n📅 Vencimento: ${teste.vencimento}\n\nBom divertimento!`;
                        await client.sendMessage(message.from, msgTeste);
                        updateStage(message.from, 0); // Reseta para o menu
                    } else {
                        await client.sendMessage(message.from, "❌ Ops! O sistema de testes está instável ou sem créditos. Por favor, chame o suporte (Opção 4).");
                        updateStage(message.from, 1); // Volta para o menu
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        }, 1000);
    }
});

client.initialize();
