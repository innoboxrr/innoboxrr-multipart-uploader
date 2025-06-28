(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory); // AMD
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(); // CommonJS
    } else {
        root.MultipartUploader = factory(); // Browser globals
    }
}(typeof self !== 'undefined' ? self : this, function () {

    class MultipartUploader {
        constructor(fileIdentifier, params = {}) {
            this.token = params.token; // CSRF Token
            this.initiateUploadRoute = params.initiateUploadRoute;
            this.signPartUploadRoute = params.signPartUploadRoute;
            this.completeUploadRoute = params.completeUploadRoute;
            this.allowedFileTypes = params.allowedFileTypes || ['*']; // Tipos de archivo permitidos ('*' para cualquiera)
            this.chunkSize = (params.chunkSize ?? 5) * 1024 * 1024; // Tamaño de chunk en MB (5 MB por defecto)
            this.maxRetries = params.maxRetries ?? 3; // Reintentos por defecto
            this.file = null;
            this.uploadId = null;
            this.fileIdentifier = fileIdentifier; // Identificador único para el archivo
            this.filename = params.filename || null;
            this.currentPartNumber = 1;
            this.isPaused = false;
            this.parts = [];
            this.initiateUploadExtraParams = params.initiateUploadExtraParams || {};
            this.signPartUploadExtraParams = params.signPartUploadExtraParams || {};
            this.completeUploadExtraParams = params.completeUploadExtraParams || {};
            this.eventHandlers = {
                'progress': [],
                'complete': [],
                'error': [],
            };
        }

        // Validar el tipo de archivo
        validateFileType(file) {
            if (!file || !file.type) {
                throw new Error('El archivo no tiene un tipo válido.');
            }

            if (this.allowedFileTypes.includes('*')) {
                return true; // Aceptar cualquier archivo
            }

            if (!this.allowedFileTypes.includes(file.type)) {
                throw new Error(`El tipo de archivo "${file.type}" no está permitido. Tipos permitidos: ${this.allowedFileTypes.join(', ')}`);
            }
        }

        // Método para registrar manejadores de eventos
        on(event, handler) {
            if (this.eventHandlers[event]) {
                this.eventHandlers[event].push(handler);
            }
            return this; // Permitir encadenamiento
        }

        // Método para emitir eventos
        emit(event, data) {
            if (this.eventHandlers[event]) {
                this.eventHandlers[event].forEach(handler => handler(data));
            }
        }

        // Inicia la carga del archivo
        async startUpload(file) {
            this.validateFileType(file);
            this.file = file;

            const totalParts = Math.ceil(this.file.size / this.chunkSize);

            // Iniciar la carga con una petición al servidor
            const initiateResponse = await axios.post(this.initiateUploadRoute, {
                _token: this.token,
                file_identifier: this.fileIdentifier,
                filename: this.filename,
                ...this.initiateUploadExtraParams,
            });

            this.uploadId = initiateResponse.data.upload_id;
            await this.uploadParts(totalParts);
        }

        // Carga las partes del archivo
        async uploadParts(totalParts) {
            let uploadedSize = 0;

            for (this.currentPartNumber; this.currentPartNumber <= totalParts && !this.isPaused; this.currentPartNumber++) {
                let retries = 0;
                let success = false;

                while (retries < this.maxRetries && !success) {
                    try {
                        await this.uploadPart(this.currentPartNumber);
                        success = true;

                        uploadedSize += Math.min(this.chunkSize, this.file.size - uploadedSize);
                        const totalProgress = (uploadedSize / this.file.size) * 100;
                        this.emit('progress', totalProgress);
                    } catch (error) {
                        retries++;
                        if (retries >= this.maxRetries) {
                            this.emit('error', `Failed uploading part ${this.currentPartNumber} after ${this.maxRetries} retries.`);
                            throw new Error(`Failed uploading part ${this.currentPartNumber} after ${this.maxRetries} retries.`);
                        }
                    }
                }
            }

            if (this.currentPartNumber > totalParts) {
                await this.completeUpload();
            }
        }

        // Carga una parte específica del archivo
        async uploadPart(partNumber) {
            const start = (partNumber - 1) * this.chunkSize;
            const end = partNumber * this.chunkSize;
            const blob = this.file.slice(start, end);

            const signedResponse = await axios.post(this.signPartUploadRoute, {
                _token: this.token,
                file_identifier: this.fileIdentifier,
                filename: this.filename,
                upload_id: this.uploadId,
                part_number: partNumber,
                ...this.signPartUploadExtraParams,
            });

            const url = signedResponse.data.url;

            const uploadResponse = await axios.put(url, blob, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                },
                withCredentials: false,
            });

            if (uploadResponse.status !== 200) {
                throw new Error(`Failed uploading part ${partNumber}`);
            }

            this.parts.push({ ETag: uploadResponse.headers.etag, PartNumber: partNumber });
        }

        // Pausar la carga
        pauseUpload() {
            this.isPaused = true;
        }

        // Reanudar la carga
        resumeUpload() {
            this.isPaused = false;
            const totalParts = Math.ceil(this.file.size / this.chunkSize);
            this.uploadParts(totalParts);
        }

        // Completar la carga
        async completeUpload() {
            let res = await axios.post(this.completeUploadRoute, {
                _token: this.token,
                file_identifier: this.fileIdentifier,
                filename: this.filename,
                upload_id: this.uploadId,
                parts: this.parts,
                ...this.completeUploadExtraParams,
            });

            this.emit('complete', {
                status: true,
                response: res
            });
        }
    }

    return MultipartUploader;
}));