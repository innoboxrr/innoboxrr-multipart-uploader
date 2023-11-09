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
    // Aquí colocarías todo tu código del MultipartUploader

    class MultipartUploader {
        constructor(videoIdentifier) {
            this.isPaused = false;
            this.currentPartNumber = 1;
            this.maxRetries = 3;
            this.chunkSize = 5 * 1024 * 1024; // 5MB
            this.parts = [];
            this.file = null;
            this.uploadId = null;
            this.videoIdentifier = videoIdentifier; // Identificador personalizado del video
        }

        // Inicia la carga del archivo
        async startUpload(file) {
            if (!file.type || file.type !== 'video/mp4') {
                throw new Error('The file must be a MP4 video.');
            }

            this.file = file;
            const totalParts = Math.ceil(this.file.size / this.chunkSize);
            
            // Iniciar la carga con una petición al servidor
            const initiateResponse = await axios.post('{{ route('videoprocessor.initiate.upload') }}', {
                _token: token.value,
                video_identifier: this.videoIdentifier
            });
            
            this.uploadId = initiateResponse.data.upload_id;
            await this.uploadParts(totalParts);
        }

        // Carga las partes del archivo
        async uploadParts(totalParts) {
            while (this.currentPartNumber <= totalParts && !this.isPaused) {
                let retries = 0;
                let success = false;

                while (retries < this.maxRetries && !success) {
                    try {
                        await this.uploadPart(this.currentPartNumber);
                        success = true;
                    } catch (error) {
                        retries++;
                        if (retries === this.maxRetries) {
                            throw new Error(`Failed uploading part ${this.currentPartNumber} after ${this.maxRetries} retries.`);
                        }
                    }
                }

                this.currentPartNumber++;
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
            const signedResponse = await axios.post('{{ route('videoprocessor.sign.part.upload') }}', {
                _token: token.value,
                video_identifier: this.videoIdentifier,
                upload_id: this.uploadId,
                part_number: partNumber
            });

            const url = signedResponse.data.url;

            // Cargar la parte al servidor
            const uploadResponse = await axios.put(url, blob, {
                headers: {
                    'Content-Type': 'application/octet-stream'
                }
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
            await axios.post('{{ route('videoprocessor.complete.upload') }}', {
                _token: token.value,
                video_identifier: this.videoIdentifier,
                upload_id: this.uploadId,
                parts: this.parts
            });
        }
    }

    // Finalmente, retornarías tu constructor o librería
    return MultipartUploader;
}));
