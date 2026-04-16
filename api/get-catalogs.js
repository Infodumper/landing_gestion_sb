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

    // Listar archivos de la carpeta, ordenados por fecha de modificación descendente
    const response = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, webContentLink, webViewLink, thumbnailLink, modifiedTime, mimeType)',
      orderBy: 'modifiedTime desc',
    });

    const files = response.data.files;
    const latestByLine = {};

    /**
     * Lógica de Agrupación Flexible:
     * Buscamos palabras clave dentro del nombre del archivo para clasificarlo.
     */
    files.forEach(file => {
      const fileName = file.name.toLowerCase();
      let category = 'otros';

      // Categorización granular para marcas de belleza
      if (fileName.includes('natura'))                 category = 'natura';
      else if (fileName.includes('avon'))              category = 'avon';
      else if (fileName.includes('mary') || fileName.includes('kay')) category = 'marykay';
      else if (fileName.includes('stanhome'))          category = 'stanhome';
      else if (fileName.includes('joya'))              category = 'joyas';
      else if (fileName.includes('belleza') || fileName.includes('perfu')) category = 'belleza';

      // Si es la primera vez que vemos esta categoría (es la más reciente por el sort de la API)
      if (!latestByLine[category]) {
        latestByLine[category] = {
          id: file.id,
          name: file.name,
          viewLink: file.webViewLink,
          downloadLink: file.webContentLink,
          thumbnail: file.thumbnailLink,
          modified: file.modifiedTime,
          mimeType: file.mimeType
        };
      }
    });

    // Cachear respuesta por 1 hora en el borde de Vercel
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({
      status: 'success',
      data: latestByLine
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
