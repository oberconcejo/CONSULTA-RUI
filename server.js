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

const queryHandler = require('./api/query');

// API Proxy endpoint to query RUI
app.post('/api/query', queryHandler);

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
