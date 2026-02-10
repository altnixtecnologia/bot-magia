const messages = {
    saudacao: {
        manha: "Bom dia",
        tarde: "Boa tarde",
        noite: "Boa noite",
        madrugada: "Boa madrugada"
    },
    boasVindas: {
        novoContato: "*{nome}*, esse é o nosso atendimento automatizado!\nNão deixe de visitar o nosso site oficial: https://sitemagiatv.vercel.app/",
        retorno: "Olá *{nome}*, você voltou! Como posso te ajudar agora?",
        clienteIdentificado: "Identifiquei que você já é nosso cliente VIP! 👋\nNão deixe de visitar nosso site oficial: https://sitemagiatv.vercel.app/\n\nAqui estão os dados da sua conta:\n*ID Magia:* `{magia_id}`\n*Status:* `{status}`\n\nPara ver seu vencimento e renovar, acesse seu painel pessoal através do link abaixo:\n{link}",
        multiplosDispositivos: "Olá *{nome}*! Identifiquei que você possui mais de um dispositivo associado a este número. Para qual deles você gostaria de ver as informações?\n\n{lista_dispositivos}\n\nPor favor, digite o número correspondente ou *V*/*0* para voltar."
    },
    menu: {
        principal: "Escolha uma opção abaixo:\n\n1️⃣ - Ver Planos de TV\n2️⃣ - Teste Grátis Automático ⚡\n3️⃣ - Falar com Suporte\n4️⃣ - Ativação de Apps\n5️⃣ - Escrever uma mensagem\n\n(Digite *S* a qualquer momento para encerrar)",
        voltar: "Voltando ao menu principal...",
        opcaoInvalida: "Opção inválida. Por favor, escolha uma das opções do menu.",
        sair: "Atendimento finalizado. Se precisar, é só chamar novamente! 👋"
    },
    fluxos: {
        gerandoTeste: "Estou criando seu teste no sistema, aguarde um instante... ⏳",
        suporte: "Entendido! Já notifiquei nossa equipe de suporte. Em breve, um de nossos atendentes entrará em contato com você por aqui. 👨‍💻\n\nDigite *V* ou *0* para voltar ao menu principal.",
        textoLivre: "Perfeito! Pode escrever sua mensagem agora. Eu vou encaminhar para nossa equipe. 📝\n\nPara voltar ao menu, digite *V* ou *0*.",
        textoLivreConfirmacao: "Mensagem enviada! ✅\n\nSe quiser continuar escrevendo, é só mandar outra. Para voltar ao menu, digite *V* ou *0*.",
        apps: "Entendido! Para ativação de aplicativos, os valores podem variar.\n\nPor favor, aguarde um momento que um atendente irá te passar o valor atualizado e a chave PIX para pagamento. 👨‍💻",
        fimTeste: "✅ *Teste Gerado com Sucesso!*\n\n🛰️ Servidor: *{servidor}*\n👤 Usuário: *{usuario}*\n🔑 Senha: *{senha}*\n🌐 URL: {url}\n📅 Vencimento: {vencimento}\n\nBom divertimento!",
        erroTeste: "❌ Ops! O sistema de testes está instável. Por favor, chame o suporte (Opção 3).",
        notificacaoSuporte: "⚠️ *Alerta de Suporte* ⚠️\n\nO cliente *{nome}* ({numero}) solicitou atendimento vindo da área: *{origem}*.",
        notificacaoTexto: "💬 *Mensagem do cliente* 💬\n\nNome: *{nome}*\nNúmero: *{numero}*\nMensagem: {mensagem}",
        notificacaoComprovanteAtivacao: "🧾 *Comprovante de Ativação Recebido*\n\nCliente: *{nome}* ({numero})\nApp: *{app}*\nValor: *{valor}*\n\nAguardando confirmação do pagamento.\nPara liberar e pedir o MAC/Email, use: `confirmar {numero}`",
        notificacaoAtivacao: "🚀 *Nova Ativação de App* 🚀\n\nCliente: *{nome}* ({numero})\nApp: *{app}*\nMAC/ID: `{mac}`\n\nO comprovante de pagamento foi enviado a seguir.",
        aguardandoComprovante: "Estou aguardando o comprovante (imagem ou PDF). Se preferir, digite *V* ou *0* para voltar ao menu.",
        tutorialMac: "🔍 *Como encontrar o MAC/ID do seu aplicativo?*\n\nNa maioria dos aplicativos, como *IBO Player*, *VU Player*, *Bob Player*, etc., as informações que precisamos (*MAC* e às vezes uma *Key* ou *Chave*) aparecem logo na *tela inicial* quando você abre o aplicativo.\n\nProcure por algo como:\n- *Device ID* / *ID do Dispositivo*\n- *Device Key* / *Chave do Dispositivo*\n- *Endereço MAC*\n\n*Exemplo:*\nMAC: `A1:B2:C3:D4:E5:F6`\nKey: `7A8B9C0D1E2F`\n\nPor favor, digite o código que aparece na sua tela. Se tiver dificuldades, pode nos mandar uma foto da tela do aplicativo."
    },
    timeout: {
        reset: "A conversa foi encerrada por inatividade. Quando precisar, é só chamar!"
    },
    notificacoesVencimento: {
        preVencimento: "Olá, *{nome}*! Passando para lembrar que sua assinatura *Magia TV* vence em 5 dias ({data_vencimento}). Para antecipar sua renovação e não ficar sem sinal, acesse seu link exclusivo:\n\n🔗 {link}",
        venceHoje: "*Atenção, {nome}!* Seu acesso vence hoje. 😱\nPara renovar agora e garantir a continuidade do seu sinal, acesse seu Link Mágico:\n\n🔗 {link}\n\n_Lá você também encontra seus dados de acesso._",
        vencido: "Olá, *{nome}*. Notamos que seu plano expirou há 2 dias. 😔\nMas não se preocupe, seu acesso pode ser reativado na hora! Basta realizar o pagamento pelo seu link:\n\n🔗 {link}"
    },
    notificacoesPagamento: {
        confirmacao: "✅ *Pagamento confirmado!*\n\nOlá, *{nome}*! Recebemos o seu pagamento de *{valor}* e seu acesso Magia TV foi renovado.\n\nNovo vencimento: *{vencimento}*\n\nQualquer dúvida, é só responder por aqui."
    }
};

module.exports = messages;
