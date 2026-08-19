const fetch = require('node-fetch');
const HttpsProxyAgent = require('https-proxy-agent');

// Desactivar la verificación estricta de SSL/TLS para evitar caídas por certificados del DNP
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Secret Key to keep API private
const RUI_API_KEY = process.env.RUI_API_KEY || 'ober_rui_key_sec_9876';

// Variables de estado del gestor de proxies colombianos (en memoria del contenedor)
let colombianProxies = [];
let currentProxyIndex = 0;
let lastProxyFetchTime = 0;

// Refrescar la lista de proxies colombianos combinando Proxyscrape, Geonode y Proxifly
async function refreshProxyList(fetchLib) {
    console.log('Refrescando lista de proxies de Colombia desde 3 fuentes...');
    const urlProxyscrape = 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=6000&country=CO&anonymity=all';
    const urlGeonode = 'https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&country=CO&protocols=http%2Chttps';
    const urlProxifly = 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/CO/data.txt';
    
    let proxies = [];
    
    // 1. Fetch de Proxyscrape (sin filtro SSL estricto)
    try {
        const res = await fetchLib(urlProxyscrape);
        const text = await res.text();
        const psList = text.split('\r\n').map(p => p.trim()).filter(p => p !== '');
        proxies = proxies.concat(psList);
        console.log(`Proxyscrape: Encontrados ${psList.length} proxies colombianos.`);
    } catch (e) {
        console.error('Error al obtener proxies de Proxyscrape:', e.message);
    }
    
    // 2. Fetch de Geonode (evitando bloqueos de límite de tasa)
    try {
        const res = await fetchLib(urlGeonode);
        if (res.status === 429 || res.status === 403) {
            console.log('Geonode: Límite de tasa o bloqueo detectado. Omitiendo fuente.');
        } else {
            const data = await res.json();
            if (data && data.data) {
                const gnList = data.data.map(p => `${p.ip}:${p.port}`);
                proxies = proxies.concat(gnList);
                console.log(`Geonode: Encontrados ${gnList.length} proxies colombianos.`);
            }
        }
    } catch (e) {
        console.error('Error al obtener proxies de Geonode:', e.message);
    }
    
    // 3. Fetch de Proxifly (GitHub mirror)
    try {
        const res = await fetchLib(urlProxifly);
        const text = await res.text();
        const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
        let pfCount = 0;
        for (let line of lines) {
            if (line.startsWith('socks4://') || line.startsWith('socks5://') || line.startsWith('socks://')) {
                continue;
            }
            let host = line;
            if (line.startsWith('http://')) {
                host = line.replace('http://', '');
            } else if (line.startsWith('https://')) {
                host = line.replace('https://', '');
            }
            if (host) {
                proxies.push(host);
                pfCount++;
            }
        }
        console.log(`Proxifly: Encontrados ${pfCount} proxies HTTP/HTTPS colombianos.`);
    } catch (e) {
        console.error('Error al obtener proxies de Proxifly:', e.message);
    }
    
    // Remover duplicados y guardar
    colombianProxies = [...new Set(proxies)];
    currentProxyIndex = 0;
    lastProxyFetchTime = Date.now();
    console.log(`Lista de proxies combinada y limpia. Total: ${colombianProxies.length} proxies de Colombia cargados.`);
}

// Obtener lista de proxies para la carrera actual
async function getProxiesForRace(fetchLib, count) {
    if (colombianProxies.length === 0 || (Date.now() - lastProxyFetchTime > 10 * 60 * 1000)) {
        await refreshProxyList(fetchLib);
    }
    
    if (colombianProxies.length === 0) {
        return [];
    }
    
    const selected = [];
    for (let i = 0; i < Math.min(count, colombianProxies.length); i++) {
        const idx = (currentProxyIndex + i) % colombianProxies.length;
        selected.push(colombianProxies[idx]);
    }
    return selected;
}

// Exponer el handler compatible con Express (local) y Serverless Functions (Vercel)
module.exports = async (req, res) => {
    try {
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
        let lastError = '';
        let responseData = null;

        // Verificar si estamos corriendo en la nube (Vercel o Render) o en local
        const isCloud = process.env.VERCEL || process.env.RENDER || process.env.NODE_ENV === 'production';

        if (!isCloud) {
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
            // En la nube (Vercel/Render), usar la carrera de proxies en paralelo (12 en paralelo para alta tolerancia a fallos)
            const proxyList = await getProxiesForRace(fetch, 12);
            
            if (proxyList.length === 0) {
                console.log("No hay proxies colombianos disponibles en la nube. Intentando conexión directa...");
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
            } else {
                console.log(`[Carrera de Proxies] Lanzando consulta paralela con ${proxyList.length} proxies colombianos...`);
                
                const promises = proxyList.map(async (proxy, index) => {
                    const agent = new HttpsProxyAgent(`http://${proxy}`);
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 segundos de timeout

                    try {
                        const response = await fetch(url, {
                            method: 'POST',
                            headers: headers,
                            body: body,
                            agent: agent,
                            signal: controller.signal
                        });

                        clearTimeout(timeoutId);

                        if (response.ok) {
                            const data = await response.json();
                            if (data && typeof data === 'object') {
                                // Guardar el índice del proxy exitoso para priorizarlo en la siguiente carrera
                                currentProxyIndex = colombianProxies.indexOf(proxy);
                                console.log(`[Éxito] Proxy ${proxy} ganó la carrera y completó la consulta.`);
                                return data;
                            }
                        }
                        throw new Error(`Proxy respondió con status ${response.status}`);
                    } catch (err) {
                        clearTimeout(timeoutId);
                        throw err;
                    }
                });

                try {
                    // Esperar a que el proxy más rápido tenga éxito
                    responseData = await Promise.any(promises);
                    success = true;
                } catch (aggregateError) {
                    lastError = 'Todos los proxies paralelos fallaron o dieron timeout.';
                    console.error(lastError);
                    // Rotar el índice para probar un grupo de proxies diferente la próxima vez
                    currentProxyIndex = (currentProxyIndex + 12) % colombianProxies.length;
                }
            }
        }

        if (success && responseData) {
            return res.json(responseData);
        } else {
            console.error('La consulta falló en todos los intentos. Último error:', lastError);
            return res.status(500).json({
                ok: false,
                error: `Error al conectar con la Ventanilla Social RUI. Detalles: ${lastError}`
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
