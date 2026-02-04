const axios = require('axios');

// --- CONFIGURAÇÃO DO SEU PAINEL ---
const PANEL_CONFIG = {
    // Coloque a URL do painel (ex: http://painel.exemplo.com)
    // NÃO coloque /api_reseller.php no final, o código já faz isso.
    url: 'http://url-do-seu-painel.com', 
    username: 'SEU_USUARIO_REVENDEDOR',
    password: 'SUA_SENHA_REVENDEDOR'
};

async function gerarTeste() {
    try {
        // Monta a URL padrão para painéis Xtream/Sigma
        const apiUrl = `${PANEL_CONFIG.url}/api_reseller.php?action=create_trial&username=${PANEL_CONFIG.username}&password=${PANEL_CONFIG.password}`;
        
        console.log("Tentando gerar teste..."); // Log para ajudar a ver erros na VPS

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
        console.error('Erro de conexão com o painel:', error.message);
        return { sucesso: false };
    }
}

module.exports = { gerarTeste };
