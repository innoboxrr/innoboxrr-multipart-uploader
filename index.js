(function (root, factory) {
    
    if (typeof define === 'function' && define.amd) {
    
        // AMD. Register as an anonymous module.
        define([], factory);
    
    } else if (typeof module === 'object' && module.exports) {
    
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory();
    
    } else {
    
        // Browser globals (root is window)
        root.MultipartUploader = factory();
    
    }

}(typeof self !== 'undefined' ? self : this, function () {

    class MultipartUploader {

        constructor(videoIdentifier, params = {}) {

            this.token = params.token; // CSRF Token

            this.initiateUploadRoute = params.initiateUploadRoute;

            this.signPartUploadRoute = params.signPartUploadRoute;

            this.completeUploadRoute = params.completeUploadRoute;

            this.isPaused = false;
            
            this.currentPartNumber = 1;
            
            this.maxRetries = 3;
            
            this.chunkSize = (params.chunkSize ?? 5) * 1024 * 1024; // 5MB
            
            this.parts = [];
            
            this.file = null;
            
            this.uploadId = null;
            
            this.videoIdentifier = videoIdentifier; // Identificador personalizado del video
            
            this.eventHandlers = {
                'progress': [],
                'complete': [],
                // otros eventos pueden ser agregados aquí
            };
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

            // Por ahora solo admite videos en formato MP4
            if (!file.type || file.type !== 'video/mp4') {
                throw new Error('The file must be a MP4 video.');
            }

            this.file = file;
            const totalParts = Math.ceil(this.file.size / this.chunkSize);
            
            // Iniciar la carga con una petición al servidor
            const initiateResponse = await axios.post(this.initiateUploadRoute, {
                _token: this.token,
                video_identifier: this.videoIdentifier
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
                        // Añadir el tamaño de la parte exitosamente cargada al tamaño total cargado
                        uploadedSize += Math.min(this.chunkSize, this.file.size - uploadedSize);
                        // Calcular el progreso total como un porcentaje
                        const totalProgress = (uploadedSize / this.file.size) * 100;
                        // Emitir el evento de progreso con el porcentaje total
                        this.emit('progress', totalProgress);
                    } catch (error) {
                        retries++;
                        if (retries >= this.maxRetries) {
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

            // Obtener la URL firmada del servidor
            const signedResponse = await axios.post(this.signPartUploadRoute, {
                _token: this.token,
                video_identifier: this.videoIdentifier,
                upload_id: this.uploadId,
                part_number: partNumber
            });

            const url = signedResponse.data.url;

            // Cargar la parte al servidor
            const uploadResponse = await axios.put(url, blob, {
                headers: {
                    'Content-Type': 'application/octet-stream'
                },
                withCredentials: false
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
            await axios.post(this.completeUploadRoute, {
                _token: this.token,
                video_identifier: this.videoIdentifier,
                upload_id: this.uploadId,
                parts: this.parts
            });

            this.emit('complete', true);
        }

    }

    // Finalmente, retornarías tu constructor o librería
    return MultipartUploader;
}));
