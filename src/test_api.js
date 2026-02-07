require('dotenv').config();
const axios = require('axios');

async function testApiEndpoint() {
    const url = process.env.PANEL_URL;
    const path = process.env.PANEL_API_PATH;
    const user = process.env.PANEL_USER;
    const pass = process.env.PANEL_PASSWORD;

    if (!url || !path || !user || !pass) {
        console.error('❌ Erro: Verifique se PANEL_URL, PANEL_API_PATH, PANEL_USER, e PANEL_PASSWORD estão no seu arquivo .env');
        return;
    }

    const fullApiUrl = `${url}/${path}?action=create_trial&username=${user}&password=${pass}`;

    console.log(`\n-- INICIANDO TESTE DE CONEXÃO --`);
    console.log(`URL de Teste: ${fullApiUrl}\n`);

    try {
        const response = await axios.get(fullApiUrl, { timeout: 10000 });
        console.log('✅ SUCESSO! O painel respondeu.');
        console.log('------------------------------------');
        console.log('DADOS RECEBIDOS:', response.data);
        console.log('------------------------------------');
        console.log('Esta URL e caminho da API estão corretos!');

    } catch (error) {
        console.error('❌ FALHA NA CONEXÃO.');
        console.log('------------------------------------');
        if (error.response) {
            console.error(`Erro: O painel respondeu com status ${error.response.status} (${error.response.statusText})`);
            console.error('Isso significa que o caminho da API (`PANEL_API_PATH`) ou as credenciais estão erradas.');
        } else {
            console.error('Ocorreu um erro de conexão:', error.message);
            console.error('Isso pode significar que a URL base (`PANEL_URL`) está errada ou seu IP está bloqueado.');
        }
        console.log('------------------------------------');
    }
}

testApiEndpoint();