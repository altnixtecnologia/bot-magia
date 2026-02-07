require('dotenv').config();
const fs = require('fs');
const { QrCodePix } = require('qrcode-pix');
const activationData = require('./activation_data');

async function testPixGeneration() {
    console.log('\n-- INICIANDO TESTE DE GERAÇÃO DE PIX --');

    const pixData = {
        version: '01',
        key: activationData.chave_pix,
        name: activationData.nome_beneficiario.substring(0, 25),
        city: activationData.cidade_beneficiario.substring(0, 15),
        message: 'Teste de Ativacao',
        value: 1.00, // Usando um valor fixo de R$ 1,00 para o teste
    };

    console.log('Dados usados para gerar o PIX:');
    console.log(pixData);
    console.log('------------------------------------');

    try {
        const qrCodePix = QrCodePix(pixData);

        const qrCodeBase64 = await qrCodePix.base64();
        const copiaECola = qrCodePix.payload();

        // Salva o QR Code como um arquivo de imagem
        fs.writeFileSync('test_qrcode.png', qrCodeBase64.replace('data:image/png;base64,', ''), 'base64');

        console.log('✅ SUCESSO! PIX gerado.');
        console.log('------------------------------------');
        console.log('1. Um arquivo chamado "test_qrcode.png" foi criado na pasta do projeto. Tente escaneá-lo com seu app do banco.');
        console.log('\n2. O código "Copia e Cola" está abaixo. Tente usá-lo no seu app do banco:');
        console.log(`\n${copiaECola}\n`);
        console.log('------------------------------------');

    } catch (error) {
        console.error('❌ FALHA NA GERAÇÃO DO PIX.');
        console.error('Ocorreu um erro na biblioteca qrcode-pix:', error);
    }
}

testPixGeneration();