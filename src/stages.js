const menu = require('./menu');
const messages = require('./messages');
const catalog = require('./catalog');
const supabase = require('./supabaseClient');
const axios = require('axios');
const activationData = require('./activation_data');
const { QrCodePix } = require('qrcode-pix');

// --- CONFIGURAÇÃO DO BANCO DE DADOS (AJUSTADO PARA SUA ESTRUTURA) ---
const DB_CONFIG = {
    TABLE: 'launcher_config',       // Sua tabela de clientes da Launcher
    COL_PHONE: 'phone',             // Sua coluna com o número de telefone
    COL_NAME: 'client_name',        // Sua coluna com o nome do cliente
    COL_TOKEN: 'status_token',      // Sua coluna com o token para o Link Mágico
    COL_MAGIA_ID: 'magia_id',       // Sua coluna com o ID Magia
    COL_STATUS: 'status'            // Sua coluna com o status do cliente
};

// Palavras-chave que reiniciam a conversa
const GREETING_KEYWORDS = new Set([
    'oi', 'olá', 'menu', 'começar', 'bom dia', 'boa tarde', 'boa noite',
    'dia', 'tarde', 'noite', 'e ai', 'opa'
]);

// Armazena o estado do usuário: { stage, lastInteraction, name, firstContactToday }
const userStages = {};

const TIMEOUT_MS = 20 * 60 * 1000; // 20 minutos
const MAX_IDLE_MS = 6 * 60 * 60 * 1000; // 6 horas
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

function isGreeting(msg) {
    return GREETING_KEYWORDS.has(msg);
}

function formatNumbered(items, getLine) {
    return items.map((it, idx) => `${idx + 1} - ${getLine(it)}`).join('\n');
}

function buildTrialDevicePrompt() {
    const devices = catalog.listDeviceTypes();
    const list = formatNumbered(devices, (d) => d.label);
    return (
        'Antes de gerar seu teste, qual aparelho voce usa?\n\n' +
        `${list}\n\n` +
        'Digite o numero correspondente.\n' +
        '(Ou digite *P* para teste rapido)\n' +
        '(Digite *V* ou *0* para voltar)'
    );
}

function buildTrialPlanPrompt(deviceType) {
    const plans = catalog.listPlansForDevice(deviceType);
    if (!plans.length) return null;
    const list = formatNumbered(plans, (p) => p.label);
    return (
        'Qual plano voce quer testar?\n\n' +
        `${list}\n\n` +
        'Digite o numero correspondente.\n' +
        '(Digite *V* ou *0* para voltar)'
    );
}

function buildTrialServerPrompt(deviceType, planKey) {
    const servers = catalog.listTrialServersFor(deviceType, planKey);
    if (!servers.length) return { text: null, servers: [] };
    const list = formatNumbered(servers, (s) => s.label);
    return {
        text:
            'Escolha o servidor para o teste:\n\n' +
            `${list}\n\n` +
            'Digite o numero correspondente.\n' +
            '(Digite *V* ou *0* para voltar)',
        servers
    };
}

// Limpa estados antigos para evitar crescimento indefinido em memória
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, state] of Object.entries(userStages)) {
        if (!state || !state.lastInteraction) {
            delete userStages[userId];
            continue;
        }
        if (now - state.lastInteraction > MAX_IDLE_MS) {
            delete userStages[userId];
        }
    }
}, CLEANUP_INTERVAL_MS);
if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref();
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return messages.saudacao.manha;
    if (hour >= 12 && hour < 18) return messages.saudacao.tarde;
    if (hour >= 18 || hour < 24) return messages.saudacao.noite;
    return messages.saudacao.madrugada;
}

function getUserState(from) {
    if (!userStages[from]) {
        userStages[from] = {
            stage: 0,
            lastInteraction: 0,
            lastDayContacted: null,
            name: '',
            lastError: null, // Para armazenar o contexto de um erro anterior
            isProcessing: false, // Flag para evitar processamento concorrente
            tempData: null, // Para armazenar dados temporários, como a lista de dispositivos
            textModeStartedAt: null // Controle do modo texto livre
        };
    }
    return userStages[from];
}

function updateStage(from, stage, name = '') {
    const state = getUserState(from);
    state.stage = stage;
    state.lastInteraction = Date.now();
    if (name) state.name = name;
}

function updateStageWithError(from, stage, errorType) {
    const state = getUserState(from);
    state.stage = stage;
    state.lastInteraction = Date.now();
    state.lastError = errorType;
    console.log(`[State] User ${from} moved to stage ${stage} with error context: ${errorType}`);
}

/**
 * Encurta uma URL usando a API do is.gd.
 * Tenta criar um link com um alias personalizado; se falhar, cria um aleatório.
 * @param {string} longUrl A URL longa a ser encurtada.
 * @param {string} customAlias O alias personalizado sugerido.
 * @returns {Promise<string>} A URL encurtada ou a URL original em caso de falha.
 */
async function shortenUrl(longUrl, customAlias = '') {
    const encodedUrl = encodeURIComponent(longUrl);
    let apiUrl = `https://is.gd/create.php?format=simple&url=${encodedUrl}`;
    
    if (customAlias) {
        apiUrl += `&shorturl=${customAlias}`;
    }

    try {
        console.log(`[URL Shortener] Tentando encurtar com o alias '${customAlias}'`);
        const response = await axios.get(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' }
        });
        
        if (response.data && !response.data.startsWith('Error:')) {
            console.log(`[URL Shortener] Sucesso: ${response.data}`);
            return response.data;
        } else {
            console.warn(`[URL Shortener] Alias '${customAlias}' falhou: ${response.data}. Tentando com um aleatório.`);
            const randomApiUrl = `https://is.gd/create.php?format=simple&url=${encodedUrl}`;
            const randomResponse = await axios.get(randomApiUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' }
            });
            return (randomResponse.data && !randomResponse.data.startsWith('Error:')) ? randomResponse.data : longUrl;
        }
    } catch (error) {
        console.error('[URL Shortener] Erro crítico ao encurtar URL:', error.message);
        return longUrl; // Retorna a URL original em caso de falha crítica.
    }
}

async function processMessage(from, messageObject, contactName) {
    const state = getUserState(from);
    const now = Date.now();
    const today = new Date().toLocaleDateString();
    const msg = messageObject.body.toLowerCase().trim();

    // 1. Comando global de SAÍDA (prioridade máxima)
    if (msg === 's') {
        updateStage(from, 0);
        return { text: messages.menu.sair };
    }

    // 2. Verificação de reset de conversa (inatividade)
    const isInactive = state.stage > 0 && (now - state.lastInteraction) > TIMEOUT_MS;

    // Atualiza o tempo da última interação
    state.lastInteraction = now;
    if (contactName) state.name = contactName;

    if (isInactive) {
        state.stage = 0; // Reseta o estágio para a próxima interação
        state.textModeStartedAt = null;
        return { text: messages.timeout.reset }; // Retorna a mensagem de timeout e encerra
    }

    const textModeExpired = state.stage === 10 &&
        state.textModeStartedAt &&
        (now - state.textModeStartedAt) > TIMEOUT_MS;
    if (textModeExpired) {
        state.stage = 0;
        state.textModeStartedAt = null;
        return { text: messages.timeout.reset };
    }

    let response = "";
    let action = null;

    switch (state.stage) {
        case 0: // Boas-vindas / Início
            // Sempre que a conversa é (re)iniciada, verifica se o contato é um cliente.
            let intro = "";
            let isClient = false;

            if (supabase) {
                try {
                    const cleanPhone = from.replace('@c.us', '');
                    console.log(`[Supabase] Buscando cliente com telefone: ${cleanPhone}`);

                    // Lógica para lidar com o 9º dígito em números brasileiros
                    let phoneVariations = [cleanPhone];
                    if (cleanPhone.startsWith('55')) {
                        const ddd = cleanPhone.substring(2, 4);
                        if (cleanPhone.length === 12) {
                            const number = cleanPhone.substring(4);
                            phoneVariations.push(`55${ddd}9${number}`);
                        } else if (cleanPhone.length === 13 && cleanPhone.charAt(4) === '9') {
                            const number = cleanPhone.substring(5);
                            phoneVariations.push(`55${ddd}${number}`);
                        }
                    }
                    console.log(`[Supabase] Buscando variações de telefone: ${phoneVariations.join(', ')}`);

                    const { data, error } = await supabase
                        .from(DB_CONFIG.TABLE)
                        .select(`${DB_CONFIG.COL_NAME}, ${DB_CONFIG.COL_TOKEN}, ${DB_CONFIG.COL_MAGIA_ID}, ${DB_CONFIG.COL_STATUS}`)
                        .in(DB_CONFIG.COL_PHONE, phoneVariations);

                    if (error) {
                        console.error('[Supabase] A consulta retornou um erro:', error);
                    }

                    if (data && data.length > 0) {
                        isClient = true;
                        if (data.length === 1) {
                            // Cenário 1: Apenas um dispositivo encontrado
                            const clientData = data[0];
                            const clientName = clientData[DB_CONFIG.COL_NAME] || state.name;
                            const magicToken = clientData[DB_CONFIG.COL_TOKEN];
                            const magiaId = clientData[DB_CONFIG.COL_MAGIA_ID];
                            const status = clientData[DB_CONFIG.COL_STATUS];

                            const saudacao = getGreeting();
                            const magicLinkBaseUrl = process.env.MAGIC_LINK_BASE_URL || 'https://seusite.com/status.html';
                            const finalMagicLink = `${magicLinkBaseUrl}?t=${magicToken}`;
                            const alias = from.replace('@c.us', '').substring(2);
                            const shortMagicLink = await shortenUrl(finalMagicLink, alias);
                            
                            intro = `${saudacao}, *${clientName}*!\n\n` +
                                messages.boasVindas.clienteIdentificado
                                    .replace('{link}', shortMagicLink).replace('{magia_id}', magiaId || 'Não informado').replace('{status}', status || 'Não informado');
                            
                            response = `${intro}\n\n${messages.menu.principal}`;
                            updateStage(from, 1);

                        } else {
                            // Cenário 2: Múltiplos dispositivos encontrados
                            state.tempData = data;
                            const clientName = data[0][DB_CONFIG.COL_NAME] || state.name;
                            
                            const deviceList = data.map((device, index) => {
                                const deviceName = device[DB_CONFIG.COL_NAME] || `Dispositivo ${index + 1}`;
                                const magiaId = device[DB_CONFIG.COL_MAGIA_ID] || 'Sem ID';
                                return `${index + 1}. ${deviceName} (${magiaId})`;
                            }).join('\n');

                            intro = messages.boasVindas.multiplosDispositivos
                                .replace('{nome}', clientName)
                                .replace('{lista_dispositivos}', deviceList);
                            
                            response = intro;
                            updateStage(from, 6);
                            return { text: response, action: null }; // Sai para aguardar a escolha
                        }
                    } else {
                        console.log(`[Supabase] Nenhum cliente encontrado para as variações de telefone.`);
                    }
                } catch (err) {
                    console.error("[Supabase] Erro CRÍTICO ao consultar o banco de dados:", err);
                }
            }

            // Se não for um cliente, usa a lógica de saudação padrão
            if (!isClient) {
                if (state.lastDayContacted !== today) {
                    intro = messages.boasVindas.novoContato.replace('{nome}', state.name);
                } else {
                    intro = messages.boasVindas.retorno.replace('{nome}', state.name);
                }
                response = `${intro}\n\n${messages.menu.principal}`;
                updateStage(from, 1);
            }

            // Atualiza o dia do último contato para todos os casos
            state.lastDayContacted = today;
            break;

        case 1: // Menu Principal
            switch (msg) {
                case '1':
                    response = `${menu.tv.titulo}\n\n${menu.tv.opcoes.join('\n')}\n\nDigite *T* para Teste, ou digite *V* ou *0* para voltar ao menu principal.`;
                    updateStage(from, 2);
                    break;
                case '2':
                    state.tempData = { flow: 'trial' };
                    response = buildTrialDevicePrompt();
                    updateStage(from, 11);
                    break;
                case '3':
                    response = messages.fluxos.suporte;
                    // Verifica se o último erro foi uma falha de teste
                    const origin = state.lastError === 'test_failure' ? 'Falha ao Gerar Teste' : 'Menu Principal';
                    action = { type: 'notify_support', origin: origin };
                    state.lastError = null; // Limpa o erro após tratar
                    break;
                case '4':
                    // Constrói a lista numerada de aplicativos
                    const appListText = menu.apps.opcoes.map((appName, index) => {
                        return `${index + 1} - ${appName}`;
                    }).join('\n');
                    response = `${menu.apps.titulo}\n\n${appListText}\n\nPor favor, digite o *número* do aplicativo que deseja ativar ou digite *V* ou *0* para voltar.`;
                    updateStage(from, 5);
                    break;
                case 't':
                    response = messages.fluxos.textoLivre;
                    state.textModeStartedAt = now;
                    updateStage(from, 10);
                    break;
                default:
                    // Se não for uma opção válida, verifica se é uma saudação para reiniciar
                    if (isGreeting(msg)) {
                        state.stage = 0;
                        return processMessage(from, messageObject, contactName);
                    }
                    response = messages.menu.opcaoInvalida;
                    break;
            }
            break;

        case 2: // Planos TV
            switch (msg) {
                case '0': // Voltar ao início
                case 'v': // Voltar
                    state.stage = 0; // Força um reinício para mostrar o menu principal
                    return processMessage(from, { body: 'menu' }, contactName);
                case 't':
                    state.tempData = { flow: 'trial' };
                    response = buildTrialDevicePrompt();
                    updateStage(from, 11);
                    break;
                default:
                    if (isGreeting(msg)) {
                        state.stage = 0;
                        return processMessage(from, messageObject, contactName);
                    }
                    response = `${messages.menu.opcaoInvalida}\n\nDigite *T* para gerar um Teste, ou digite *V* ou *0* para voltar ao menu principal.`;
                    break;
            }
            break;

        case 11: { // Teste - tipo de aparelho
            if (msg === '0' || msg === 'v') {
                state.stage = 0;
                state.tempData = null;
                return processMessage(from, { body: 'menu' }, contactName);
            }

            if (msg === 'p') {
                const deviceType = 'smart_no_android';
                const planKey = 'prata';
                const servers = catalog.listTrialServersFor(deviceType, planKey) || [];
                const iptvOnly = servers.filter((s) =>
                    (s.capabilities || []).includes('iptv') &&
                    !(s.capabilities || []).includes('p2p') &&
                    !(s.capabilities || []).includes('web')
                );
                const chosen = iptvOnly[0] || null;

                if (!chosen) {
                    response = 'Teste rapido indisponivel no momento. Digite *0* para voltar ao menu.';
                    updateStage(from, 1);
                    state.tempData = null;
                    break;
                }

                response = messages.fluxos.gerandoTeste;
                action = {
                    type: 'gerar_teste',
                    trial: { deviceType, planKey, serverKey: chosen.key, allowFallback: true }
                };
                updateStage(from, 11);
                break;
            }

            const devices = catalog.listDeviceTypes();
            const idx = parseInt(msg, 10) - 1;
            if (!Number.isNaN(idx) && idx >= 0 && idx < devices.length) {
                const deviceType = devices[idx].key;
                state.tempData = { flow: 'trial', deviceType };

                const plans = catalog.listPlansForDevice(deviceType);
                if (plans.length === 1) {
                    const planKey = plans[0].key;
                    state.tempData.planKey = planKey;
                    const serverPrompt = buildTrialServerPrompt(deviceType, planKey);
                    if (!serverPrompt.text) {
                        response = 'Nao encontrei servidores disponiveis para esse teste. Digite *0* para voltar ao menu.';
                        updateStage(from, 1);
                        state.tempData = null;
                    } else {
                        response = serverPrompt.text;
                        updateStage(from, 13);
                    }
                } else {
                    const planPrompt = buildTrialPlanPrompt(deviceType);
                    response = planPrompt || 'Configuracao de planos ausente. Digite *0* para voltar ao menu.';
                    updateStage(from, 12);
                }
            } else {
                response = `${messages.menu.opcaoInvalida}\n\n${buildTrialDevicePrompt()}`;
                updateStage(from, 11);
            }
            break;
        }

        case 12: { // Teste - plano (apenas Android)
            if (msg === '0' || msg === 'v') {
                state.stage = 0;
                state.tempData = null;
                return processMessage(from, { body: 'menu' }, contactName);
            }

            const deviceType = state.tempData && state.tempData.deviceType ? String(state.tempData.deviceType) : null;
            if (!deviceType) {
                response = 'Sessao expirada. Vamos voltar ao menu.\n\n' + messages.menu.principal;
                updateStage(from, 1);
                state.tempData = null;
                break;
            }

            const plans = catalog.listPlansForDevice(deviceType);
            const idx = parseInt(msg, 10) - 1;
            if (!Number.isNaN(idx) && idx >= 0 && idx < plans.length) {
                const planKey = plans[idx].key;
                state.tempData.planKey = planKey;
                const serverPrompt = buildTrialServerPrompt(deviceType, planKey);
                if (!serverPrompt.text) {
                    response = 'Nao encontrei servidores disponiveis para esse teste. Digite *0* para voltar ao menu.';
                    updateStage(from, 1);
                    state.tempData = null;
                } else {
                    response = serverPrompt.text;
                    updateStage(from, 13);
                }
            } else {
                const planPrompt = buildTrialPlanPrompt(deviceType);
                response = `${messages.menu.opcaoInvalida}\n\n${planPrompt || ''}`.trim();
                updateStage(from, 12);
            }
            break;
        }

        case 13: { // Teste - escolha do servidor
            if (msg === '0' || msg === 'v') {
                state.stage = 0;
                state.tempData = null;
                return processMessage(from, { body: 'menu' }, contactName);
            }

            const deviceType = state.tempData && state.tempData.deviceType ? String(state.tempData.deviceType) : null;
            const planKey = state.tempData && state.tempData.planKey ? String(state.tempData.planKey) : null;
            if (!deviceType || !planKey) {
                response = 'Sessao expirada. Vamos voltar ao menu.\n\n' + messages.menu.principal;
                updateStage(from, 1);
                state.tempData = null;
                break;
            }

            const { servers } = buildTrialServerPrompt(deviceType, planKey);
            const idx = parseInt(msg, 10) - 1;
            if (!Number.isNaN(idx) && idx >= 0 && idx < servers.length) {
                const chosen = servers[idx];
                response = messages.fluxos.gerandoTeste;
                action = {
                    type: 'gerar_teste',
                    trial: { deviceType, planKey, serverKey: chosen.key, allowFallback: false }
                };
                updateStage(from, 13);
                state.tempData = null;
            } else {
                const serverPrompt = buildTrialServerPrompt(deviceType, planKey);
                response = `${messages.menu.opcaoInvalida}\n\n${serverPrompt.text || ''}`.trim();
                updateStage(from, 13);
            }
            break;
        }

        case 6: // Escolha de Dispositivo
            if (msg === '0' || msg === 'v') {
                state.stage = 0;
                state.tempData = null; // Limpa dados temporários
                return processMessage(from, { body: 'menu' }, contactName);
            }

            const choice = parseInt(msg, 10) - 1;
            const devices = state.tempData;

            if (devices && choice >= 0 && choice < devices.length) {
                const chosenDevice = devices[choice];
                const clientName = chosenDevice[DB_CONFIG.COL_NAME] || state.name;
                const magicToken = chosenDevice[DB_CONFIG.COL_TOKEN];
                const magiaId = chosenDevice[DB_CONFIG.COL_MAGIA_ID];
                const status = chosenDevice[DB_CONFIG.COL_STATUS];

                const saudacao = getGreeting();
                const magicLinkBaseUrl = process.env.MAGIC_LINK_BASE_URL || 'https://seusite.com/status.html';
                const finalMagicLink = `${magicLinkBaseUrl}?t=${magicToken}`;
                const alias = from.replace('@c.us', '').substring(2);
                const shortMagicLink = await shortenUrl(finalMagicLink, alias);
                
                response = `${saudacao}, *${clientName}*!\n\n` +
                    messages.boasVindas.clienteIdentificado
                        .replace('{link}', shortMagicLink).replace('{magia_id}', magiaId || 'Não informado').replace('{status}', status || 'Não informado');
                
                response += `\n\n${messages.menu.principal}`;
                updateStage(from, 1); // Volta para o menu principal
                state.tempData = null; // Limpa os dados temporários
            } else {
                response = `${messages.menu.opcaoInvalida} Por favor, digite o número correspondente ou digite *V* ou *0* para voltar.`;
                // Mantém no mesmo estágio para o usuário tentar novamente
            }
            break;

        case 5: // Apps (Novo ID)
            if (msg === '0' || msg === 'v') {
                // Volta para o menu principal, que é o estágio 1
                state.stage = 0; // Força um reinício para mostrar o menu principal
                return processMessage(from, { body: 'menu' }, contactName);
            } else {
                // Verifica se a mensagem do usuário corresponde a um app da lista (ignorando maiúsculas/minúsculas)
                const appIndex = parseInt(msg, 10) - 1;
                const appNameFromMenu = menu.apps.opcoes[appIndex];

                // Agora busca o app pelo nome exato pego do menu
                const appEscolhido = appNameFromMenu ? Object.keys(activationData.apps).find(key => key.toLowerCase() === appNameFromMenu.toLowerCase()) : null;
                
                if (appEscolhido) {
                    const appInfo = activationData.apps[appEscolhido];

                    // Roteamento baseado no tipo de ativação
                    switch (appInfo.type) {
                        case 'pix':
                        case 'clouddy': // O fluxo de pagamento é o mesmo, só muda a coleta de dados depois
                            const valorTotal = appInfo.creditos * activationData.valor_credito_brl;
                            state.tempData = { app: appEscolhido, valor: valorTotal, type: appInfo.type }; // Salva o tipo
                            response = `Você escolheu *${appEscolhido}*.\n\n` +
                                       `Custo: *${appInfo.creditos} crédito(s)*\n` +
                                       `Valor total: *R$ ${valorTotal.toFixed(2)}*\n\n` +
                                       `Para confirmar, pague via PIX e nos envie o comprovante.\n\n` +
                                       `Digite *1* para gerar o QR Code PIX ou digite *V* ou *0* para cancelar.`;
                            updateStage(from, 7); // Novo estágio para confirmação de pagamento
                            break;

                        case 'support':
                            response = `A ativação do *${appEscolhido}* é feita diretamente com nosso suporte. Já estou te encaminhando...`;
                            action = { type: 'notify_support', origin: `Ativação Especial: ${appEscolhido}` };
                            updateStage(from, 4); // Manda para o estágio de espera do suporte
                            break;

                        default:
                            response = messages.fluxos.apps;
                            action = { type: 'notify_support', origin: 'Ativação de Apps - Tipo desconhecido' };
                            break;
                    }
                } else {
                    response = `${messages.menu.opcaoInvalida} Por favor, digite o *número* do aplicativo que deseja ativar, ou *V* ou *0* para voltar.`;
                }
            }
            break;

        case 7: // Confirmação de Pagamento PIX
            if (msg === '1') {
                try {
                    if (!state.tempData) {
                        response = "Sessão expirada. Vamos começar novamente.\n\n" + messages.menu.principal;
                        updateStage(from, 1);
                        return { text: response };
                    }
                    const { app, valor } = state.tempData;

                    // Validação para evitar erros
                    if (!activationData.chave_pix || !valor) {
                        console.error("[PIX] Chave ou Valor ausentes nos dados temporários.");
                        response = "Erro técnico ao gerar o pagamento. Por favor, chame o suporte.";
                        updateStage(from, 4); // Manda para o suporte
                        return { text: response };
                    }

                    const qrCodePix = QrCodePix({
                        version: '01',
                        key: activationData.chave_pix,
                        // Normaliza e limita os campos para seguir o padrão do Banco Central
                        name: (activationData.nome_beneficiario || 'Altnix').normalize("NFD").replace(/[\u0300-\u036f]/g, "").substring(0, 25),
                        city: (activationData.cidade_beneficiario || 'SC').normalize("NFD").replace(/[\u0300-\u036f]/g, "").substring(0, 15),
                        message: `Ativacao ${app}`.substring(0, 40), // Mensagem pode ser um pouco maior
                        value: valor,
                    });

                    const copiaECola = qrCodePix.payload();
                    const qrCodeBase64 = await qrCodePix.base64();

                    action = { type: 'send_pix_qr', qrCode: qrCodeBase64, copiaECola: copiaECola };
                    response = `Geramos o PIX para ativação do *${app}*.\n\n` +
                               `Vou te enviar o QR Code como imagem e o código "Copia e Cola" a seguir.`;
                    updateStage(from, 8);
                } catch (error) {
                    console.error('[PIX Error] Falha ao gerar o código PIX:', error);
                    response = "Tivemos um problema ao gerar o seu QR Code. Por favor, tente novamente em instantes ou fale com o suporte.";
                    updateStage(from, 1); // Volta ao menu principal em caso de erro
                }
            } else if (msg === '0' || msg === 'v') {
                response = "Ativação cancelada.\n\n" + messages.menu.principal;
                updateStage(from, 1);
            } else {
                response = `${messages.menu.opcaoInvalida} Digite *1* para gerar o PIX, ou *V* ou *0* para cancelar.`;
            }
            break;

        case 8: // Aguardando comprovante
            if (!state.tempData) {
                response = "Sessão expirada. Vamos começar novamente.\n\n" + messages.menu.principal;
                updateStage(from, 1);
                return { text: response };
            }
            if (messageObject.hasMedia) {
                // Armazena a mensagem com o comprovante para uso posterior
                state.tempData.receiptMessage = messageObject;
                // Pergunta o dado correto baseado no tipo do app (MAC ou Email)
                const isClouddy = state.tempData.type === 'clouddy';
                const prompt = isClouddy ? 'o e-mail da sua conta Clouddy' : 'o código MAC do seu dispositivo';
                const helpText = isClouddy ? '' : '\n\nSe não souber onde encontrar, digite *AJUDA*.';
                response = `Comprovante recebido! ✅\n\nAgora, por favor, digite ${prompt}.${helpText}\n(Ou digite *V* ou *0* para cancelar)`;
                updateStage(from, 9); // Próximo estágio: coletar MAC/Email
            } else if (msg === '0' || msg === 'v') {
                response = "Ativação cancelada.\n\n" + messages.menu.principal;
                updateStage(from, 1);
            } else {
                response = messages.fluxos.aguardandoComprovante;
                // Mantém no mesmo estágio
            }
            break;

        case 9: // Coletando MAC/Key
            if (!state.tempData) {
                response = "Sessão expirada. Vamos começar novamente.\n\n" + messages.menu.principal;
                updateStage(from, 1);
                return { text: response };
            }
            if (msg === '0' || msg === 'v') {
                response = "Ativação cancelada.\n\n" + messages.menu.principal;
                updateStage(from, 1);
            } else if (msg === 'ajuda' && state.tempData.type !== 'clouddy') {
                const prompt = 'o código MAC do seu dispositivo';
                response = messages.fluxos.tutorialMac + `\n\nAssim que encontrar, por favor, digite ${prompt}.`;
                // Mantém no mesmo estágio para aguardar o MAC/Key
            } else {
                const finalData = messageObject.body.trim();
                const { app, receiptMessage } = state.tempData;

                // Prepara a notificação para o admin com todos os dados
                action = {
                    type: 'notify_activation',
                    data: {
                        app: app,
                        mac: finalData, // Contém o MAC ou o Email digitado
                        receipt: receiptMessage // A mensagem original com o comprovante
                    }
                };
                response = "Obrigado! Todas as informações foram enviadas para nossa equipe. Sua ativação será processada em breve. 👨‍💻\n\nDigite *0* para voltar ao menu principal.";
                updateStage(from, 0); // Reseta o fluxo
            }
            break;

        case 10: // Texto livre (encaminhar para suporte)
            if (msg === '0' || msg === 'v') {
                state.stage = 0;
                state.textModeStartedAt = null;
                return processMessage(from, { body: 'menu' }, contactName);
            }

            action = {
                type: 'notify_text',
                data: {
                    name: contactName || state.name || 'Cliente',
                    number: from.replace('@c.us', ''),
                    message: messageObject.body
                }
            };
            response = messages.fluxos.textoLivreConfirmacao;
            updateStage(from, 10);
            break;

        case 4: // Fim / Suporte (estado terminal)
            if (msg === '0' || msg === 'v') {
                state.stage = 0; // Força um reinício para mostrar o menu principal
                return processMessage(from, { body: 'menu' }, contactName);
            }
            // Se não for '0', não faz nada, aguardando o atendente humano.
            return null; 

        default:
            console.error(`Estado desconhecido: ${state.stage} para o usuário ${from}. Resetando...`);
            // Se chegar aqui, é um erro. A melhor ação é reiniciar a conversa para o usuário.
            state.stage = 0;
            return processMessage(from, { body: 'menu' }, contactName);
    }

    return { text: response, action: action };
}

module.exports = { processMessage, updateStage, updateStageWithError };
