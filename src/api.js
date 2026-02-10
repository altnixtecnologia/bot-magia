const axios = require('axios');
const sigmaChatbot = require('./sigmaChatbot');
const catalog = require('./catalog');

// --- CONFIGURAÇÃO DO SEU PAINEL ---
const PANEL_CONFIG = {
    // Coloque a URL do painel (ex: http://painel.exemplo.com)
    // NÃO coloque /api_reseller.php no final, o código já faz isso.
    url: process.env.PANEL_URL, 
    username: process.env.PANEL_USER,
    password: process.env.PANEL_PASSWORD,
    apiPath: process.env.PANEL_API_PATH || 'api_reseller.php' // Padrão é 'api_reseller.php', mas pode ser 'panel_api.php'
};

function logSigmaFailure(serverKey, detail) {
    const msg = detail && typeof detail === 'string'
        ? detail
        : (detail && detail.message ? detail.message : 'Falha desconhecida');
    console.error(`[Sigma] Falha ao gerar teste em ${serverKey}: ${msg}`);
}

function extractSigmaReply(detail) {
    if (!detail) return null;
    const text = String(detail);
    const idx = text.indexOf(':');
    const payload = idx >= 0 ? text.slice(idx + 1).trim() : text.trim();
    if (!payload) return null;
    try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed.reply === 'string') return parsed.reply;
        if (parsed && typeof parsed.message === 'string') return parsed.message;
    } catch {
        return null;
    }
    return null;
}

function getServerLabel(serverKey) {
    if (!serverKey) return null;
    try {
        const catalogData = catalog.loadCatalog();
        const server = (catalogData.servers || {})[serverKey];
        return server && server.label ? server.label : serverKey;
    } catch {
        return serverKey;
    }
}

function getServerMeta(serverKey) {
    if (!serverKey) return null;
    try {
        const catalogData = catalog.loadCatalog();
        return (catalogData.servers || {})[serverKey] || null;
    } catch {
        return null;
    }
}

function collectM3uOptions(payload) {
    if (!payload) return [];
    const options = [];
    const seen = new Set();
    const push = (label, url) => {
        if (!url) return;
        const key = String(url);
        if (seen.has(key)) return;
        seen.add(key);
        options.push({ label, url: key });
    };

    push('M3U', payload.m3u_url || payload.m3uUrl);
    push('M3U curto', payload.m3u_url_short || payload.m3uUrlShort);
    push('Playlist', payload.playlist || payload.playlist_url);
    return options;
}

async function gerarTeste(options = null) {
    try {
        const trial = options && options.trial ? options.trial : options;
        const planKey = trial && trial.planKey ? String(trial.planKey) : null; // prata/diamante
        const serverKey = trial && trial.serverKey ? String(trial.serverKey) : null;
        const deviceType = trial && trial.deviceType ? String(trial.deviceType) : null;
        const allowFallback = Boolean(trial && trial.allowFallback);

        // Sigma Chatbot (se configurado)
        const sigmaServer = sigmaChatbot.getActiveServer?.();
        if (sigmaServer) {
            const packageHint = planKey ? (catalog.getTrialPackageHint(planKey) || 'trial') : 'trial';
            const sigmaKey = serverKey ? catalog.resolveSigmaKey(serverKey) : null;
            let sigmaResult = sigmaKey
                ? await sigmaChatbot.createTrialOnServer(sigmaKey, packageHint)
                : await sigmaChatbot.createTrial(packageHint);
            if (sigmaResult.ok && sigmaResult.data) {
                const payload = sigmaResult.data;
                const label = serverKey ? getServerLabel(serverKey) : null;
                const meta = serverKey ? getServerMeta(serverKey) : null;
                const m3uOptions = collectM3uOptions(payload);
                return {
                    sucesso: true,
                    servidor: label || sigmaKey || 'Sigma',
                    usuario: payload.username || '-',
                    senha: payload.password || '-',
                    url: payload.dns || payload.payUrl || PANEL_CONFIG.url,
                    vencimento: payload.expiresAtFormatted || payload.expiresAt || "2 horas",
                    planKey,
                    deviceType,
                    serverKey,
                    m3uOptions,
                    p2pAppLink: meta && meta.p2pAppLink ? meta.p2pAppLink : null,
                    p2pApps: meta && Array.isArray(meta.p2pApps) ? meta.p2pApps : null
                };
            }

            if (sigmaKey) {
                logSigmaFailure(sigmaKey, sigmaResult.error);
            }

            // Fallback automatico para outros servidores compativeis
            if (allowFallback && deviceType && planKey) {
                const candidates = catalog.listServersFor(deviceType, planKey)
                    .map((s) => s.key)
                    .filter((k) => k && k !== serverKey);

                for (const candidate of candidates) {
                    const candidateSigmaKey = catalog.resolveSigmaKey(candidate);
                    const retry = await sigmaChatbot.createTrialOnServer(candidateSigmaKey, packageHint);
                    if (retry.ok && retry.data) {
                        const payload = retry.data;
                        const label = getServerLabel(candidate) || candidate;
                        const meta = getServerMeta(candidate);
                        const m3uOptions = collectM3uOptions(payload);
                        return {
                            sucesso: true,
                            servidor: label,
                            usuario: payload.username || '-',
                            senha: payload.password || '-',
                            url: payload.dns || payload.payUrl || PANEL_CONFIG.url,
                            vencimento: payload.expiresAtFormatted || payload.expiresAt || "2 horas",
                            planKey,
                            deviceType,
                            serverKey: candidate,
                            m3uOptions,
                            p2pAppLink: meta && meta.p2pAppLink ? meta.p2pAppLink : null,
                            p2pApps: meta && Array.isArray(meta.p2pApps) ? meta.p2pApps : null
                        };
                    }
                    logSigmaFailure(candidateSigmaKey, retry.error);
                }
            }

            if (serverKey) {
                const label = getServerLabel(serverKey) || serverKey;
                const reply = extractSigmaReply(sigmaResult.error);
                return {
                    sucesso: false,
                    erro: reply || `Servidor ${label} instavel no momento. Digite *0* para voltar e escolha outro.`
                };
            }
        }

        // Tratamento da URL para evitar erros comuns (barras extras ou inclusão do api_reseller.php no .env)
        let baseUrl = PANEL_CONFIG.url ? PANEL_CONFIG.url.trim() : '';
        
        // Remove barra final se existir
        if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }
        
        // Se o usuário acidentalmente colocou o caminho da API no .env, removemos para não duplicar
        if (baseUrl.endsWith(`/${PANEL_CONFIG.apiPath}`)) {
            baseUrl = baseUrl.replace(`/${PANEL_CONFIG.apiPath}`, '');
        }

        // Monta a URL padrão para painéis Xtream/Sigma
        const apiUrl = `${baseUrl}/${PANEL_CONFIG.apiPath}?action=create_trial&username=${PANEL_CONFIG.username}&password=${PANEL_CONFIG.password}`;
        
        console.log(`Tentando gerar teste em: ${baseUrl}/${PANEL_CONFIG.apiPath}`); 

        const response = await axios.get(apiUrl);
        const data = response.data;

        // Verifica se deu certo (a estrutura depende do seu painel, mas geralmente é assim)
        if (data && (data.user_info || data.username)) {
            // Alguns painéis retornam direto no data, outros dentro de user_info
            const user = data.user_info || data;
            
            return {
                sucesso: true,
                usuario: user.username,
                senha: user.password,
                url: data.server_info ? data.server_info.url : PANEL_CONFIG.url,
                vencimento: user.exp_date ? new Date(user.exp_date * 1000).toLocaleString('pt-BR') : "2 horas"
            };
        } else {
            console.error('Erro retornado pelo painel:', data);
            return { sucesso: false };
        }

    } catch (error) {
        if (error.response) {
            // O servidor respondeu com um status de erro (4xx, 5xx)
            console.error(`❌ Erro retornado pelo painel: Status ${error.response.status}`);
            console.error('Detalhes:', error.response.data);
        } else if (error.request) {
            // A requisição foi feita mas não houve resposta
            console.error('❌ Erro de conexão: Nenhuma resposta recebida do painel. Verifique a URL, porta e se o servidor está online.');
        } else {
            // Algo deu errado ao configurar a requisição
            console.error('❌ Erro ao configurar a requisição:', error.message);
        }
        return { sucesso: false };
    }
}

module.exports = { gerarTeste };
