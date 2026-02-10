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

async function gerarTeste(options = null) {
    try {
        const trial = options && options.trial ? options.trial : options;
        const planKey = trial && trial.planKey ? String(trial.planKey) : null; // prata/diamante
        const serverKey = trial && trial.serverKey ? String(trial.serverKey) : null;

        // Sigma Chatbot (se configurado)
        const sigmaServer = sigmaChatbot.getActiveServer?.();
        if (sigmaServer) {
            const packageHint = planKey ? (catalog.getTrialPackageHint(planKey) || 'trial') : 'trial';
            const sigmaKey = serverKey ? catalog.resolveSigmaKey(serverKey) : null;
            const sigmaResult = sigmaKey
                ? await sigmaChatbot.createTrialOnServer(sigmaKey, packageHint)
                : await sigmaChatbot.createTrial(packageHint);
            if (sigmaResult.ok && sigmaResult.data) {
                const payload = sigmaResult.data;
                return {
                    sucesso: true,
                    usuario: payload.username || '-',
                    senha: payload.password || '-',
                    url: payload.dns || payload.payUrl || PANEL_CONFIG.url,
                    vencimento: payload.expiresAtFormatted || payload.expiresAt || "2 horas"
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
