/**
 * LÓGICA DEL CLIENTE: CONSULTA RUI
 * Implementa tabs, consulta individual, drag-and-drop de CSV,
 * motor de consultas por cola con concurrencia y delay, y descarga de CSV.
 */

document.addEventListener('DOMContentLoaded', () => {
    // === SELECTORES DE ELEMENTOS ===
    
    // Tabs Navigation
    const btnTabIndividual = document.getElementById('btn-tab-individual');
    const btnTabMasiva = document.getElementById('btn-tab-masiva');
    const tabIndividual = document.getElementById('tab-individual');
    const tabMasiva = document.getElementById('tab-masiva');

    // Consulta Individual
    const individualForm = document.getElementById('individual-form');
    const indDocType = document.getElementById('ind-doc-type');
    const indDocNum = document.getElementById('ind-doc-num');
    const individualLoader = document.getElementById('individual-loader');
    const individualResult = document.getElementById('individual-result');
    const individualError = document.getElementById('individual-error');
    const individualErrorMsg = document.getElementById('individual-error-msg');
    
    // Resultados Individuales (DNP Oficial)
    const resNombre = document.getElementById('res-nombre');
    const resEdadSexo = document.getElementById('res-edad-sexo');
    const resUbicacion = document.getElementById('res-ubicacion');
    const resClassBox = document.getElementById('res-class-box');
    const resClassValue = document.getElementById('res-class-value');
    const resClassBadge = document.getElementById('res-class-badge');
    const resTblTipo = document.getElementById('res-tbl-tipo');
    const resTblNum = document.getElementById('res-tbl-num');
    const resTblDepto = document.getElementById('res-tbl-depto');
    const resTblMpio = document.getElementById('res-tbl-mpio');
    const resTblIngresos = document.getElementById('res-tbl-ingresos');
    
    // Botones de acción del reporte individual
    const btnPrintIndividual = document.getElementById('btn-print-individual');
    const btnClearIndividual = document.getElementById('btn-clear-individual');

    // Consulta Masiva: Drag & Drop
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileDetailsPanel = document.getElementById('file-details-panel');
    const fileNameText = document.getElementById('file-name');
    const fileSizeText = document.getElementById('file-size');
    const fileRowsText = document.getElementById('file-rows');
    const btnRemoveFile = document.getElementById('btn-remove-file');

    // Consulta Masiva: Configuración
    const csvConfigPanel = document.getElementById('csv-config-panel');
    const csvDelimiter = document.getElementById('csv-delimiter');
    const colDocNum = document.getElementById('col-doc-num');
    const colDocType = document.getElementById('col-doc-type');
    const fixedTypeGroup = document.getElementById('fixed-type-group');
    const fixedDocType = document.getElementById('fixed-doc-type');
    const sliderConcurrency = document.getElementById('batch-concurrency');
    const valConcurrency = document.getElementById('concurrency-val');
    const sliderDelay = document.getElementById('batch-delay');
    const valDelay = document.getElementById('delay-val');
    const btnStartBatch = document.getElementById('btn-start-batch');

    // Consulta Masiva: Progreso y Controles
    const progressCard = document.getElementById('progress-card');
    const progressSpinner = document.getElementById('progress-spinner');
    const progressStatusText = document.getElementById('progress-status-text');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressBarPercent = document.getElementById('progress-bar-percent');
    
    const btnPauseBatch = document.getElementById('btn-pause-batch');
    const btnResumeBatch = document.getElementById('btn-resume-batch');
    const btnCancelBatch = document.getElementById('btn-cancel-batch');

    // Estadísticas
    const statTotal = document.getElementById('stat-total');
    const statSuccess = document.getElementById('stat-success');
    const statError = document.getElementById('stat-error');
    const statPending = document.getElementById('stat-pending');
    const statTime = document.getElementById('stat-time');

    // Tabla de Resultados Masivos
    const resultsCard = document.getElementById('results-card');
    const resultsTbody = document.getElementById('results-tbody');
    const tableFilter = document.getElementById('table-filter');
    const btnDownloadResults = document.getElementById('btn-download-results');
    const btnDownloadExcel = document.getElementById('btn-download-excel');


    // === VARIABLES DE ESTADO ===
    let loadedFile = null;
    let csvData = []; // Datos crudos parseados
    let csvHeaders = []; // Encabezados de las columnas del CSV
    
    // Estado del motor de cola
    let queue = []; // Índices pendientes por procesar
    let recordRetries = []; // Contador de intentos por índice
    let activeCount = 0; // Peticiones simultáneas en curso
    let isPaused = false;
    let isCancelled = false;
    let processedRecords = []; // Resultados consolidados
    
    // Contadores
    let countTotal = 0;
    let countSuccess = 0;
    let countError = 0;
    let countPending = 0;
    
    // Tiempos
    let startTime = null;
    let timerInterval = null;


    // === DICCIONARIOS DE APOYO ===
    const DOCUMENT_TYPES_MAP = {
        '3': 'Cédula de Ciudadanía (CC)',
        '2': 'Tarjeta de Identidad (TI)',
        '1': 'Registro Civil (RC)',
        '4': 'Cédula de Extranjería (CE)',
        '5': 'Pasaporte (PA)',
        '9': 'Permiso por Protección Temporal (PPT)'
    };


    // ==========================================================================
    // 1. TABS NAVIGATION LOGIC
    // ==========================================================================
    function switchTab(activeBtn, targetTabId) {
        // Remover clase activa de todos los botones y contenidos
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        // Activar el seleccionado
        activeBtn.classList.add('active');
        const targetTab = document.getElementById(targetTabId);
        targetTab.classList.add('active');
    }

    btnTabIndividual.addEventListener('click', () => switchTab(btnTabIndividual, 'tab-individual'));
    btnTabMasiva.addEventListener('click', () => switchTab(btnTabMasiva, 'tab-masiva'));


    // ==========================================================================
    // 2. CONSULTA INDIVIDUAL LOGIC
    // ==========================================================================
    individualForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const numDoc = indDocNum.value.trim();
        const tipDoc = indDocType.value;

        if (!numDoc) return;

        // Reset visual states
        individualLoader.classList.remove('hidden');
        individualResult.classList.add('hidden');
        individualError.classList.add('hidden');
        individualForm.querySelector('button[type="submit"]').disabled = true;

        try {
            const data = await queryRuiApi(numDoc, tipDoc);

            if (data.ok) {
                // Rellenar datos principales
                resNombre.textContent = data.nombre || 'NO ESPECIFICADO';
                
                // Formatear edad y sexo
                const edadStr = data.edad !== undefined ? `${data.edad} años` : 'No especificada';
                const sexoStr = data.sexo || 'No especificado';
                resEdadSexo.innerHTML = `${edadStr} &middot; ${sexoStr}`;
                
                // Formatear ubicación
                const mpioStr = data.municipio ? data.municipio.toUpperCase() : 'NO ESPECIFICADO';
                const deptoStr = data.departamento ? data.departamento.toUpperCase() : 'NO ESPECIFICADO';
                resUbicacion.textContent = `${mpioStr} — ${deptoStr}`;

                // Formatear clasificación del RUI (C12, D21, etc.)
                let groupLetter = 'none';
                let classValue = 'N/A';
                let classCategory = 'Sin Registro';

                if (data.grupRui && data.grupRui !== 'nan') {
                    groupLetter = data.grupRui.substring(0, 1).toLowerCase();
                    classValue = data.nivelRui || data.grupRui;
                    
                    // Categorías oficiales de Sisbén IV
                    switch (groupLetter) {
                        case 'a':
                            classCategory = 'Pobreza extrema';
                            break;
                        case 'b':
                            classCategory = 'Pobreza moderada';
                            break;
                        case 'c':
                            classCategory = 'Vulnerabilidad';
                            break;
                        case 'd':
                            classCategory = 'No pobre';
                            break;
                        default:
                            classCategory = 'Registrado';
                    }
                }

                // Aplicar clase de color al contenedor
                resClassBox.className = `dnp-class-box group-${groupLetter}`;
                resClassValue.textContent = classValue;
                resClassBadge.textContent = classCategory;

                // Rellenar tabla de detalles
                resTblTipo.textContent = DOCUMENT_TYPES_MAP[tipDoc] ? DOCUMENT_TYPES_MAP[tipDoc].split(' ')[0] : 'Cédula de ciudadanía';
                resTblNum.textContent = numDoc;
                resTblDepto.textContent = data.departamento || 'No especificado';
                resTblMpio.textContent = data.municipio || 'No especificado';
                resTblIngresos.textContent = data.grupoIngresos || 'Sin ingresos';

                // Mostrar tarjeta
                individualResult.classList.remove('hidden');
            } else {
                // No registrado en RUI o consulta fallida
                individualErrorMsg.textContent = `No se encontraron registros en el RUI para el documento ${numDoc} (${DOCUMENT_TYPES_MAP[tipDoc] || tipDoc}).`;
                individualError.classList.remove('hidden');
            }
        } catch (error) {
            individualErrorMsg.textContent = error.message || 'Error en la conexión con el servidor.';
            individualError.classList.remove('hidden');
        } finally {
            individualLoader.classList.add('hidden');
            individualForm.querySelector('button[type="submit"]').disabled = false;
        }
    });

    // Evento de impresión del reporte individual
    if (btnPrintIndividual) {
        btnPrintIndividual.addEventListener('click', () => {
            window.print();
        });
    }

    // Evento para limpiar la consulta y ocultar la tarjeta
    if (btnClearIndividual) {
        btnClearIndividual.addEventListener('click', () => {
            individualResult.classList.add('hidden');
            indDocNum.value = '';
            indDocNum.focus();
        });
    }

    // Helper centralizado para llamar a la API
    async function queryRuiApi(numDoc, tipDoc, extraData) {
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': 'ober_rui_key_sec_9876'
            },
            body: JSON.stringify({ pNumDoc: numDoc, pTipDoc: tipDoc, extraData: extraData })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Error del servidor proxy (${response.status})`);
        }

        return await response.json();
    }


    // ==========================================================================
    // 3. FILE LOAD & PARSING LOGIC (DRAG & DROP)
    // ==========================================================================
    
    // Eventos de arrastre
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleUploadedFile(files[0]);
        }
    });

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleUploadedFile(e.target.files[0]);
        }
    });

    btnRemoveFile.addEventListener('click', () => {
        resetFileState();
    });

    // Maneja el archivo y hace el pre-parseo
    function handleUploadedFile(file) {
        const name = file.name.toLowerCase();
        if (!name.endsWith('.csv') && !name.endsWith('.txt') && !name.endsWith('.xlsx') && !name.endsWith('.xls')) {
            alert('Por favor, selecciona un archivo válido (.csv, .txt, .xlsx, .xls)');
            return;
        }

        loadedFile = file;

        // Mostrar detalles del archivo
        fileNameText.textContent = file.name;
        fileSizeText.textContent = formatBytes(file.size);
        
        // Esconder zona de drop, mostrar panel de detalles
        dropZone.classList.add('hidden');
        fileDetailsPanel.classList.remove('hidden');

        // Ocultar selector de delimitador para Excel, mostrar para CSV/TXT
        const delimiterGroup = csvDelimiter.closest('.form-group');
        
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            if (delimiterGroup) delimiterGroup.classList.add('hidden');
            parseExcelFile(file);
        } else {
            if (delimiterGroup) delimiterGroup.classList.remove('hidden');
            parseHeadersAndSample(file);
        }
    }

    // Parseo de archivos Excel (.xlsx/.xls) utilizando la librería SheetJS (XLSX)
    function parseExcelFile(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Convertir hoja a matriz de arrays (header: 1) con strings vacíos por defecto
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                
                if (jsonData.length > 0) {
                    csvHeaders = jsonData[0];
                    // Filtrar filas vacías para evitar consultas inútiles
                    csvData = jsonData.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== ''));
                    
                    fileRowsText.textContent = csvData.length;
                    populateMappingDropdowns(csvHeaders);
                } else {
                    alert('El archivo Excel parece estar vacío.');
                    resetFileState();
                }
            } catch (err) {
                alert('Error al procesar el archivo Excel: ' + err.message);
                resetFileState();
            }
        };
        reader.onerror = function() {
            alert('Error al leer el archivo Excel.');
            resetFileState();
        };
        reader.readAsArrayBuffer(file);
    }

    function resetFileState() {
        loadedFile = null;
        csvData = [];
        csvHeaders = [];
        fileInput.value = '';
        
        // UI resets
        dropZone.classList.remove('hidden');
        fileDetailsPanel.classList.add('hidden');
        csvConfigPanel.classList.add('hidden');
        resultsCard.classList.add('hidden');
        progressCard.classList.add('hidden');
        
        // Reset selectors
        colDocNum.innerHTML = '<option value="">Seleccione columna...</option>';
        colDocNum.disabled = true;
        colDocType.innerHTML = '<option value="">Seleccione columna (o usar fijo)...</option><option value="fixed">-- VALOR FIJO EN TODO EL LOTE --</option>';
        colDocType.disabled = true;
        fixedTypeGroup.classList.add('hidden');
    }

    // Parseo de los encabezados y llenado de dropdowns
    function parseHeadersAndSample(file) {
        Papa.parse(file, {
            preview: 1, // Solo la fila de cabecera
            delimiter: csvDelimiter.value === 'auto' ? '' : csvDelimiter.value,
            skipEmptyLines: 'greedy',
            complete: function(results) {
                if (results.data && results.data.length > 0) {
                    csvHeaders = results.data[0];
                    
                    // Llenar los campos de mapeo
                    populateMappingDropdowns(csvHeaders);
                    
                    // Contar total de filas del archivo
                    countTotalRows(file);
                } else {
                    alert('El archivo cargado parece estar vacío.');
                    resetFileState();
                }
            },
            error: function(err) {
                alert('Error al leer el archivo: ' + err.message);
                resetFileState();
            }
        });
    }

    // Cambiar delimitador recarga las cabeceras
    csvDelimiter.addEventListener('change', () => {
        if (loadedFile) {
            parseHeadersAndSample(loadedFile);
        }
    });

    function populateMappingDropdowns(headers) {
        // Guardar seleccionados antes de resetear por si acaso
        const prevDocVal = colDocNum.value;
        const prevTypeVal = colDocType.value;

        // Reset
        colDocNum.innerHTML = '<option value="">Seleccione columna...</option>';
        colDocType.innerHTML = '<option value="">Seleccione columna (o usar fijo)...</option><option value="fixed">-- VALOR FIJO EN TODO EL LOTE --</option>';

        headers.forEach((header, index) => {
            const cleanHeader = header.trim();
            const option1 = new Option(cleanHeader, index);
            const option2 = new Option(cleanHeader, index);
            colDocNum.add(option1);
            colDocType.add(option2);
        });

        // Intentar auto-mapear columnas comunes en Colombia
        const docKeywords = ['documento', 'identificacion', 'cedula', 'numero', 'doc', 'num_doc', 'cc', 'nro'];
        const typeKeywords = ['tipo', 'tip_doc', 'tipo_doc', 'clase'];

        let matchedDocIdx = -1;
        let matchedTypeIdx = -1;

        headers.forEach((header, index) => {
            const clean = header.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            if (matchedDocIdx === -1 && docKeywords.some(kw => clean.includes(kw))) {
                matchedDocIdx = index;
            }
            if (matchedTypeIdx === -1 && typeKeywords.some(kw => clean.includes(kw))) {
                matchedTypeIdx = index;
            }
        });

        if (matchedDocIdx !== -1) colDocNum.value = matchedDocIdx;
        if (matchedTypeIdx !== -1) colDocType.value = matchedTypeIdx;

        // Habilitar
        colDocNum.disabled = false;
        colDocType.disabled = false;

        // Mostrar panel de configuración
        csvConfigPanel.classList.remove('hidden');
    }

    function countTotalRows(file) {
        Papa.parse(file, {
            delimiter: csvDelimiter.value === 'auto' ? '' : csvDelimiter.value,
            skipEmptyLines: 'greedy',
            complete: function(results) {
                // Guardamos la data completa en memoria. Restamos 1 por la cabecera
                csvData = results.data.slice(1);
                fileRowsText.textContent = csvData.length;
            }
        });
    }

    // Toggle valor fijo de tipo documento
    colDocType.addEventListener('change', (e) => {
        if (e.target.value === 'fixed') {
            fixedTypeGroup.classList.remove('hidden');
        } else {
            fixedTypeGroup.classList.add('hidden');
        }
    });

    // Sliders de Configuración de Lote
    sliderConcurrency.addEventListener('input', (e) => {
        valConcurrency.textContent = e.target.value;
    });

    sliderDelay.addEventListener('input', (e) => {
        valDelay.textContent = `${e.target.value} ms`;
    });


    // ==========================================================================
    // 4. BATCH RUNNER & QUEUE LOGIC (CONSULTA MASIVA)
    // ==========================================================================
    
    btnStartBatch.addEventListener('click', () => {
        if (!colDocNum.value) {
            alert('Por favor, selecciona la columna correspondiente al Número de Documento.');
            return;
        }
        if (!colDocType.value) {
            alert('Por favor, selecciona la columna correspondiente al Tipo de Documento.');
            return;
        }

        // Inicializar el lote
        initBatchProcessing();
    });

    btnPauseBatch.addEventListener('click', () => {
        isPaused = true;
        btnPauseBatch.classList.add('hidden');
        btnResumeBatch.classList.remove('hidden');
        progressStatusText.innerHTML = '<span class="text-warning font-bold">PROCESO PAUSADO</span>. Puedes reanudarlo cuando desees.';
        progressSpinner.className = 'fa-solid fa-circle-pause text-warning';
    });

    btnResumeBatch.addEventListener('click', () => {
        isPaused = false;
        btnResumeBatch.classList.add('hidden');
        btnPauseBatch.classList.remove('hidden');
        progressStatusText.textContent = 'Procesando cola de consultas...';
        progressSpinner.className = 'fa-solid fa-spinner fa-spin text-accent';
        
        // Reiniciar los hilos de ejecución
        runQueue();
    });

    btnCancelBatch.addEventListener('click', () => {
        if (confirm('¿Está seguro de que desea cancelar el procesamiento? Los registros procesados hasta ahora se mantendrán.')) {
            cancelBatchProcessing();
        }
    });

    function initBatchProcessing() {
        // Reset de flags de estado
        isPaused = false;
        isCancelled = false;
        activeCount = 0;
        processedRecords = [];
        
        // Limpiar tabla visual de resultados
        resultsTbody.innerHTML = '';
        
        // Crear cola de índices
        queue = [...Array(csvData.length).keys()];
        recordRetries = new Array(csvData.length).fill(0);
        
        // Contadores iniciales
        countTotal = csvData.length;
        countSuccess = 0;
        countError = 0;
        countPending = countTotal;

        // UI Updates
        statTotal.textContent = countTotal;
        statSuccess.textContent = '0';
        statError.textContent = '0';
        statPending.textContent = countTotal;
        statTime.textContent = '00:00';
        
        progressBarFill.style.width = '0%';
        progressBarPercent.textContent = '0%';

        // Mostrar paneles de progreso y resultados
        progressCard.classList.remove('hidden');
        resultsCard.classList.remove('hidden');
        
        // Desplazar vista a resultados
        progressCard.scrollIntoView({ behavior: 'smooth' });

        // Bloquear configuraciones del CSV durante la ejecución
        toggleConfigurationControls(true);

        // Ocultar botones de pausa/reanudar al iniciar y configurar correctamente
        btnResumeBatch.classList.add('hidden');
        btnPauseBatch.classList.remove('hidden');
        btnDownloadResults.classList.add('disabled');
        btnDownloadResults.disabled = true;
        btnDownloadExcel.classList.add('disabled');
        btnDownloadExcel.disabled = true;

        progressStatusText.textContent = 'Procesando cola de consultas...';
        progressSpinner.className = 'fa-solid fa-spinner fa-spin text-accent';

        // Tiempos
        startTime = Date.now();
        clearInterval(timerInterval);
        timerInterval = setInterval(updateTimer, 1000);

        // Lanzar los trabajadores (Workers) iniciales
        runQueue();
    }

    function toggleConfigurationControls(disable) {
        colDocNum.disabled = disable;
        colDocType.disabled = disable;
        csvDelimiter.disabled = disable;
        fixedDocType.disabled = disable;
        sliderConcurrency.disabled = disable;
        sliderDelay.disabled = disable;
        btnStartBatch.disabled = disable;
        btnRemoveFile.disabled = disable;
    }

    // Corre la cola dinámicamente controlando concurrencia y delay
    async function runQueue() {
        const concurrency = parseInt(sliderConcurrency.value);
        const delay = parseInt(sliderDelay.value);

        while (activeCount < concurrency && queue.length > 0 && !isPaused && !isCancelled) {
            const recordIndex = queue.shift();
            activeCount++;
            
            // Procesamiento asíncrono
            processRecord(recordIndex);

            // Si hay delay especificado, esperar antes de instanciar el siguiente hilo
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async function processRecord(index) {
        const rowData = csvData[index];
        
        // Mapear campos
        const docColIdx = parseInt(colDocNum.value);
        const typeColIdx = colDocType.value === 'fixed' ? 'fixed' : parseInt(colDocType.value);

        const rawNumDoc = rowData[docColIdx] || '';
        // Limpieza de documento (solo números)
        const cleanNumDoc = rawNumDoc.toString().replace(/[^0-9]/g, '');

        let cleanTipDoc = '3'; // Default CC
        if (typeColIdx === 'fixed') {
            cleanTipDoc = fixedDocType.value;
        } else {
            const rawType = rowData[typeColIdx] || '';
            cleanTipDoc = parseDocumentType(rawType);
        }

        // Crear fila en la tabla de forma reactiva
        const rowId = `row-${index}`;
        createTableRow(index, cleanNumDoc, cleanTipDoc, rowId);

        let data = null;
        let querySuccess = false;
        let errorMsg = '';

        try {
            const extraData = {};
            if (csvHeaders && csvHeaders.length > 0) {
                csvHeaders.forEach((header, colIdx) => {
                    extraData[header] = rowData[colIdx] || '';
                });
            }
            data = await queryRuiApi(cleanNumDoc, cleanTipDoc, extraData);
            if (data && data.ok) {
                querySuccess = true;
            } else {
                errorMsg = (data && data.error) ? data.error : 'No registrado o error de datos';
            }
        } catch (err) {
            errorMsg = err.message || 'Error de conexión';
        }

        // Si fue cancelado a mitad de camino
        if (isCancelled) {
            activeCount--;
            return;
        }

        const maxAttempts = 15; // Reintentos máximos por registro antes de declararlo error

        if (querySuccess) {
            // ÉXITO: Registrar y guardar resultado
            const finalStatus = 'success';
            countSuccess++;
            const resultObj = {
                doc_tipo_original: cleanTipDoc,
                doc_numero: cleanNumDoc,
                nombre: data.nombre || 'NO REGISTRADO',
                sexo: data.sexo || 'No especificado',
                edad: data.edad !== undefined ? data.edad : '',
                departamento: data.departamento || '',
                municipio: data.municipio || '',
                cod_municipio: data.codMpio || '',
                grupo_ingresos: data.grupoIngresos || '',
                grupo_rui: data.grupRui && data.grupRui !== 'nan' ? data.grupRui : '',
                nivel_rui: data.nivelRui || '',
                estado: 'Encontrado'
            };

            processedRecords.push({
                original_row: rowData,
                ...resultObj
            });

            // Actualizar fila en la tabla a Encontrado (verde)
            updateTableRow(rowId, finalStatus, resultObj);

            // Actualizar contadores y progreso
            countPending--;
            updateProgressUI();

            // Decrementar hilos activos y continuar vaciando cola
            activeCount--;

            if (queue.length === 0 && activeCount === 0) {
                finishBatchProcessing();
            } else {
                runQueue();
            }
        } else {
            // FALLA: Incrementar contador de intentos para este registro
            recordRetries[index] = (recordRetries[index] || 0) + 1;
            const attempts = recordRetries[index];

            if (attempts < maxAttempts && !isCancelled) {
                // REINTENTO: Actualizar UI a "Reintentando" y volver a colocar el índice al final de la cola
                updateTableRow(rowId, 'retry', { attempts, maxAttempts });
                
                // Mover al final de la cola para que otros documentos se sigan consultando
                queue.push(index);

                activeCount--;
                
                // Si el delay está configurado en 0, esperar un breve instante (50ms) para no saturar al instante
                const delay = parseInt(sliderDelay.value);
                if (delay === 0) {
                    setTimeout(() => runQueue(), 50);
                } else {
                    runQueue();
                }
            } else {
                // FRACASO DEFINITIVO: Superó los intentos permitidos
                const finalStatus = 'error';
                countError++;
                const resultObj = {
                    doc_tipo_original: cleanTipDoc,
                    doc_numero: cleanNumDoc,
                    nombre: '',
                    sexo: '',
                    edad: '',
                    departamento: '',
                    municipio: '',
                    cod_municipio: '',
                    grupo_ingresos: '',
                    grupo_rui: '',
                    nivel_rui: '',
                    estado: errorMsg.includes('No registrado') ? 'No Encontrado' : `Error: ${errorMsg}`
                };

                processedRecords.push({
                    original_row: rowData,
                    ...resultObj
                });

                // Actualizar fila en la tabla a Error (rojo)
                updateTableRow(rowId, finalStatus, resultObj);

                // Actualizar contadores y progreso
                countPending--;
                updateProgressUI();

                activeCount--;

                if (queue.length === 0 && activeCount === 0) {
                    finishBatchProcessing();
                } else {
                    runQueue();
                }
            }
        }
    }

    function createTableRow(index, numDoc, tipDoc, rowId) {
        const tr = document.createElement('tr');
        tr.id = rowId;

        // Traducir tipo
        const typeText = DOCUMENT_TYPES_MAP[tipDoc] ? DOCUMENT_TYPES_MAP[tipDoc].split(' ')[0] : tipDoc;

        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${numDoc}</td>
            <td><span class="text-secondary">${typeText}</span></td>
            <td class="col-nombre text-muted">Consultando...</td>
            <td class="col-sexo">-</td>
            <td class="col-edad">-</td>
            <td class="col-depto">-</td>
            <td class="col-mpio">-</td>
            <td class="col-ingresos">-</td>
            <td class="col-gruprui">-</td>
            <td class="col-nivelrui">-</td>
            <td><span class="status-pill pending"><i class="fa-solid fa-spinner fa-spin"></i> En Cola</span></td>
        `;

        resultsTbody.appendChild(tr);

        // Auto-scroll del contenedor de la tabla para ver las últimas filas procesadas
        const wrapper = resultsTbody.closest('.table-container');
        wrapper.scrollTop = wrapper.scrollHeight;
    }

    function updateTableRow(rowId, status, data) {
        const tr = document.getElementById(rowId);
        if (!tr) return;

        const colNombre = tr.querySelector('.col-nombre');
        const colSexo = tr.querySelector('.col-sexo');
        const colEdad = tr.querySelector('.col-edad');
        const colDepto = tr.querySelector('.col-depto');
        const colMpio = tr.querySelector('.col-mpio');
        const colIngresos = tr.querySelector('.col-ingresos');
        const colGruprui = tr.querySelector('.col-gruprui');
        const colNivelrui = tr.querySelector('.col-nivelrui');
        const colStatus = tr.lastElementChild;

        if (status === 'success') {
            colNombre.textContent = data.nombre;
            colNombre.className = 'col-nombre font-bold';
            colSexo.textContent = data.sexo;
            colEdad.textContent = data.edad ? `${data.edad} años` : '-';
            colDepto.textContent = data.departamento;
            colMpio.textContent = data.municipio;
            colIngresos.textContent = data.grupo_ingresos || '-';
            colGruprui.textContent = data.grupo_rui || '-';
            colNivelrui.textContent = data.nivel_rui || '-';
            colStatus.innerHTML = `<span class="status-pill success"><i class="fa-solid fa-circle-check"></i> Encontrado</span>`;
        } else if (status === 'retry') {
            colNombre.textContent = 'Reintentando...';
            colNombre.className = 'col-nombre text-secondary italic animate-pulse';
            colStatus.innerHTML = `<span class="status-pill pending" title="Falla temporal. Reintentando consulta con otro proxy..."><i class="fa-solid fa-spinner fa-spin"></i> Reintento ${data.attempts}/${data.maxAttempts}</span>`;
        } else {
            colNombre.textContent = '-';
            colNombre.className = 'col-nombre text-muted';
            colStatus.innerHTML = `<span class="status-pill error" title="${data.estado}"><i class="fa-solid fa-circle-xmark"></i> ${data.estado.substring(0, 15)}...</span>`;
        }
    }

    function updateProgressUI() {
        statSuccess.textContent = countSuccess;
        statError.textContent = countError;
        statPending.textContent = countPending;

        const processed = countTotal - countPending;
        const percent = Math.round((processed / countTotal) * 100);
        
        progressBarFill.style.width = `${percent}%`;
        progressBarPercent.textContent = `${percent}%`;
    }

    function updateTimer() {
        if (!startTime) return;
        const elapsedMs = Date.now() - startTime;
        const seconds = Math.floor((elapsedMs / 1000) % 60);
        const minutes = Math.floor((elapsedMs / 1000 / 60) % 60);
        
        const pad = (val) => val.toString().padStart(2, '0');
        statTime.textContent = `${pad(minutes)}:${pad(seconds)}`;
    }

    function finishBatchProcessing() {
        clearInterval(timerInterval);
        
        progressSpinner.className = 'fa-solid fa-circle-check text-success';
        progressStatusText.innerHTML = '<span class="text-success font-bold">¡PROCESAMIENTO COMPLETADO!</span> Todos los registros han sido evaluados.';
        
        // Reactivar controles
        toggleConfigurationControls(false);
        
        btnPauseBatch.classList.add('hidden');
        btnResumeBatch.classList.add('hidden');

        // Habilitar descarga
        btnDownloadResults.classList.remove('disabled');
        btnDownloadResults.disabled = false;
        btnDownloadExcel.classList.remove('disabled');
        btnDownloadExcel.disabled = false;
    }

    function cancelBatchProcessing() {
        isCancelled = true;
        clearInterval(timerInterval);
        
        progressSpinner.className = 'fa-solid fa-circle-xmark text-danger';
        progressStatusText.innerHTML = '<span class="text-danger font-bold">PROCESO CANCELADO</span>. Cola de consultas detenida.';
        
        // Reactivar controles
        toggleConfigurationControls(false);
        
        btnPauseBatch.classList.add('hidden');
        btnResumeBatch.classList.add('hidden');

        // Permitir descarga de lo procesado hasta ahora si hay éxitos o fallos
        if (processedRecords.length > 0) {
            btnDownloadResults.classList.remove('disabled');
            btnDownloadResults.disabled = false;
            btnDownloadExcel.classList.remove('disabled');
            btnDownloadExcel.disabled = false;
        }
    }


    // ==========================================================================
    // 5. EXPORT & UTILS LOGIC
    // ==========================================================================
    
    // Descarga de resultados en formato CSV
    btnDownloadResults.addEventListener('click', () => {
        if (processedRecords.length === 0) return;

        // Estructurar cabeceras de salida
        // Mantener la data original y agregar las columnas de consulta RUI
        const headers = [
            ...csvHeaders,
            'RUI_Tipo_Doc',
            'RUI_Numero_Doc',
            'RUI_Nombre_Completo',
            'RUI_Sexo',
            'RUI_Edad',
            'RUI_Departamento',
            'RUI_Municipio',
            'RUI_Cod_Municipio',
            'RUI_Grupo_Ingresos',
            'RUI_Grupo',
            'RUI_Nivel',
            'RUI_Estado_Consulta'
        ];

        // Mapear cada registro
        const rows = processedRecords.map(item => {
            return [
                ...item.original_row,
                item.doc_tipo_original,
                item.doc_numero,
                item.nombre,
                item.sexo,
                item.edad,
                item.departamento,
                item.municipio,
                item.cod_municipio,
                item.grupo_ingresos,
                item.grupo_rui,
                item.nivel_rui,
                item.estado
            ];
        });

        // Crear string de CSV robusto con PapaParse
        const csvString = Papa.unparse({
            fields: headers,
            data: rows
        }, {
            quotes: true,
            delimiter: ';' // Usar punto y coma como es estándar en Excel en español
        });

        // Forzar codificación UTF-8 con BOM para que Excel en español abra los tildes y eñes correctamente
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.setAttribute('href', url);
        
        // Nombre del archivo de salida
        const originalName = loadedFile ? loadedFile.name.replace(/\.[^/.]+$/, "") : "resultados";
        link.setAttribute('download', `${originalName}_RESULTADOS_RUI.csv`);
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // Descarga de resultados en formato Excel (.xlsx) utilizando la librería SheetJS (XLSX)
    btnDownloadExcel.addEventListener('click', () => {
        if (processedRecords.length === 0) return;

        // Estructurar cabeceras de salida
        // Mantener la data original y agregar las columnas de consulta RUI
        const headers = [
            ...csvHeaders,
            'RUI_Tipo_Doc',
            'RUI_Numero_Doc',
            'RUI_Nombre_Completo',
            'RUI_Sexo',
            'RUI_Edad',
            'RUI_Departamento',
            'RUI_Municipio',
            'RUI_Cod_Municipio',
            'RUI_Grupo_Ingresos',
            'RUI_Grupo',
            'RUI_Nivel',
            'RUI_Estado_Consulta'
        ];

        // Mapear cada registro
        const rows = processedRecords.map(item => {
            return [
                ...item.original_row,
                item.doc_tipo_original,
                item.doc_numero,
                item.nombre,
                item.sexo,
                item.edad,
                item.departamento,
                item.municipio,
                item.cod_municipio,
                item.grupo_ingresos,
                item.grupo_rui,
                item.nivel_rui,
                item.estado
            ];
        });

        // Crear una hoja de cálculo a partir de la matriz de datos
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        
        // Estilo básico para ajustar los anchos de columna automáticamente
        const colWidths = headers.map((h, i) => {
            let maxLen = h.toString().length;
            rows.forEach(r => {
                const val = r[i] !== undefined && r[i] !== null ? r[i].toString() : '';
                if (val.length > maxLen) maxLen = val.length;
            });
            return { wch: Math.min(maxLen + 3, 40) }; // Máximo ancho de 40 para evitar celdas gigantescas
        });
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Resultados RUI");

        // Generar archivo Excel binario y disparar descarga en navegador
        const originalName = loadedFile ? loadedFile.name.replace(/\.[^/.]+$/, "") : "resultados";
        XLSX.writeFile(wb, `${originalName}_RESULTADOS_RUI.xlsx`);
    });

    // Filtro de búsqueda rápida en la tabla
    tableFilter.addEventListener('input', (e) => {
        const value = e.target.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const rows = resultsTbody.getElementsByTagName('tr');

        for (let i = 0; i < rows.length; i++) {
            const cells = rows[i].getElementsByTagName('td');
            let matched = false;
            
            // Buscar en todas las celdas de la fila
            for (let j = 0; j < cells.length; j++) {
                const cellText = cells[j].textContent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (cellText.includes(value)) {
                    matched = true;
                    break;
                }
            }
            
            if (matched) {
                rows[i].classList.remove('hidden');
            } else {
                rows[i].classList.add('hidden');
            }
        }
    });

    // Limpiador/analizador inteligente de tipos de documentos en CSV
    function parseDocumentType(rawType) {
        const typeStr = rawType.toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        if (typeStr === '3' || typeStr.includes('cc') || typeStr.includes('cedula')) {
            return '3';
        }
        if (typeStr === '2' || typeStr.includes('ti') || typeStr.includes('tarjeta') || typeStr.includes('identidad')) {
            return '2';
        }
        if (typeStr === '1' || typeStr.includes('rc') || typeStr.includes('registro') || typeStr.includes('civil')) {
            return '1';
        }
        if (typeStr === '4' || typeStr.includes('ce') || typeStr.includes('extranjeria')) {
            return '4';
        }
        if (typeStr === '5' || typeStr.includes('pa') || typeStr.includes('pasaporte')) {
            return '5';
        }
        if (typeStr === '9' || typeStr.includes('ppt') || typeStr.includes('proteccion') || typeStr.includes('temporal')) {
            return '9';
        }
        
        // Si ya es un número que coincide con los válidos
        if (['1', '2', '3', '4', '5', '9'].includes(typeStr)) {
            return typeStr;
        }

        // Fallback por defecto
        return '3';
    }

    // Formatear tamaño de archivos
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
});
