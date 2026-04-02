/**
 * Servidor WhatsApp para SDR Nexa
 * Usa whatsapp-web.js para conectar ao WhatsApp
 * Expõe API HTTP para enviar/receber mensagens
 */

const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.WA_PORT || 3001;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:5000/webhook';
const INSTANCE_ID = process.env.INSTANCE_ID || 'default';
const AUTH_PATH = `./.wwebjs_auth_${INSTANCE_ID}`;

// Estado global
let connectionStatus = 'disconnected'; // disconnected | qr | connected
let lastQR = null;
let intentionalDisconnect = false;

console.log(`🏷️ Instance ID: ${INSTANCE_ID}`);
console.log(`📁 Auth path: ${AUTH_PATH}`);

// ===== CLIENTE WHATSAPP =====
let client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
        ],
    },
});

// QR Code — aparece no terminal automaticamente
client.on('qr', (qr) => {
    lastQR = qr;
    connectionStatus = 'qr';
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   ESCANEIE O QR CODE NO WHATSAPP     ║');
    console.log('║   Configurações > Dispositivos        ║');
    console.log('║   Conectados > Vincular Dispositivo   ║');
    console.log('╚══════════════════════════════════════╝\n');
    qrcode.generate(qr, { small: true });
    console.log(`\nOu acesse: http://localhost:${PORT}/qr\n`);
});

// Conectado com sucesso
client.on('ready', () => {
    connectionStatus = 'connected';
    lastQR = null;
    const info = client.info;
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   ✅ WHATSAPP CONECTADO!              ║');
    console.log(`║   Instance: ${INSTANCE_ID}`.padEnd(39) + '║');
    console.log(`║   Número: ${info?.wid?.user || 'N/A'}`.padEnd(39) + '║');
    console.log(`║   Nome: ${info?.pushname || 'N/A'}`.padEnd(39) + '║');
    console.log('╚══════════════════════════════════════╝\n');

    // Report status to webhook server
    fetch(`${WEBHOOK_URL.replace('/webhook', '')}/instances/${INSTANCE_ID}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'connected', phone_number: info?.wid?.user, name: info?.pushname }),
    }).catch(() => {});
});

// Desconectado
client.on('disconnected', (reason) => {
    connectionStatus = 'disconnected';
    console.log('❌ WhatsApp desconectado:', reason);
    if (intentionalDisconnect) {
        console.log('   ↳ Desconexão intencional, sem auto-reconnect');
        intentionalDisconnect = false;
        return;
    }
    // Tentar reconectar após 10 segundos
    setTimeout(() => {
        console.log('🔄 Tentando reconectar...');
        client.initialize();
    }, 10000);
});

// Erro de autenticação
client.on('auth_failure', (msg) => {
    connectionStatus = 'auth_failure';
    console.error('❌ Falha de autenticação:', msg);
});

// Mensagem recebida — encaminha para webhook Python
client.on('message', async (msg) => {
    // Log TODA mensagem antes de filtrar
    console.log(`\n📨 [RAW] msg.from="${msg.from}" type="${msg.type}" fromMe=${msg.fromMe} body="${(msg.body || '').substring(0, 50)}"`);

    // Ignorar mensagens de grupo e status
    if (msg.from.includes('@g.us') || msg.from === 'status@broadcast') {
        console.log(`   ↳ Ignorada (grupo/status)`);
        return;
    }

    // Ignorar mensagens enviadas por nós
    if (msg.fromMe) {
        console.log(`   ↳ Ignorada (fromMe)`);
        return;
    }

    // Extrair telefone — tratar tanto @c.us quanto @lid (novo formato)
    let phone = msg.from;
    if (phone.includes('@c.us')) {
        phone = phone.replace('@c.us', '');
    } else if (phone.includes('@lid')) {
        // Novo formato Link ID — tentar obter número via getContact()
        console.log(`   ↳ Formato @lid detectado, tentando resolver número...`);
        try {
            const contact = await msg.getContact();
            phone = contact.number || contact.id?.user || phone.replace('@lid', '');
            console.log(`   ↳ Número resolvido: ${phone}`);
        } catch (e) {
            phone = phone.replace('@lid', '');
            console.log(`   ↳ Fallback: usando ID sem @lid: ${phone}`);
        }
    } else {
        phone = phone.replace(/@.*$/, ''); // Remove qualquer sufixo @xxx
    }

    const payload = {
        event: 'messages.upsert',
        data: {
            key: {
                remoteJid: msg.from,
                fromMe: false,
                id: msg.id._serialized,
            },
            message: {
                conversation: msg.body,
            },
            phone: phone,
            instanceName: INSTANCE_ID,
            messageType: msg.type, // text, ptt, audio, image, etc.
        },
    };

    // Se for áudio (ptt = gravação de voz, audio = arquivo de áudio)
    if (msg.type === 'ptt' || msg.type === 'audio') {
        console.log(`   🎤 Áudio detectado (type=${msg.type}), baixando mídia...`);
        try {
            const media = await msg.downloadMedia();
            if (media && media.data) {
                payload.data.audio_base64 = media.data;
                payload.data.audio_mimetype = media.mimetype || 'audio/ogg';
                console.log(`   ✅ Áudio baixado (${(media.data.length / 1024).toFixed(1)}KB, ${media.mimetype})`);
            } else {
                console.log(`   ⚠️ Não foi possível baixar o áudio`);
            }
        } catch (err) {
            console.error(`   ❌ Erro ao baixar áudio: ${err.message}`);
        }
    }

    console.log(`   ↳ Enviando webhook para ${WEBHOOK_URL} (phone=${phone}, type=${msg.type})`);
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        console.log(`   ✅ Webhook respondeu: ${response.status}`);
    } catch (err) {
        console.error(`   ❌ Webhook offline: ${err.message}`);
    }
});

// Fallback: capturar mensagens via 'message_create' caso 'message' não dispare
client.on('message_create', async (msg) => {
    // message_create dispara para TODAS as mensagens (enviadas e recebidas)
    // Ignorar as enviadas por nós e as que já serão tratadas por 'message'
    if (msg.fromMe) return;
    // Log para debug — se 'message' não disparou, message_create pega
    console.log(`📨 [message_create] from="${msg.from}" body="${(msg.body || '').substring(0, 30)}..."`);
});

// Capturar votos de enquete via evento 'vote_update' (nome correto na API)
client.on('vote_update', async (vote) => {
    console.log(`\n🗳️ [POLL VOTE] from="${vote.voter}" selectedOptions=${JSON.stringify(vote.selectedOptions)}`);

    const phone = vote.voter.replace('@c.us', '').replace('@lid', '');
    const selectedOption = vote.selectedOptions && vote.selectedOptions.length > 0
        ? vote.selectedOptions[0].name
        : '';

    if (!selectedOption) {
        console.log('   ↳ Voto vazio, ignorando');
        return;
    }

    // Enviar como webhook normal (o Python trata como mensagem de texto)
    const payload = {
        event: 'messages.upsert',
        data: {
            key: {
                remoteJid: vote.voter,
                fromMe: false,
                id: `poll_vote_${Date.now()}`,
            },
            message: {
                conversation: selectedOption,
            },
            phone: phone,
            instanceName: INSTANCE_ID,
            isPollVote: true,
        },
    };

    console.log(`   ↳ Enviando webhook: phone=${phone}, opção="${selectedOption}"`);
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        console.log(`   ✅ Webhook respondeu: ${response.status}`);
    } catch (err) {
        console.error(`   ❌ Webhook offline: ${err.message}`);
    }
});

// ===== API HTTP =====

// Status da conexão (com verificação real do client)
app.get('/status', async (req, res) => {
    let realState = connectionStatus;
    try {
        const state = await client.getState();
        if (state === 'CONNECTED') realState = 'connected';
        else if (state === 'CONFLICT') realState = 'conflict';
        else if (state === 'UNPAIRED' || state === 'UNLAUNCHED') realState = 'disconnected';
        else if (state) realState = state.toLowerCase();

        // Atualizar connectionStatus se mudou
        if (realState !== connectionStatus) {
            console.log(`⚠️ Status mudou: ${connectionStatus} → ${realState}`);
            connectionStatus = realState;
        }
    } catch (e) {
        // Se getState() falhar, o client está em estado ruim
        realState = 'error';
    }

    res.json({
        instance_id: INSTANCE_ID,
        status: realState,
        number: client.info?.wid?.user || null,
        name: client.info?.pushname || null,
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ ok: true, status: connectionStatus });
});

// QR Code como página HTML (para browser)
app.get('/qr', (req, res) => {
    if (connectionStatus === 'connected') {
        return res.send(`
            <html><body style="display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;color:#25D366;font-family:sans-serif;font-size:2em;">
            ✅ WhatsApp já está conectado!
            </body></html>
        `);
    }
    if (!lastQR) {
        return res.send(`
            <html><body style="display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;color:#ff6b6b;font-family:sans-serif;font-size:1.5em;">
            Aguardando QR Code... Recarregue em alguns segundos.
            </body></html>
        `);
    }
    // Gerar QR como imagem usando API pública
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(lastQR)}`;
    res.send(`
        <html><head><title>QR Code WhatsApp</title><meta http-equiv="refresh" content="15"></head>
        <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;flex-direction:column;font-family:sans-serif;">
        <h1 style="color:#25D366;">Escaneie o QR Code</h1>
        <img src="${qrImageUrl}" style="border:4px solid #25D366;border-radius:12px;" />
        <p style="color:#aaa;margin-top:20px;">Página atualiza automaticamente a cada 15s</p>
        </body></html>
    `);
});

// Enviar mensagem de texto
app.post('/send/text', async (req, res) => {
    try {
        const { phone, text } = req.body;
        if (!phone || !text) {
            return res.status(400).json({ error: 'phone e text são obrigatórios' });
        }

        // Verificar estado REAL do client
        let state;
        try {
            state = await client.getState();
        } catch (e) {
            return res.status(503).json({ error: 'WhatsApp client não disponível', detail: e.message });
        }

        if (state !== 'CONNECTED') {
            return res.status(503).json({ error: 'WhatsApp não conectado', status: state || connectionStatus });
        }

        // Formatar número: adicionar @c.us
        const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        console.log(`📤 Enviando para ${chatId}: "${text.substring(0, 50)}..."`);

        const result = await client.sendMessage(chatId, text);

        console.log(`✅ Mensagem enviada para ${phone}`);
        res.json({
            success: true,
            key: { id: result.id._serialized },
        });
    } catch (err) {
        console.error('❌ Erro ao enviar:', err.message);
        console.error('Stack:', err.stack);
        res.status(500).json({ error: err.message, stack: err.stack?.substring(0, 300) });
    }
});

// Enviar mensagem com botões (fallback para texto no WhatsApp Web)
app.post('/send/buttons', async (req, res) => {
    try {
        const { phone, text, buttons, footer } = req.body;
        if (!phone || !text) {
            return res.status(400).json({ error: 'phone e text são obrigatórios' });
        }

        if (connectionStatus !== 'connected') {
            return res.status(503).json({ error: 'WhatsApp não conectado', status: connectionStatus });
        }

        // WhatsApp Web não suporta botões nativos — enviar como texto formatado
        let fullText = text;
        if (buttons && buttons.length > 0) {
            fullText += '\n';
            buttons.forEach((b) => {
                fullText += `\n👉 Responda *${b.text || b.buttonText?.displayText || ''}*`;
            });
        }
        if (footer) {
            fullText += `\n\n_${footer}_`;
        }

        const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        const result = await client.sendMessage(chatId, fullText);

        console.log(`📤 Botões enviados para ${phone}`);
        res.json({
            success: true,
            key: { id: result.id._serialized },
        });
    } catch (err) {
        console.error('Erro ao enviar botões:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Enviar enquete (poll) — botões clicáveis!
app.post('/send/poll', async (req, res) => {
    try {
        const { phone, question, options } = req.body;
        if (!phone || !question || !options || options.length < 2) {
            return res.status(400).json({
                error: 'phone, question e options (mín. 2) são obrigatórios'
            });
        }

        // Verificar estado REAL do client
        let state;
        try {
            state = await client.getState();
        } catch (e) {
            return res.status(503).json({ error: 'WhatsApp client não disponível', detail: e.message });
        }

        if (state !== 'CONNECTED') {
            return res.status(503).json({ error: 'WhatsApp não conectado', status: state || connectionStatus });
        }

        const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        console.log(`📊 Enviando enquete para ${chatId}: "${question}" [${options.join(', ')}]`);

        const poll = new Poll(question, options, {
            allowMultipleAnswers: false,
        });
        const result = await client.sendMessage(chatId, poll);

        console.log(`✅ Enquete enviada para ${phone}`);
        res.json({
            success: true,
            key: { id: result.id._serialized },
        });
    } catch (err) {
        console.error('❌ Erro ao enviar enquete:', err.message);
        console.error('Stack:', err.stack);
        res.status(500).json({ error: err.message });
    }
});

// QR como JSON (para o Hub renderizar)
app.get('/qr/json', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: lastQR || null,
        number: client.info?.wid?.user || null,
        name: client.info?.pushname || null,
    });
});

// Desconectar WhatsApp
app.post('/disconnect', async (req, res) => {
    try {
        intentionalDisconnect = true;
        const clearAuth = req.query.clear_auth === 'true';

        try { await client.logout(); } catch (e) { console.log('logout skip:', e.message); }
        try { await client.destroy(); } catch (e) { console.log('destroy skip:', e.message); }

        connectionStatus = 'disconnected';
        lastQR = null;

        if (clearAuth) {
            const fs = require('fs');
            const path = require('path');
            const authDir = path.join(__dirname, AUTH_PATH);
            if (fs.existsSync(authDir)) {
                fs.rmSync(authDir, { recursive: true, force: true });
                console.log('🗑️ Auth data cleared for phone swap');
            }
        }

        console.log('🔌 WhatsApp desconectado via API');
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao desconectar:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Reconectar (cria novo client e inicializa)
app.post('/reconnect', async (req, res) => {
    try {
        intentionalDisconnect = false;
        connectionStatus = 'disconnected';
        lastQR = null;

        // Criar novo client
        client = new Client({
            authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--disable-gpu'],
            },
        });

        // Re-registrar todos os event handlers
        client.on('qr', (qr) => {
            lastQR = qr;
            connectionStatus = 'qr';
            console.log('📱 Novo QR code gerado');
        });

        client.on('ready', () => {
            connectionStatus = 'connected';
            lastQR = null;
            console.log(`✅ Reconectado: ${client.info?.wid?.user || 'N/A'}`);
        });

        client.on('disconnected', (reason) => {
            connectionStatus = 'disconnected';
            console.log('❌ Desconectado:', reason);
            if (!intentionalDisconnect) {
                setTimeout(() => { console.log('🔄 Reconectando...'); client.initialize(); }, 10000);
            }
            intentionalDisconnect = false;
        });

        client.on('auth_failure', (msg) => {
            connectionStatus = 'auth_failure';
            console.error('❌ Auth failure:', msg);
        });

        // Re-registrar message handler
        client.on('message', async (msg) => {
            if (msg.from.includes('@g.us') || msg.from === 'status@broadcast' || msg.fromMe) return;
            let phone = msg.from;
            if (phone.includes('@c.us')) phone = phone.replace('@c.us', '');
            else if (phone.includes('@lid')) {
                try { const c = await msg.getContact(); phone = c.number || c.id?.user || phone.replace('@lid', ''); } catch (e) { phone = phone.replace('@lid', ''); }
            } else phone = phone.replace(/@.*$/, '');

            const payload = { event: 'messages.upsert', data: { key: { remoteJid: msg.from, fromMe: false, id: msg.id._serialized }, message: { conversation: msg.body }, phone, instanceName: 'wa-server', messageType: msg.type } };

            if (msg.type === 'ptt' || msg.type === 'audio') {
                try { const media = await msg.downloadMedia(); if (media?.data) { payload.data.audio_base64 = media.data; payload.data.audio_mimetype = media.mimetype || 'audio/ogg'; } } catch (e) {}
            }

            try { await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch (e) {}
        });

        client.on('vote_update', async (vote) => {
            const phone = vote.voter.replace('@c.us', '').replace('@lid', '');
            const opt = vote.selectedOptions?.[0]?.name || '';
            if (!opt) return;
            const payload = { event: 'messages.upsert', data: { key: { remoteJid: vote.voter, fromMe: false, id: `poll_vote_${Date.now()}` }, message: { conversation: opt }, phone, instanceName: 'wa-server', isPollVote: true } };
            try { await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch (e) {}
        });

        client.initialize();
        console.log('🔄 Reconectando, QR disponível em breve...');
        res.json({ success: true, message: 'Reconnecting, QR will be available shortly' });
    } catch (err) {
        console.error('Erro ao reconectar:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ===== INICIAR =====
app.listen(PORT, () => {
    console.log(`\n🚀 WA-Server rodando em http://localhost:${PORT}`);
    console.log(`📡 Webhook configurado para: ${WEBHOOK_URL}`);
    console.log('⏳ Iniciando cliente WhatsApp...\n');
    client.initialize();
});
