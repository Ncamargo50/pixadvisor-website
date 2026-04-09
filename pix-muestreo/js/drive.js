// Google Drive Integration for PIX Muestreo
// C3: Client ID loaded from settings at runtime, not hardcoded
const DRIVE_CONFIG = {
  CLIENT_ID: '', // Set via init(clientId) from user settings — not hardcoded
  API_KEY: '',
  SCOPES: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
  DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  FOLDER_NAME: 'PIX Muestreo'
};

class DriveSync {
  constructor() {
    this.tokenClient = null;
    this.accessToken = null;
    this.folderId = null;
    this.isInitialized = false;
  }

  // Initialize Google Identity Services
  async init(clientId) {
    if (clientId) DRIVE_CONFIG.CLIENT_ID = clientId;

    // In APK WebView: no need for GIS library, auth goes through native bridge
    if (typeof AndroidBridge !== 'undefined') {
      console.log('[Drive] APK WebView detected, using native bridge for auth');
      return;
    }

    return new Promise((resolve, reject) => {
      // Load GIS script
      if (typeof google !== 'undefined' && google.accounts) {
        this._initTokenClient();
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        this._initTokenClient();
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  _initTokenClient() {
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CONFIG.CLIENT_ID,
      scope: DRIVE_CONFIG.SCOPES,
      callback: (response) => {
        if (response.error) {
          console.error('Auth error:', response);
          return;
        }
        this.accessToken = response.access_token;
        this.isInitialized = true;
        // C4: Store token with expiry timestamp (default 1h) — use sessionStorage for security
        const expiresAt = Date.now() + ((response.expires_in || 3600) * 1000);
        this._tokenExpiresAt = expiresAt;
        try {
          sessionStorage.setItem('pix_drive_token', response.access_token);
          sessionStorage.setItem('pix_drive_token_exp', String(expiresAt));
        } catch (_) {}
        // Clean old localStorage token if present (migration)
        try { localStorage.removeItem('pix_drive_token'); } catch (_) {}
        document.dispatchEvent(new Event('drive-authenticated'));
      }
    });
  }

  // Request authentication
  async authenticate() {
    // In APK WebView: use native bridge → Chrome Custom Tabs
    if (typeof AndroidBridge !== 'undefined' && AndroidBridge.startGoogleAuth) {
      console.log('[Drive] Launching native OAuth via Chrome Custom Tabs');
      AndroidBridge.startGoogleAuth(DRIVE_CONFIG.CLIENT_ID);
      return; // Token will arrive via setTokenFromNative()
    }
    // In regular browser: use GIS popup (existing flow)
    if (!this.tokenClient) {
      throw new Error('Drive not initialized. Set Client ID in settings.');
    }
    this.tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  // Receive token from native Android bridge (APK WebView OAuth flow)
  setTokenFromNative(token, expiresIn) {
    if (!token) return;
    this.accessToken = token;
    this.isInitialized = true;
    const expiresAt = Date.now() + ((expiresIn || 3600) * 1000);
    this._tokenExpiresAt = expiresAt;
    try {
      sessionStorage.setItem('pix_drive_token', token);
      sessionStorage.setItem('pix_drive_token_exp', String(expiresAt));
    } catch (_) {}
    console.log('[Drive] Token received from native bridge, expires in', expiresIn, 's');
    document.dispatchEvent(new Event('drive-authenticated'));
  }

  // Check if authenticated — restore from sessionStorage if available
  isAuthenticated() {
    if (!this.accessToken) {
      try {
        const saved = sessionStorage.getItem('pix_drive_token');
        const exp = parseInt(sessionStorage.getItem('pix_drive_token_exp') || '0');
        if (saved && exp > Date.now()) {
          this.accessToken = saved;
          this._tokenExpiresAt = exp;
          this.isInitialized = true;
        }
      } catch (_) {}
    }
    return !!this.accessToken;
  }

  // API call helper — with proactive token expiry check
  async _fetch(url, options = {}) {
    if (!this.accessToken) throw new Error('Not authenticated');
    // A9: Proactive expiry check — re-auth before 401 happens
    if (this._tokenExpiresAt && Date.now() > this._tokenExpiresAt - 60000) {
      console.warn('Drive token expiring soon, clearing...');
      this.accessToken = null;
      try { sessionStorage.removeItem('pix_drive_token'); } catch (_) {}
      throw new Error('Token expired. Please re-authenticate.');
    }
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        ...options.headers
      }
    });
    if (resp.status === 401) {
      this.accessToken = null;
      this._tokenExpiresAt = 0;
      try { sessionStorage.removeItem('pix_drive_token'); } catch (_) {}
      throw new Error('Token expired. Please re-authenticate.');
    }
    return resp;
  }

  // Find or create PIX Muestreo folder
  async ensureFolder() {
    if (this.folderId) return this.folderId;

    // Search for existing folder
    const q = encodeURIComponent(`name='${DRIVE_CONFIG.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const resp = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    const data = await resp.json();

    if (data.files && data.files.length > 0) {
      this.folderId = data.files[0].id;
      return this.folderId;
    }

    // Create folder
    const createResp = await this._fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DRIVE_CONFIG.FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const folder = await createResp.json();
    this.folderId = folder.id;
    return this.folderId;
  }

  // Find or create a subfolder inside a parent folder (cached per session)
  async ensureSubfolder(parentId, folderName) {
    if (!this._subfolderCache) this._subfolderCache = {};
    const cacheKey = `${parentId}/${folderName}`;
    if (this._subfolderCache[cacheKey]) return this._subfolderCache[cacheKey];

    const safeName = folderName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Sin_Cliente';
    const q = encodeURIComponent(`name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const resp = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    const data = await resp.json();

    if (data.files && data.files.length > 0) {
      this._subfolderCache[cacheKey] = data.files[0].id;
      return data.files[0].id;
    }

    const createResp = await this._fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: safeName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    const folder = await createResp.json();
    this._subfolderCache[cacheKey] = folder.id;
    return folder.id;
  }

  // List files in Pixadvisor folder
  async listFiles(mimeType = null) {
    const folderId = await this.ensureFolder();
    let q = `'${folderId}' in parents and trashed=false`;
    if (mimeType) q += ` and mimeType='${mimeType}'`;
    const resp = await this._fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc`
    );
    return (await resp.json()).files || [];
  }

  // List importable files (GeoJSON, KML, KMZ, SHP, CSV)
  async listImportableFiles() {
    const folderId = await this.ensureFolder();
    const resp = await this._fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=100`
    );
    const data = await resp.json();
    const files = data.files || [];
    const importable = ['.geojson', '.json', '.kml', '.kmz', '.csv', '.shp', '.zip'];
    return files.filter(f => importable.some(ext => f.name.toLowerCase().endsWith(ext)));
  }

  // Download file content
  async downloadFile(fileId) {
    const resp = await this._fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    );
    return resp;
  }

  // Download and parse GeoJSON/KML
  async importGeoFile(fileId, fileName) {
    const resp = await this.downloadFile(fileId);
    const text = await resp.text();

    if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
      return JSON.parse(text);
    }
    if (fileName.endsWith('.kml')) {
      return this._parseKML(text);
    }
    if (fileName.endsWith('.csv')) {
      return this._parseCSV(text);
    }
    throw new Error('Formato no soportado: ' + fileName);
  }

  // A6 FIX: Enhanced KML parser — handles MultiGeometry, LineString, MultiPolygon
  _parseKML(kmlText) {
    const parser = new DOMParser();
    const kml = parser.parseFromString(kmlText, 'text/xml');
    const features = [];

    // Helper: parse coordinate string to [lng, lat] array
    const parseCoordStr = (str) => {
      return str.trim().split(/\s+/).filter(c => c.length > 0).map(c => {
        const parts = c.split(',').map(Number);
        return [parts[0], parts[1]]; // [lng, lat]
      });
    };

    // Helper: extract geometries from a geometry container element
    const extractGeometries = (container, props) => {
      // Point
      const points = container.querySelectorAll(':scope > Point');
      points.forEach(pt => {
        const coordEl = pt.querySelector('coordinates');
        if (!coordEl) return;
        const [lng, lat] = coordEl.textContent.trim().split(',').map(Number);
        if (isFinite(lng) && isFinite(lat)) {
          features.push({
            type: 'Feature', properties: { ...props },
            geometry: { type: 'Point', coordinates: [lng, lat] }
          });
        }
      });

      // Polygon
      const polygons = container.querySelectorAll(':scope > Polygon');
      polygons.forEach(poly => {
        const outerCoordEl = poly.querySelector('outerBoundaryIs LinearRing coordinates');
        if (!outerCoordEl) return;
        const outerCoords = parseCoordStr(outerCoordEl.textContent);
        if (outerCoords.length < 3) return;

        // Also parse inner boundaries (holes)
        const holes = [];
        poly.querySelectorAll('innerBoundaryIs LinearRing coordinates').forEach(inner => {
          const holeCoords = parseCoordStr(inner.textContent);
          if (holeCoords.length >= 3) holes.push(holeCoords);
        });

        const coordinates = [outerCoords, ...holes];
        features.push({
          type: 'Feature', properties: { ...props },
          geometry: { type: 'Polygon', coordinates }
        });
      });

      // LineString → convert to Polygon if ring is closed, else keep as LineString
      const lines = container.querySelectorAll(':scope > LineString');
      lines.forEach(line => {
        const coordEl = line.querySelector('coordinates');
        if (!coordEl) return;
        const coords = parseCoordStr(coordEl.textContent);
        if (coords.length < 2) return;

        // Check if it's a closed ring (first ≈ last point)
        const first = coords[0], last = coords[coords.length - 1];
        const isClosed = Math.abs(first[0] - last[0]) < 0.00001 && Math.abs(first[1] - last[1]) < 0.00001;

        if (isClosed && coords.length >= 4) {
          features.push({
            type: 'Feature', properties: { ...props },
            geometry: { type: 'Polygon', coordinates: [coords] }
          });
        } else {
          features.push({
            type: 'Feature', properties: { ...props },
            geometry: { type: 'LineString', coordinates: coords }
          });
        }
      });

      // MultiGeometry — recurse into children
      const multiGeoms = container.querySelectorAll(':scope > MultiGeometry');
      multiGeoms.forEach(mg => extractGeometries(mg, props));
    };

    // Parse all Placemarks
    const placemarks = kml.querySelectorAll('Placemark');
    placemarks.forEach(pm => {
      const name = pm.querySelector('name')?.textContent || '';
      const desc = pm.querySelector('description')?.textContent || '';
      const props = { name, description: desc };
      extractGeometries(pm, props);
    });

    return { type: 'FeatureCollection', features };
  }

  // A10 FIX: CSV parser with RFC 4180 quoted field support
  _parseCSV(csvText) {
    // Smart CSV line parser — handles "quoted, fields" correctly
    const parseCSVLine = (line, sep) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; } // escaped quote
          else if (ch === '"') { inQuotes = false; }
          else { current += ch; }
        } else {
          if (ch === '"') { inQuotes = true; }
          else if (ch === sep) { result.push(current.trim()); current = ''; }
          else { current += ch; }
        }
      }
      result.push(current.trim());
      return result;
    };

    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('CSV vacío o sin datos');

    // Detect separator: comma, semicolon, or tab
    const firstLine = lines[0];
    const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

    const headers = parseCSVLine(firstLine, sep).map(h => h.toLowerCase().replace(/^["']|["']$/g, ''));
    const latIdx = headers.findIndex(h => ['lat', 'latitude', 'latitud', 'y'].includes(h));
    const lngIdx = headers.findIndex(h => ['lng', 'lon', 'longitude', 'longitud', 'long', 'x'].includes(h));
    const nameIdx = headers.findIndex(h => ['name', 'nombre', 'nome', 'id', 'punto', 'point', 'ponto'].includes(h));

    if (latIdx === -1 || lngIdx === -1) throw new Error('CSV debe tener columnas lat/lng');

    const features = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue; // skip empty lines
      const vals = parseCSVLine(lines[i], sep);
      const lat = parseFloat(vals[latIdx]);
      const lng = parseFloat(vals[lngIdx]);
      if (isNaN(lat) || isNaN(lng)) continue;

      const props = {};
      headers.forEach((h, idx) => { props[h] = vals[idx] || ''; });
      if (nameIdx >= 0) props.name = vals[nameIdx] || `P${i}`;
      else props.name = `P${i}`;

      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'Point', coordinates: [lng, lat] }
      });
    }
    return { type: 'FeatureCollection', features };
  }

  // Upload JSON data to Drive (root PIX Muestreo folder)
  async uploadJSON(fileName, data) {
    const folderId = await this.ensureFolder();
    return this._uploadFile(fileName, JSON.stringify(data, null, 2), 'application/json', folderId);
  }

  // Upload any file to a specific folder (upsert: update if exists, create if not)
  async _uploadFile(fileName, content, mimeType, targetFolderId) {
    const blob = new Blob([content], { type: mimeType });

    // Check if file exists → update instead of duplicating
    const q = encodeURIComponent(`name='${fileName}' and '${targetFolderId}' in parents and trashed=false`);
    const existing = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
    const existingData = await existing.json();

    if (existingData.files && existingData.files.length > 0) {
      const fileId = existingData.files[0].id;
      const resp = await this._fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        { method: 'PATCH', body: blob }
      );
      return resp.json();
    }

    // Create new — multipart upload
    const metadata = { name: fileName, mimeType, parents: [targetFolderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const resp = await this._fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', body: form }
    );
    return resp.json();
  }

  // Upload JSON to a specific subfolder
  async uploadJSONToFolder(fileName, data, folderId) {
    return this._uploadFile(fileName, JSON.stringify(data, null, 2), 'application/json', folderId);
  }

  // Upload HTML report to a specific subfolder
  async uploadHTMLToFolder(fileName, html, folderId) {
    return this._uploadFile(fileName, html, 'text/html', folderId);
  }

  // Upload photo (base64)
  async uploadPhoto(fileName, base64Data) {
    const folderId = await this.ensureFolder();

    // Create photos subfolder
    let photosFolderId;
    const q = encodeURIComponent(`name='Fotos' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const existing = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
    const existingData = await existing.json();

    if (existingData.files && existingData.files.length > 0) {
      photosFolderId = existingData.files[0].id;
    } else {
      const createResp = await this._fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Fotos', mimeType: 'application/vnd.google-apps.folder', parents: [folderId] })
      });
      const folder = await createResp.json();
      photosFolderId = folder.id;
    }

    // Convert base64 to blob — C5: validate format before split
    const parts = base64Data.split(',');
    const encoded = parts.length > 1 ? parts[1] : parts[0];
    if (!encoded) throw new Error('Invalid photo data format');
    const byteStr = atob(encoded);
    const ab = new ArrayBuffer(byteStr.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
    const blob = new Blob([ab], { type: 'image/jpeg' });

    const metadata = { name: fileName, mimeType: 'image/jpeg', parents: [photosFolderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const resp = await this._fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', body: form }
    );
    return resp.json();
  }

  // A12+M15 FIX: Sync with parallel photo upload (batches of 3) + progress callback
  // ═══════════════════════════════════════════════════════════
  // SYNC ALL — Uploads samples + reports organized by client
  // Folder structure: PIX Muestreo / {Cliente} / files...
  // ═══════════════════════════════════════════════════════════

  async syncAll(onProgress = null) {
    const unsynced = await pixDB.getUnsyncedSamples();
    if (unsynced.length === 0) return { synced: 0 };

    const rootFolderId = await this.ensureFolder();

    // Group by field
    const byField = {};
    for (const s of unsynced) {
      const fId = s.fieldId || 'general';
      if (!byField[fId]) byField[fId] = [];
      byField[fId].push(s);
    }

    let totalSynced = 0;
    const totalToSync = unsynced.length;

    for (const [fieldId, samples] of Object.entries(byField)) {
      // Resolve field → project → client
      let fieldName = 'campo';
      let clientName = '';
      let projectName = '';
      const numericFieldId = fieldId !== 'general' ? parseInt(fieldId) : null;

      if (numericFieldId !== null && !isNaN(numericFieldId)) {
        const field = await pixDB.get('fields', numericFieldId);
        if (field) {
          fieldName = field.name;
          if (field.projectId) {
            const project = await pixDB.get('projects', field.projectId);
            if (project) {
              clientName = (project.client || '').trim();
              projectName = (project.name || '').trim();
            }
          }
        }
      }

      // Determine client folder name: client > project name > 'General'
      const folderLabel = clientName || projectName || 'General';
      const clientFolderId = await this.ensureSubfolder(rootFolderId, folderLabel);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `muestreo_${fieldName}_${timestamp}.json`;

      // Get track data
      const tracks = numericFieldId !== null
        ? await pixDB.getAllByIndex('tracks', 'fieldId', numericFieldId)
        : [];

      const exportData = {
        app: 'PIX Muestreo',
        version: '2.0',
        exportDate: new Date().toISOString(),
        client: clientName,
        project: projectName,
        field: fieldName,
        fieldId: fieldId,
        totalSamples: samples.length,
        samples: samples.map(s => ({
          pointName: s.pointName,
          pointType: s.pointType || 'principal',
          zona: s.zona || '',
          lat: s.lat,
          lng: s.lng,
          accuracy: s.accuracy,
          gpsMethod: s.gpsMethod,
          depth: s.depth,
          barcode: s.barcode,
          ibraSampleId: s.ibraSampleId,
          sampleType: s.sampleType,
          collector: s.collector,
          notes: s.notes,
          photo: s.photo ? '(foto adjunta)' : null,
          collectedAt: s.collectedAt
        })),
        track: tracks.length > 0 ? tracks[0].positions : []
      };

      // Upload samples JSON to client subfolder
      await this.uploadJSONToFolder(fileName, exportData, clientFolderId);

      // Generate and upload field report HTML
      try {
        const reportHTML = this._buildFieldReportHTML(exportData, clientName, projectName, dateStr);
        const reportName = `reporte_${fieldName}_${dateStr}.html`;
        await this.uploadHTMLToFolder(reportName, reportHTML, clientFolderId);
      } catch (e) {
        console.warn('[Drive] Report generation failed:', e.message);
      }

      // Upload photos in parallel batches of 3
      const PHOTO_BATCH = 3;
      const photosToUpload = samples.filter(s => s.photo).map(s => ({
        sample: s,
        photoName: `foto_${s.pointName || s.id}_${timestamp}.jpg`
      }));

      for (let i = 0; i < photosToUpload.length; i += PHOTO_BATCH) {
        const batch = photosToUpload.slice(i, i + PHOTO_BATCH);
        const results = await Promise.allSettled(
          batch.map(({ sample, photoName }) =>
            this.uploadPhoto(photoName, sample.photo).then(() => ({ id: sample.id, ok: true }))
          )
        );
        for (let j = 0; j < batch.length; j++) {
          const res = results[j];
          if (res.status === 'fulfilled') {
            await pixDB.markSynced(batch[j].sample.id);
          } else {
            console.warn('Photo upload failed for', batch[j].photoName, ':', res.reason?.message);
            await pixDB.markSynced(batch[j].sample.id, { photoFailed: true });
          }
          totalSynced++;
          if (onProgress) onProgress(totalSynced, totalToSync);
        }
      }

      // Mark samples without photos
      const noPhotoSamples = samples.filter(s => !s.photo);
      for (const s of noPhotoSamples) {
        await pixDB.markSynced(s.id);
        totalSynced++;
        if (onProgress) onProgress(totalSynced, totalToSync);
      }
    }

    return { synced: totalSynced };
  }

  // Build a field report HTML for upload to Drive
  _buildFieldReportHTML(data, clientName, projectName, dateStr) {
    const collector = data.samples[0]?.collector || '—';
    const sampleType = data.samples[0]?.sampleType || '—';

    // Group samples by zone
    const byZone = {};
    for (const s of data.samples) {
      const z = s.zona || 'Sin zona';
      if (!byZone[z]) byZone[z] = [];
      byZone[z].push(s);
    }

    let zonesHTML = '';
    for (const [zone, pts] of Object.entries(byZone)) {
      const principal = pts.find(p => p.pointType === 'principal');
      const subs = pts.filter(p => p.pointType !== 'principal');
      const barcode = principal?.ibraSampleId || principal?.barcode || '—';
      zonesHTML += `<tr>
        <td style="text-align:center;font-weight:700">${zone}</td>
        <td>${barcode}</td>
        <td style="text-align:center">${pts.length} pts</td>
        <td style="text-align:center">${principal?.depth || '0-20'}</td>
        <td>${principal?.sampleType || sampleType}</td>
      </tr>`;
    }

    let pointsHTML = '';
    for (const s of data.samples) {
      const isPrin = s.pointType === 'principal';
      const hora = s.collectedAt ? new Date(s.collectedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—';
      const acc = s.accuracy ? s.accuracy.toFixed(1) + 'm' : '—';
      pointsHTML += `<tr style="${isPrin ? 'background:#fff3e0;font-weight:600' : ''}">
        <td>${s.pointName || '—'}</td>
        <td>${s.zona || '—'}</td>
        <td>${isPrin ? 'Principal' : 'Sub'}</td>
        <td style="text-align:right;font-family:monospace">${s.lat.toFixed(6)}</td>
        <td style="text-align:right;font-family:monospace">${s.lng.toFixed(6)}</td>
        <td style="text-align:center">${acc}</td>
        <td style="text-align:center">${s.depth || '0-20'}</td>
        <td style="text-align:center">${hora}</td>
      </tr>`;
    }

    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Reporte — ${data.field} — ${dateStr}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #333; margin: 0; padding: 20px; }
  .hdr { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #4CAF50; padding-bottom:12px; margin-bottom:16px; }
  .hdr h1 { font-size:18px; margin:0; color:#2E7D32; }
  .sec-title { font-size:13px; font-weight:700; color:#fff; background:#4CAF50; padding:6px 12px; }
  .grid { display:grid; grid-template-columns:140px 1fr; border:1px solid #ddd; }
  .grid .l { background:#f5f5f5; padding:5px 10px; font-weight:600; font-size:11px; border-bottom:1px solid #ddd; border-right:1px solid #ddd; }
  .grid .v { padding:5px 10px; font-size:12px; border-bottom:1px solid #ddd; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th { background:#e8f5e9; padding:5px 8px; text-align:left; font-size:11px; border:1px solid #ddd; }
  td { padding:4px 8px; border:1px solid #ddd; font-size:12px; }
  .foot { margin-top:24px; text-align:center; font-size:10px; color:#999; border-top:1px solid #eee; padding-top:8px; }
  @media print { body { padding:0; } }
</style></head><body>

<div class="hdr">
  <div><h1>PIX Muestreo — Reporte de Campo</h1><div style="font-size:10px;color:#888">Pixadvisor Agricultura de Precision</div></div>
  <div style="text-align:right;font-size:12px;color:#666">${dateStr}</div>
</div>

<div class="sec-title">1. DATOS GENERALES</div>
<div class="grid">
  <div class="l">Cliente</div><div class="v" style="font-weight:700">${clientName || '—'}</div>
  <div class="l">Hacienda</div><div class="v" style="font-weight:700">${projectName || '—'}</div>
  <div class="l">Campo / Lote</div><div class="v">${data.field}</div>
  <div class="l">Fecha</div><div class="v">${dateStr}</div>
  <div class="l">Tecnico</div><div class="v">${collector}</div>
  <div class="l">Total muestras</div><div class="v">${data.totalSamples} puntos</div>
  <div class="l">Tipo de analisis</div><div class="v">${sampleType}</div>
</div>

<div style="margin-top:16px"><div class="sec-title">2. RESUMEN POR ZONA</div></div>
<table>
  <tr><th style="text-align:center;width:50px">Zona</th><th>QR / Codigo</th><th style="text-align:center">Puntos</th><th style="text-align:center">Prof.</th><th>Analisis</th></tr>
  ${zonesHTML}
</table>

<div style="margin-top:16px"><div class="sec-title">3. DETALLE DE PUNTOS GPS</div></div>
<table>
  <tr><th>Punto</th><th>Zona</th><th>Tipo</th><th style="text-align:right">Latitud</th><th style="text-align:right">Longitud</th><th style="text-align:center">Precision</th><th style="text-align:center">Prof.</th><th style="text-align:center">Hora</th></tr>
  ${pointsHTML}
</table>

<div class="foot">Generado por PIX Muestreo — Pixadvisor Agricultura de Precision — pixadvisor.network — ${new Date().toLocaleString('es')}</div>
</body></html>`;
  }

  // ===== USER SYNC VIA DRIVE =====

  /**
   * Upload users.json to PIX Muestreo Drive folder.
   * Contains all collaborator credentials (hashed passwords).
   * @param {Array} users - Array of user objects from IndexedDB
   */
  async uploadUsersJSON(users) {
    const folderId = await this.ensureFolder();
    const payload = {
      _type: 'pix_users_sync',
      version: 1,
      updatedAt: new Date().toISOString(),
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        passwordHash: u.passwordHash,
        role: u.role,
        active: u.active !== false,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt || new Date().toISOString()
      }))
    };

    // Check if users.json already exists — update instead of creating duplicate
    const q = encodeURIComponent(`name='users.json' and '${folderId}' in parents and trashed=false`);
    const searchResp = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
    const searchData = await searchResp.json();

    if (searchData.files && searchData.files.length > 0) {
      // Update existing file
      const fileId = searchData.files[0].id;
      await this._fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload, null, 2)
      });
    } else {
      // Create new file
      await this.uploadJSON('users.json', payload);
    }

    console.log(`[Drive] Users synced: ${users.length} users uploaded`);
    return { uploaded: users.length };
  }

  /**
   * Download users.json from PIX Muestreo Drive folder.
   * @returns {Object|null} Parsed users.json or null if not found
   */
  async downloadUsersJSON() {
    try {
      const folderId = await this.ensureFolder();
      const q = encodeURIComponent(`name='users.json' and '${folderId}' in parents and trashed=false`);
      const searchResp = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)`);
      const searchData = await searchResp.json();

      if (!searchData.files || searchData.files.length === 0) {
        console.log('[Drive] No users.json found in Drive');
        return null;
      }

      const fileId = searchData.files[0].id;
      const resp = await this._fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      const data = await resp.json();

      if (data._type !== 'pix_users_sync') {
        console.warn('[Drive] users.json has invalid format');
        return null;
      }

      console.log(`[Drive] Users downloaded: ${data.users?.length || 0} users`);
      return data;
    } catch (e) {
      console.warn('[Drive] Failed to download users:', e.message);
      return null;
    }
  }
}

const driveSync = new DriveSync();
