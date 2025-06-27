# 📤 MultipartUploader

`MultipartUploader` es una clase JavaScript que permite subir archivos de gran tamaño en múltiples partes (multipart upload) utilizando rutas firmadas, ideal para integraciones con servicios como Amazon S3.

Compatible con AMD, CommonJS y uso directo en el navegador.

---

## 🚀 Instalación

Puedes incluirla directamente en tu proyecto como script:

```html
<script src="MultipartUploader.js"></script>
```

O si usas módulos:

```js
const MultipartUploader = require('./MultipartUploader');
```

---

## 🧱 Parámetros requeridos

Al instanciar `MultipartUploader`, debes pasar un `fileIdentifier` único y un objeto de configuración con los siguientes parámetros:

### Props

| Parámetro             | Tipo       | Requerido | Descripción                                                                |
| --------------------- | ---------- | --------- | -------------------------------------------------------------------------- |
| `fileIdentifier`      | `string`   | ✅         | Identificador único del archivo a subir.                                   |
| `token`               | `string`   | ✅         | CSRF token para proteger las peticiones POST.                              |
| `initiateUploadRoute` | `string`   | ✅         | URL para iniciar la carga y obtener el `upload_id`.                        |
| `signPartUploadRoute` | `string`   | ✅         | URL para obtener las URLs firmadas de cada parte.                          |
| `completeUploadRoute` | `string`   | ✅         | URL para completar la carga y notificar al backend.                        |
| `filename`            | `string`   | ❌         | Nombre original del archivo.                                               |
| `allowedFileTypes`    | `string[]` | ❌         | Lista de MIME types permitidos. Usa `['*']` para permitir todos (default). |
| `chunkSize`           | `number`   | ❌         | Tamaño de cada chunk en MB (default: 5 MB).                                |
| `maxRetries`          | `number`   | ❌         | Máximo número de reintentos por parte (default: 3).                        |

---

## 📦 Ejemplo de uso

```js
const uploader = new MultipartUploader('archivo-123', {
    token: document.querySelector('meta[name="csrf-token"]').getAttribute('content'),
    initiateUploadRoute: '/api/upload/initiate',
    signPartUploadRoute: '/api/upload/sign-part',
    completeUploadRoute: '/api/upload/complete',
    allowedFileTypes: ['image/png', 'application/pdf'],
    chunkSize: 10, // en MB
    maxRetries: 5,
    filename: 'ejemplo.pdf'
});

// Registrar eventos
uploader
    .on('progress', (progress) => {
        console.log(`Progreso: ${progress.toFixed(2)}%`);
    })
    .on('complete', (res) => {
        console.log('Carga completa:', res);
    })
    .on('error', (err) => {
        console.error('Error durante la carga:', err);
    });

// Iniciar carga
document.getElementById('inputArchivo').addEventListener('change', function () {
    const file = this.files[0];
    uploader.startUpload(file);
});
```

---

## ⏸️ Pausar y Reanudar

Puedes pausar y reanudar la carga en cualquier momento:

```js
uploader.pauseUpload();   // Pausa la carga
uploader.resumeUpload();  // Reanuda desde la última parte
```

---

## 📡 Eventos disponibles

| Evento     | Descripción                                   | Argumento                        |
| ---------- | --------------------------------------------- | -------------------------------- |
| `progress` | Se dispara con cada parte cargada             | Porcentaje de progreso (number)  |
| `complete` | Se dispara al completar toda la carga         | Objeto con `status` y `response` |
| `error`    | Se dispara cuando falla la carga de una parte | Mensaje de error (string)        |

---

## 🛡️ Consideraciones de seguridad

* Asegúrate de validar el `file_identifier` y `filename` en el backend.
* Las rutas deben estar protegidas y validar el token CSRF.
* El sistema debe manejar la recolección de partes (ETags) para completar el multipart upload correctamente.

---

## 📁 Backend esperado

Tu backend debe exponer 3 rutas:

1. `initiateUploadRoute`: Retorna `{ upload_id: '...' }`
2. `signPartUploadRoute`: Retorna `{ url: 'https://...' }` para cada parte.
3. `completeUploadRoute`: Recibe `{ parts: [{ PartNumber, ETag }...] }` y cierra la carga.

---

¿Quieres que también te genere la estructura de los endpoints en Laravel o Node.js?
