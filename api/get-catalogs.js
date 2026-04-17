const { google } = require('googleapis');

/**
 * Skill: catalog_manager
 * Este endpoint se encarga de consultar Google Drive, listar los archivos de una carpeta
 * y devolver el último catálogo disponible para cada línea de producto.
 */
module.exports = async (req, res) => {
  // Configuración desde variables de entorno (Vercel)
  const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!FOLDER_ID || !SERVICE_ACCOUNT) {
    return res.status(500).json({ 
      error: 'Faltan variables de entorno: GOOGLE_DRIVE_FOLDER_ID o GOOGLE_SERVICE_ACCOUNT_JSON' 
    });
  }

  try {
    const credentials = JSON.parse(SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // 1. Listar archivos de la carpeta principal
    let response = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, webContentLink, webViewLink, thumbnailLink, modifiedTime, mimeType)',
      orderBy: 'modifiedTime desc',
    });

    let files = response.data.files || [];

    // 2. Buscar si existe una subcarpeta "Imágenes" o "Imagenes" para traer assets adicionales
    const subfolderQuery = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and name contains 'Imagen' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
    });

    if (subfolderQuery.data.files && subfolderQuery.data.files.length > 0) {
      const subfolderId = subfolderQuery.data.files[0].id;
      const subResponse = await drive.files.list({
        q: `'${subfolderId}' in parents and trashed = false`,
        fields: 'files(id, name, webContentLink, webViewLink, thumbnailLink, modifiedTime, mimeType)',
        orderBy: 'modifiedTime desc',
      });
      if (subResponse.data.files) {
        files = [...files, ...subResponse.data.files];
      }
    }

    const latestByLine = {};

    /**
     * Lógica de Agrupación Flexible:
     * Buscamos palabras clave dentro del nombre del archivo para clasificarlo.
     */
    const carouselImages = [];

    files.forEach(file => {
      // Normalizamos el nombre: minúsculas y quitar acentos (ej: Avón -> avon)
      const fileName = file.name.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      
      let category = 'otros';

      // Categorización granular para marcas de belleza y joyas
      if (fileName.includes('natura'))                 category = 'natura';
      else if (fileName.includes('avon'))              category = 'avon';
      else if (fileName.includes('mary') || fileName.includes('kay')) category = 'marykay';
      else if (fileName.includes('gigot'))             category = 'gigot';
      else if (fileName.includes('joya') || fileName.includes('perla') || fileName.includes('negra') || fileName.includes('semi')) category = 'joyas';
      else if (fileName.includes('belleza') || fileName.includes('perfu')) category = 'belleza';

      const isPdf = file.mimeType === 'application/pdf';
      const isImg = file.mimeType.startsWith('image/');

      // Especial para el carrusel
      if (fileName.includes('carousel') && isImg) {
          carouselImages.push({
              name: fileName,
              url: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1600`, // Formato estable y de alta calidad
              order: parseInt(fileName.match(/\d+/) || [99])[0]
          });
          return;
      }

      // Si no existe la entrada para esta categoría, la inicializamos
      if (!latestByLine[category]) {
        latestByLine[category] = {
          modified: file.modifiedTime
        };
      }

      // Priorizamos el PDF más reciente para los enlaces de visualización/descarga
      if (isPdf && !latestByLine[category].viewLink) {
        latestByLine[category].id = file.id;
        latestByLine[category].name = file.name;
        latestByLine[category].viewLink = file.webViewLink;
        latestByLine[category].downloadLink = file.webContentLink;
        latestByLine[category].mimeType = file.mimeType;
      }

      // Para la miniatura, preferimos un archivo de imagen real si existe (ej: natura.jpg)
      // Si no hay imagen, usamos el thumbnailLink generado por Drive para el PDF
      if (isImg) {
        // Enlaces de Drive para imágenes directas
        latestByLine[category].thumbnail = `https://drive.google.com/thumbnail?id=${file.id}&sz=w1000`;
      } else if (isPdf && !latestByLine[category].thumbnail) {
        // Para PDFs usamos la miniatura de Drive pero forzamos tamaño grande
        latestByLine[category].thumbnail = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+/, '=s1000') : null;
      }
    });

    // Ordenar imágenes del carrusel por el número en el nombre
    carouselImages.sort((a, b) => a.order - b.order);

    // Cachear respuesta por 1 hora en el borde de Vercel
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({
      status: 'success',
      data: {
          catalogs: latestByLine,
          carousel: carouselImages
      }
    });

  } catch (error) {
    console.error('[DRIVE_ERROR]', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Error al conectar con Google Drive API',
      details: error.message 
    });
  }
};
