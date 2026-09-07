import axios from 'axios'

/**
 * Sube un archivo en partes contra un backend que firma cada una.
 *
 * El flujo son tres rutas del servidor: una que inicia la subida y devuelve el
 * `upload_id`, otra que firma cada parte, y otra que la cierra.
 *
 *     const uploader = new MultipartUploader('video-42', {
 *         initiateUploadRoute: route('api.upload.initiate'),
 *         signPartUploadRoute: route('api.upload.sign'),
 *         completeUploadRoute: route('api.upload.complete'),
 *     })
 *
 *     uploader.on('progress', (percent) => ...)
 *     uploader.on('complete', ({ response }) => ...)
 *     uploader.on('error', (error) => ...)
 *
 *     await uploader.startUpload(file)
 */
export default class MultipartUploader {
    /**
     * @param {string} fileIdentifier
     * @param {object} [params]
     */
    constructor(fileIdentifier, params = {}) {
        this.token = params.token
        this.initiateUploadRoute = params.initiateUploadRoute
        this.signPartUploadRoute = params.signPartUploadRoute
        this.completeUploadRoute = params.completeUploadRoute

        this.allowedFileTypes = params.allowedFileTypes ?? ['*']
        this.chunkSize = (params.chunkSize ?? 5) * 1024 * 1024
        this.maxRetries = params.maxRetries ?? 3
        this.retryInterval = params.retryInterval ?? 1000

        this.file = null
        this.uploadId = null
        this.fileIdentifier = fileIdentifier
        this.filename = params.filename ?? null
        this.currentPartNumber = 1
        this.isPaused = false
        this.parts = []

        this.initiateUploadExtraParams = params.initiateUploadExtraParams ?? {}
        this.signPartUploadExtraParams = params.signPartUploadExtraParams ?? {}
        this.completeUploadExtraParams = params.completeUploadExtraParams ?? {}

        this.eventHandlers = { progress: [], complete: [], error: [], paused: [] }
    }

    /**
     * @param {File} file
     */
    validateFileType(file) {
        if (! file || ! file.type) {
            throw new Error('El archivo no tiene un tipo válido.')
        }

        if (this.allowedFileTypes.includes('*')) {
            return true
        }

        if (! this.allowedFileTypes.includes(file.type)) {
            throw new Error(
                `El tipo de archivo "${file.type}" no está permitido. `
                + `Tipos permitidos: ${this.allowedFileTypes.join(', ')}`
            )
        }

        return true
    }

    /**
     * @param {string} event
     * @param {Function} handler
     */
    on(event, handler) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].push(handler)
        }

        return this
    }

    /**
     * @param {string} event
     * @param {Function} handler
     */
    off(event, handler) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event] = this.eventHandlers[event].filter((h) => h !== handler)
        }

        return this
    }

    emit(event, data) {
        (this.eventHandlers[event] ?? []).forEach((handler) => handler(data))
    }

    /**
     * @param {File} file
     */
    async startUpload(file) {
        this.validateFileType(file)

        this.file = file
        this.parts = []
        this.currentPartNumber = 1
        this.isPaused = false

        const { data } = await axios.post(this.initiateUploadRoute, {
            _token: this.token,
            file_identifier: this.fileIdentifier,
            filename: this.filename,
            ...this.initiateUploadExtraParams,
        })

        this.uploadId = data.upload_id

        return this.uploadParts()
    }

    get totalParts() {
        return Math.ceil(this.file.size / this.chunkSize)
    }

    async uploadParts() {
        const total = this.totalParts

        while (this.currentPartNumber <= total && ! this.isPaused) {
            await this.uploadPartWithRetries(this.currentPartNumber)

            this.currentPartNumber++

            this.emit('progress', Math.min(100, ((this.currentPartNumber - 1) / total) * 100))
        }

        if (this.isPaused) {
            this.emit('paused', { part: this.currentPartNumber })

            return null
        }

        return this.completeUpload()
    }

    /**
     * @param {number} partNumber
     */
    async uploadPartWithRetries(partNumber) {
        let attempt = 0

        for (;;) {
            try {
                return await this.uploadPart(partNumber)
            } catch (error) {
                attempt++

                if (attempt >= this.maxRetries) {
                    const message = `Failed uploading part ${partNumber} after ${this.maxRetries} retries.`

                    // Se avisa y se lanza: quien llame decide, y quien solo
                    // escuche el evento se entera igual.
                    this.emit('error', message)

                    throw new Error(message, { cause: error })
                }

                // Sin espera, los tres intentos salen casi a la vez y no le dan
                // tiempo a recuperarse a nada.
                await new Promise((resolve) => setTimeout(resolve, this.retryInterval * attempt))
            }
        }
    }

    /**
     * @param {number} partNumber
     */
    async uploadPart(partNumber) {
        const start = (partNumber - 1) * this.chunkSize
        const blob = this.file.slice(start, start + this.chunkSize)

        const { data } = await axios.post(this.signPartUploadRoute, {
            _token: this.token,
            file_identifier: this.fileIdentifier,
            filename: this.filename,
            upload_id: this.uploadId,
            part_number: partNumber,
            ...this.signPartUploadExtraParams,
        })

        const response = await axios.put(data.url, blob, {
            headers: { 'Content-Type': 'application/octet-stream' },
            withCredentials: false,
        })

        if (response.status !== 200) {
            throw new Error(`Failed uploading part ${partNumber}`)
        }

        // Reintentar una parte que ya se habia subido dejaba dos entradas con
        // el mismo PartNumber, y S3 rechaza la lista al cerrar.
        this.parts = this.parts.filter((part) => part.PartNumber !== partNumber)
        this.parts.push({ ETag: response.headers.etag, PartNumber: partNumber })

        return response
    }

    pauseUpload() {
        this.isPaused = true

        return this
    }

    /**
     * Devuelve la promesa, para poder esperarla o capturar su error. Antes se
     * lanzaba sin devolverla, así que un fallo al reanudar acababa en un
     * rechazo no capturado.
     */
    resumeUpload() {
        if (! this.file) {
            throw new Error('No hay ninguna subida que reanudar.')
        }

        this.isPaused = false

        return this.uploadParts()
    }

    async completeUpload() {
        const response = await axios.post(this.completeUploadRoute, {
            _token: this.token,
            file_identifier: this.fileIdentifier,
            filename: this.filename,
            upload_id: this.uploadId,
            // S3 exige las partes ordenadas por número.
            parts: [...this.parts].sort((a, b) => a.PartNumber - b.PartNumber),
            ...this.completeUploadExtraParams,
        })

        this.emit('complete', { status: true, response })

        return response
    }
}

export { MultipartUploader }
