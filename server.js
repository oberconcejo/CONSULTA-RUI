const express = require('express');
const path = require('path');

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
    
    // Headers matching the browser request exactly to ensure success
    const headers = {
        'accept': '*/*',
        'accept-language': 'es-CO,es-ES;q=0.9,es;q=0.8,en;q=0.7,en-GB;q=0.6,en-US;q=0.5,es-MX;q=0.4',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://ventanillasocial.dnp.gov.co',
        'referer': 'https://ventanillasocial.dnp.gov.co/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
    };

    const body = `pNumDoc=${encodeURIComponent(pNumDoc)}&pTipDoc=${encodeURIComponent(pTipDoc)}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: body
        });

        if (!response.ok) {
            return res.status(response.status).json({
                ok: false,
                error: `Error del servidor DNP RUI: ${response.statusText}`
            });
        }

        const data = await response.json();
        return res.json(data);
    } catch (error) {
        console.error('Error al realizar la consulta al DNP:', error);
        return res.status(500).json({
            ok: false,
            error: 'No se pudo conectar con el servidor de la Ventanilla Social DNP. Verifique su conexión de red.'
        });
    }
});

// Fallback to index.html for single-page applications
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor de Consulta RUI iniciado correctamente.`);
    console.log(`Abra su navegador en: http://localhost:${PORT}`);
});
