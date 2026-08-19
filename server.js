const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Desactivar la verificación estricta de SSL/TLS para evitar caídas por certificados del DNP
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON and urlencoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Secret Key to keep API private
const RUI_API_KEY = process.env.RUI_API_KEY || 'ober_rui_key_sec_9876';

// Variables de estado del gestor de proxies colombianos
let colombianProxies = [];
let currentProxyIndex = 0;
let lastProxyFetchTime = 0;

// Refrescar la lista de proxies colombianos gratuitos usando la API de Proxyscrape
async function refreshProxyList() {
    console.log('Refrescando lista de proxies de Colombia...');
    const url = 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=8000&country=CO&ssl=all&anonymity=all';
    try {
        const response = await fetch(url);
        const text = await response.text();
        colombianProxies = text.split('\r\n').map(p => p.trim()).filter(p => p !== '');
        currentProxyIndex = 0;
        lastProxyFetchTime = Date.now();
        console.log(`Lista de proxies actualizada. Se encontraron ${colombianProxies.length} proxies colombianos.`);
    } catch (error) {
        console.error('Error al obtener lista de proxies colombianos:', error.message);
    }
}

// Obtener el agente del proxy actual o null si no hay disponibles
async function getProxyAgent() {
    // Si la lista está vacía o pasaron más de 10 minutos, refrescar la lista
    if (colombianProxies.length === 0 || (Date.now() - lastProxyFetchTime > 10 * 60 * 1000)) {
        await refreshProxyList();
    }
    
    if (colombianProxies.length === 0) {
        return null;
    }
    
    // Asegurar que el índice no esté fuera de rango
    if (currentProxyIndex >= colombianProxies.length) {
        currentProxyIndex = 0;
    }
    
    const proxy = colombianProxies[currentProxyIndex];
    return {
        proxy: proxy,
        agent: new HttpsProxyAgent(`http://${proxy}`)
    };
}

// Cambiar al siguiente proxy cuando el actual falla
function rotateProxy() {
    if (colombianProxies.length > 0) {
        currentProxyIndex = (currentProxyIndex + 1) % colombianProxies.length;
        console.log(`Rotando proxy. Siguiente índice activo: ${currentProxyIndex} (${colombianProxies[currentProxyIndex]})`);
    }
}

// API Proxy endpoint to query RUI
app.post('/api/query', async (req, res) => {
    // Validate API Key
    const clientKey = req.headers['x-api-key'];
    if (!clientKey || clientKey !== RUI_API_KEY) {
        return res.status(401).json({
            ok: false,
            error: 'No autorizado: API Key inválida o no proporcionada.'
        });
    }

    const { pNumDoc, pTipDoc } = req.body;

    if (!pNumDoc || !pTipDoc) {
        return res.status(400).json({
            ok: false,
            error: 'Faltan parámetros requeridos: pNumDoc y pTipDoc.'
        });
    }

    const url = 'https://ventanillasocial.dnp.gov.co/Home/ObtenerDatosRUI';
    const headers = {
        'accept': '*/*',
        'accept-language': 'es-CO,es-ES;q=0.9,es;q=0.8,en;q=0.7,en-GB;q=0.6,en-US;q=0.5,es-MX;q=0.4',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://ventanillasocial.dnp.gov.co',
        'referer': 'https://ventanillasocial.dnp.gov.co/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
    };
    const body = `pNumDoc=${encodeURIComponent(pNumDoc)}&pTipDoc=${encodeURIComponent(pTipDoc)}`;

    let success = false;
    let attempts = 0;
    const maxAttempts = 4; // Intentar hasta con 4 proxies diferentes para asegurar éxito
    let lastError = '';
    let responseData = null;

    while (attempts < maxAttempts && !success) {
        attempts++;
        const proxyObj = await getProxyAgent();
        
        if (!proxyObj) {
            console.log(`[Intento ${attempts}] No hay proxies colombianos disponibles. Intentando conexión directa...`);
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: body,
                    timeout: 6000
                });
                if (response.ok) {
                    responseData = await response.json();
                    success = true;
                } else {
                    lastError = `Status ${response.status} ${response.statusText}`;
                }
            } catch (err) {
                lastError = err.message;
            }
            break; // Si falla la directa en la nube, detenemos (ya que la IP de la nube está bloqueada)
        }

        console.log(`[Intento ${attempts}/${maxAttempts}] Consultando RUI via proxy de Colombia: ${proxyObj.proxy}...`);
        try {
            // Timeout bajo de 5 segundos para rotar rápido si el proxy está caído/lento
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body,
                agent: proxyObj.agent,
                timeout: 5000
            });

            if (response.ok) {
                responseData = await response.json();
                success = true;
                console.log(`[Éxito] Consulta completada usando proxy: ${proxyObj.proxy}`);
            } else {
                lastError = `Status ${response.status} ${response.statusText}`;
                console.log(`[Fallo] Proxy ${proxyObj.proxy} respondió con código: ${response.status}`);
                rotateProxy();
            }
        } catch (err) {
            lastError = err.message;
            console.log(`[Fallo] Proxy ${proxyObj.proxy} dio error: ${err.message}`);
            rotateProxy();
        }
    }

    if (success && responseData) {
        return res.json(responseData);
    } else {
        console.error('Todas las consultas via proxy fallaron. Último error:', lastError);
        return res.status(500).json({
            ok: false,
            error: `Error al conectar con la Ventanilla Social RUI (Proxies fallidos). Detalles: ${lastError}`
        });
    }
});

// Fallback to index.html for single-page applications
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar puerto solo en ejecución directa local
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor de Consulta RUI iniciado correctamente.`);
        console.log(`Abra su navegador en: http://localhost:${PORT}`);
    });
}

module.exports = app;
