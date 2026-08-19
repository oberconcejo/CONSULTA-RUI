require('dotenv').config();
const express = require('express');
const path = require('path');
const os = require('os');

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

// Obtener las direcciones IP locales de la máquina para facilitar la conexión desde el celular
function getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name in interfaces) {
        for (const net of interfaces[name]) {
            // Soportar tanto Node antiguo (IPv4 string) como Node moderno (4 int)
            if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
                addresses.push(net.address);
            }
        }
    }
    return addresses;
}

// Iniciar puerto escuchando en '0.0.0.0' para permitir accesos externos (ej. desde el celular)
if (require.main === module) {
    const HOST = '0.0.0.0';
    app.listen(PORT, HOST, async () => {
        console.log(`==================================================`);
        console.log(`Servidor de Consulta RUI iniciado correctamente.`);
        console.log(`==================================================`);
        console.log(`Para acceder localmente en esta PC:`);
        console.log(`👉 http://localhost:${PORT}`);
        console.log(``);
        
        const localIps = getLocalIpAddresses();
        if (localIps.length > 0) {
            console.log(`Para acceder desde su celular en la misma red Wi-Fi:`);
            localIps.forEach(ip => {
                console.log(`👉 http://${ip}:${PORT}`);
            });
        }
        
        // Si se solicita exponer a internet (ej. desde celular con datos o fuera de casa)
        if (process.argv.includes('--tunnel') || process.env.TUNNEL === 'true') {
            console.log(``);
            console.log(`Iniciando túnel público seguro...`);
            try {
                const localtunnel = require('localtunnel');
                const tunnel = await localtunnel({ port: PORT, subdomain: 'consulta-rui' });
                console.log(`==================================================`);
                console.log(`ACCESO PÚBLICO DESDE CUALQUIER RED (Internet):`);
                console.log(`👉 ${tunnel.url}`);
                console.log(`==================================================`);
                
                tunnel.on('close', () => {
                    console.log('Túnel público cerrado.');
                });
            } catch (err) {
                console.error('Error al iniciar el túnel público:', err.message);
                console.log('Para iniciar el túnel manualmente, asegúrese de tener internet y ejecute:');
                console.log('npx localtunnel --port 3000');
            }
        } else {
            console.log(``);
            console.log(`¿Desea acceder desde fuera de su red Wi-Fi (ej. con datos móviles)?`);
            console.log(`Inicie el servidor usando: npm run tunnel`);
        }
        console.log(`==================================================`);
    });
}

module.exports = app;
