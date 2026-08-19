// Desactivar la verificación estricta de SSL/TLS para evitar caídas por certificados del DNP
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Secret Key to keep API private
const RUI_API_KEY = process.env.RUI_API_KEY || 'ober_rui_key_sec_9876';

// Variables de estado del gestor de proxies colombianos (en memoria del contenedor)
let colombianProxies = [];
let currentProxyIndex = 0;
let lastProxyFetchTime = 0;

// Refrescar la lista de proxies colombianos gratuitos usando la API de Proxyscrape
async function refreshProxyList(fetchLib) {
    console.log('Refrescando lista de proxies de Colombia...');
    const url = 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=6000&country=CO&ssl=yes&anonymity=all';
    try {
        const response = await fetchLib(url);
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
async function getProxyAgent(fetchLib, HttpsProxyAgentClass) {
    if (colombianProxies.length === 0 || (Date.now() - lastProxyFetchTime > 10 * 60 * 1000)) {
        await refreshProxyList(fetchLib);
    }
    
    if (colombianProxies.length === 0) {
        return null;
    }
    
    if (currentProxyIndex >= colombianProxies.length) {
        currentProxyIndex = 0;
    }
    
    const proxy = colombianProxies[currentProxyIndex];
    return {
        proxy: proxy,
        agent: new HttpsProxyAgentClass(`http://${proxy}`)
    };
}

// Cambiar al siguiente proxy cuando el actual falla
function rotateProxy() {
    if (colombianProxies.length > 0) {
        currentProxyIndex = (currentProxyIndex + 1) % colombianProxies.length;
        console.log(`Rotando proxy. Siguiente índice activo: ${currentProxyIndex} (${colombianProxies[currentProxyIndex]})`);
    }
}

// Exponer el handler compatible con Express (local) y Serverless Functions (Vercel)
module.exports = async (req, res) => {
    try {
        // Cargar dependencias de forma dinámica dentro del handler para diagnosticar fallas de carga en Vercel
        const fetch = require('node-fetch');
        const HttpsProxyAgent = require('https-proxy-agent');

        // Solo permitir solicitudes POST para la API
        if (req.method !== 'POST') {
            return res.status(405).json({ ok: false, error: 'Método no permitido. Use POST.' });
        }

        // Validar la cabecera API Key
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
        const maxAttempts = 4;
        let lastError = '';
        let responseData = null;

        // Verificar si estamos corriendo en la nube de Vercel o en local
        const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;

        if (!isVercel) {
            console.log("Entorno Local de Colombia detectado. Conectando directamente para máxima velocidad...");
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: body,
                    timeout: 8000
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
        } else {
            // En Vercel (nube), usar la rotación de proxies de Colombia obligatoriamente
            while (attempts < maxAttempts && !success) {
                attempts++;
                const proxyObj = await getProxyAgent(fetch, HttpsProxyAgent);
                
                if (!proxyObj) {
                    console.log(`[Intento ${attempts}] No hay proxies colombianos disponibles en la nube. Conexión directa...`);
                    try {
                        const response = await fetch(url, {
                            method: 'POST',
                            headers: headers,
                            body: body,
                            timeout: 3000
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
                    break;
                }

                console.log(`[Intento ${attempts}/${maxAttempts}] Consultando RUI via proxy de Colombia: ${proxyObj.proxy}...`);
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: headers,
                        body: body,
                        agent: proxyObj.agent,
                        timeout: 3000
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
    } catch (crashError) {
        console.error("CRITICAL EXCEPTION INSIDE SERVERLESS FUNCTION:", crashError);
        return res.status(500).json({
            ok: false,
            error: "Error crítico e inesperado en la función serverless de la nube.",
            details: crashError.message,
            stack: crashError.stack
        });
    }
};
