import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'

import MultipartUploader from '../index.js'

vi.mock('axios')

const ROUTES = {
    initiateUploadRoute: '/api/upload/initiate',
    signPartUploadRoute: '/api/upload/sign',
    completeUploadRoute: '/api/upload/complete',
}

/**
 * Un File de `size` bytes cuyo slice devuelve algo identificable.
 */
const fileOf = (size, type = 'video/mp4') => {
    const file = new File(['x'], 'video.mp4', { type })

    Object.defineProperty(file, 'size', { value: size })

    file.slice = (start, end) => `bytes:${start}-${end}`

    return file
}

/** Un servidor de mentira: firma cada parte y acepta el PUT. */
const server = ({ failPart = null, failTimes = 0 } = {}) => {
    let failures = 0

    axios.post = vi.fn(async (url) => {
        if (url === ROUTES.initiateUploadRoute) {
            return { data: { upload_id: 'up-1' } }
        }

        if (url === ROUTES.signPartUploadRoute) {
            return { data: { url: 'https://s3/put' } }
        }

        return { data: { ok: true } }
    })

    axios.put = vi.fn(async (url, blob) => {
        const part = Number(String(blob).split(':')[1].split('-')[0]) / (1024 * 1024) + 1

        if (failPart !== null && Math.round(part) === failPart && failures < failTimes) {
            failures++

            throw new Error('S3 dijo que no')
        }

        return { status: 200, headers: { etag: `etag-${Math.round(part)}` } }
    })
}

describe('MultipartUploader', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        server()
    })

    /**
     * axios no se importaba en ninguna parte: el paquete lo declaraba como
     * dependencia y luego lo usaba como global. Fuera de un <script> con axios
     * en window, cualquier subida era un ReferenceError.
     */
    it('usa el axios que importa, no un global', async () => {
        delete globalThis.axios

        const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

        await expect(uploader.startUpload(fileOf(1024 * 1024))).resolves.toBeDefined()
    })

    it('parte el archivo segun chunkSize', async () => {
        const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

        await uploader.startUpload(fileOf(3 * 1024 * 1024))

        expect(axios.put).toHaveBeenCalledTimes(3)
    })

    it('un archivo mas pequeno que el chunk es una sola parte', async () => {
        const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 5 })

        await uploader.startUpload(fileOf(1024))

        expect(axios.put).toHaveBeenCalledTimes(1)
    })

    it('avisa del progreso hasta el 100', async () => {
        const progress = []
        const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

        uploader.on('progress', (percent) => progress.push(percent))

        await uploader.startUpload(fileOf(4 * 1024 * 1024))

        expect(progress).toEqual([25, 50, 75, 100])
    })

    it('cierra la subida con las partes ordenadas', async () => {
        const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

        await uploader.startUpload(fileOf(3 * 1024 * 1024))

        const complete = axios.post.mock.calls.find(([url]) => url === ROUTES.completeUploadRoute)

        expect(complete[1].parts.map((p) => p.PartNumber)).toEqual([1, 2, 3])
        expect(complete[1].upload_id).toBe('up-1')
    })

    it('avisa al completar', async () => {
        const complete = vi.fn()
        const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

        uploader.on('complete', complete)

        await uploader.startUpload(fileOf(1024))

        expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: true }))
    })

    describe('tipos de archivo', () => {
        it('acepta cualquiera por defecto', () => {
            expect(new MultipartUploader('id', ROUTES).validateFileType(fileOf(1))).toBe(true)
        })

        it('rechaza lo que no esta en la lista', () => {
            const uploader = new MultipartUploader('id', { ...ROUTES, allowedFileTypes: ['image/png'] })

            expect(() => uploader.validateFileType(fileOf(1, 'video/mp4'))).toThrow(/no está permitido/)
        })

        it('un archivo sin tipo se rechaza', () => {
            expect(() => new MultipartUploader('id', ROUTES).validateFileType(null)).toThrow()
        })
    })

    describe('reintentos', () => {
        it('reintenta una parte que falla', async () => {
            server({ failPart: 2, failTimes: 1 })

            const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1, retryInterval: 0 })

            await uploader.startUpload(fileOf(3 * 1024 * 1024))

            expect(axios.put).toHaveBeenCalledTimes(4)
        })

        /**
         * Reintentar una parte que ya se habia subido dejaba dos entradas con
         * el mismo PartNumber, y S3 rechaza la lista al cerrar.
         */
        it('no duplica la parte al reintentarla', async () => {
            server({ failPart: 2, failTimes: 1 })

            const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1, retryInterval: 0 })

            await uploader.startUpload(fileOf(3 * 1024 * 1024))

            expect(uploader.parts).toHaveLength(3)
            expect(new Set(uploader.parts.map((p) => p.PartNumber)).size).toBe(3)
        })

        it('se rinde tras maxRetries y avisa', async () => {
            server({ failPart: 1, failTimes: 99 })

            const onError = vi.fn()
            const uploader = new MultipartUploader('id', {
                ...ROUTES,
                chunkSize: 1,
                maxRetries: 2,
                retryInterval: 0,
            })

            uploader.on('error', onError)

            await expect(uploader.startUpload(fileOf(1024 * 1024))).rejects.toThrow(/after 2 retries/)
            expect(onError).toHaveBeenCalled()
        })
    })

    describe('pausa y reanudacion', () => {
        it('para donde estaba y sigue desde ahi', async () => {
            const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

            uploader.on('progress', () => {
                if (uploader.currentPartNumber === 3) {
                    uploader.pauseUpload()
                }
            })

            await uploader.startUpload(fileOf(4 * 1024 * 1024))

            expect(axios.put).toHaveBeenCalledTimes(2)
            expect(uploader.currentPartNumber).toBe(3)

            await uploader.resumeUpload()

            expect(axios.put).toHaveBeenCalledTimes(4)
        })

        it('al pausar no se cierra la subida', async () => {
            const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

            uploader.on('progress', () => uploader.pauseUpload())

            await uploader.startUpload(fileOf(4 * 1024 * 1024))

            expect(axios.post.mock.calls.some(([url]) => url === ROUTES.completeUploadRoute)).toBe(false)
        })

        /**
         * Se lanzaba sin devolver la promesa, asi que un fallo al reanudar
         * acababa en un rechazo no capturado.
         */
        it('resumeUpload devuelve su promesa', async () => {
            const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

            uploader.on('progress', () => uploader.pauseUpload())

            await uploader.startUpload(fileOf(2 * 1024 * 1024))

            expect(uploader.resumeUpload()).toBeInstanceOf(Promise)
        })

        it('reanudar sin haber empezado lanza', () => {
            expect(() => new MultipartUploader('id', ROUTES).resumeUpload()).toThrow(/reanudar/)
        })
    })

    describe('eventos', () => {
        it('se pueden quitar', async () => {
            const handler = vi.fn()
            const uploader = new MultipartUploader('id', { ...ROUTES, chunkSize: 1 })

            uploader.on('progress', handler).off('progress', handler)

            await uploader.startUpload(fileOf(1024))

            expect(handler).not.toHaveBeenCalled()
        })

        it('un evento desconocido no revienta', () => {
            expect(() => new MultipartUploader('id', ROUTES).emit('inventado', {})).not.toThrow()
        })
    })
})
