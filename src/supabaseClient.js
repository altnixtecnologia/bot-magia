const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

console.log('[Supabase Client] Initializing...');
console.log(`[Supabase Client] URL loaded: ${supabaseUrl}`);
console.log(`[Supabase Client] Service Key loaded: ${supabaseServiceKey ? 'Yes, starting with ' + supabaseServiceKey.substring(0, 8) + '...' : 'No'}`);

if (supabaseUrl && supabaseServiceKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseServiceKey);
        console.log('[Supabase Client] Client created successfully.');
    } catch (error) {
        console.error("❌ Erro ao inicializar o Supabase. Verifique suas variáveis SUPABASE_URL e SUPABASE_SERVICE_KEY no arquivo .env");
        console.error("Detalhe do erro:", error.message);
        // O bot continuará rodando, mas sem a função de identificar clientes.
    }
} else {
    console.warn("⚠️  Aviso: SUPABASE_URL ou SUPABASE_SERVICE_KEY não foram encontradas no .env. A funcionalidade de identificar clientes está desativada.");
}

module.exports = supabase;