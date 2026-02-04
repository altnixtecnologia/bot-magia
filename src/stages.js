const menu = require('./menu');

const userStages = {};

function getStage(from) {
    return userStages[from] || 0;
}

function updateStage(from, stage) {
    userStages[from] = stage;
}

async function processMessage(from, message) {
    const currentStage = getStage(from);
    const msg = message.toLowerCase().trim();
    let response = "";
    let action = null; // Usado para avisar o index.js se precisa gerar teste

    switch (currentStage) {
        case 0: // Boas-vindas
            response = `Olá! 👋 Bem-vindo ao *Bot Magia*.\n\nEscolha uma opção:\n\n1️⃣ - *Teste Grátis Automático* ⚡\n2️⃣ - Ver Planos de TV\n3️⃣ - Ativação de Apps\n4️⃣ - Falar com Suporte`;
            updateStage(from, 1);
            break;

        case 1: // Menu Principal
            if (msg === '1') {
                response = "Estou criando seu teste no sistema, aguarde um instante... ⏳";
                action = 'gerar_teste'; // Sinaliza para gerar o teste
                // Não mudamos o estágio ainda, o index.js vai decidir
            } else if (msg === '2') {
                response = `${menu.tv.titulo}\n\n${menu.tv.opcoes.join('\n')}\n\nDigite o número da opção ou *0* para voltar.`;
                updateStage(from, 2);
            } else if (msg === '3') {
                response = `${menu.apps.titulo}\n\n${menu.apps.opcoes.join('\n')}\n\nDigite o número da opção ou *0* para voltar.`;
                updateStage(from, 3);
            } else if (msg === '4') {
                response = `Para falar com um humano, chame no link: ${menu.suporte}\nOu aguarde que logo visualizamos.`;
                updateStage(from, 4);
            } else {
                response = "Opção inválida. Digite 1, 2, 3 ou 4.";
            }
            break;

        case 2: // Planos TV
        case 3: // Apps
            if (msg === '0') {
                response = "Voltando ao menu...\n\n1️⃣ - Teste Grátis\n2️⃣ - Planos de TV\n3️⃣ - Apps";
                updateStage(from, 1);
            } else {
                response = `Entendido! Para ativação de aplicativos, os valores podem variar.\n\nPor favor, aguarde um momento que um atendente irá te passar o valor atualizado e a chave PIX para pagamento. 👨‍💻`;
                updateStage(from, 4); // Envia para o suporte humano
            }
            break;

        case 4: // Fim / Suporte
            if (msg === 'oi' || msg === 'olá' || msg === 'menu') {
                response = "Olá novamente! Digite algo para ver o menu.";
                updateStage(from, 0);
            }
            return null; // Não responde nada se não for reiniciar

        default:
            response = "Olá! Digite *Oi* para começar.";
            updateStage(from, 0);
    }

    return { text: response, action: action };
}

module.exports = { processMessage, updateStage };
