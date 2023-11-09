# Innoboxrr Multipart Uploader

Un módulo de JavaScript para subir archivos en múltiples partes, permitiendo la reanudación de las cargas y la gestión eficiente de archivos grandes.

## Instalación

Puedes instalar `innoboxrr-multipart-uploader` utilizando npm:

```bash
npm install innoboxrr-multipart-uploader
```

## Uso

Primero, importa el módulo en tu proyecto:

```javascript
const MultipartUploader = require('innoboxrr-multipart-uploader');
```

Para utilizar el cargador, crea una nueva instancia del `MultipartUploader` y comienza la carga del archivo:

```javascript
const uploader = new MultipartUploader('video-identifier');

// Asegúrate de tener un archivo tipo File (como de un input de tipo file en el navegador)
const file = /* tu archivo aquí */;

uploader.startUpload(file)
  .then(() => {
    console.log('¡La carga se ha completado con éxito!');
  })
  .catch(error => {
    console.error('Hubo un error durante la carga:', error);
  });
```

### Métodos

- `startUpload(file)`: Inicia la carga del archivo.
- `pauseUpload()`: Pausa la carga actual.
- `resumeUpload()`: Reanuda una carga pausada.
- `completeUpload()`: Finaliza la carga una vez que todas las partes han sido subidas.

## Ejemplos

En construcción...

## Contribuciones

Las contribuciones son bienvenidas. Por favor, envía un pull request o crea un issue si tienes ideas sobre cómo mejorar este paquete.

## Licencia

Este proyecto está bajo la licencia ISC. Consulta el archivo `LICENSE` en este repositorio para obtener más detalles.
