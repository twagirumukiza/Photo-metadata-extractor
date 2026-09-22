/**
 * Extracteur de Métadonnées Photo
 * 100 % client-side – exifr + jsPDF + Leaflet
 */

(function () {
  'use strict';

  // DOM
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const previewSection = document.getElementById('previewSection');
  const previewImage = document.getElementById('previewImage');
  const fileInfo = document.getElementById('fileInfo');
  const metadataContainer = document.getElementById('metadataContainer');
  const mapWrapper = document.getElementById('mapWrapper');
  const gpsCoords = document.getElementById('gpsCoords');
  const btnDownloadPdf = document.getElementById('btnDownloadPdf');
  const btnReset = document.getElementById('btnReset');

  let currentFile = null;
  let currentMeta = null;
  let mapInstance = null;
  let markerInstance = null;

  // ---------- Helpers ----------
  function formatValue(val) {
    if (val === undefined || val === null || val === '') return '—';
    if (typeof val === 'object') {
      if (Array.isArray(val)) return val.join(', ');
      if (val instanceof Date) return val.toLocaleString('fr-FR');
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    if (typeof val === 'number') {
      // Arrondi intelligent
      if (Number.isInteger(val)) return val.toString();
      return Math.abs(val) < 0.001 ? val.toExponential(3) : Number(val.toFixed(6)).toString();
    }
    return String(val);
  }

  function formatCoord(deg, isLat) {
    if (deg === undefined || deg === null) return null;
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = ((mFloat - m) * 60).toFixed(2);
    const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
    return `${d}° ${m}' ${s}" ${dir} (${deg.toFixed(6)}°)`;
  }

  // Noms lisibles pour les tags numériques EXIF/TIFF (évite d’afficher juste "256", "271"…)
  const TAG_ID_NAMES = {
    256: 'Largeur de l’image (pixels)',
    257: 'Hauteur de l’image (pixels)',
    258: 'Bits par échantillon',
    259: 'Compression',
    262: 'Interprétation photométrique',
    270: 'Description de l’image',
    271: 'Marque de l’appareil',
    272: 'Modèle de l’appareil',
    273: 'Offsets des bandes',
    274: 'Orientation',
    277: 'Échantillons par pixel',
    278: 'Lignes par bande',
    279: 'Octets par bande',
    282: 'Résolution horizontale',
    283: 'Résolution verticale',
    296: 'Unité de résolution',
    301: 'Courbe de transfert',
    305: 'Logiciel',
    306: 'Date/heure de modification',
    315: 'Artiste',
    33432: 'Copyright',
    33434: 'Temps d’exposition',
    33437: 'Ouverture (f-number)',
    34850: 'Programme d’exposition',
    34855: 'ISO',
    36864: 'Version EXIF',
    36867: 'Date de prise de vue originale',
    36868: 'Date de numérisation',
    37377: 'Vitesse d’obturation (APEX)',
    37378: 'Ouverture (APEX)',
    37379: 'Valeur de luminosité',
    37380: 'Compensation d’exposition',
    37381: 'Ouverture maximale',
    37383: 'Mode de mesure',
    37384: 'Source lumineuse',
    37385: 'Flash',
    37386: 'Focale (mm)',
    37500: 'MakerNote (données constructeur)',
    37510: 'Commentaire utilisateur',
    40960: 'Version FlashPix',
    40961: 'Espace colorimétrique',
    40962: 'Largeur pixel (EXIF)',
    40963: 'Hauteur pixel (EXIF)',
    41728: 'Type de fichier',
    41985: 'Rendu personnalisé',
    41986: 'Mode d’exposition',
    41987: 'Balance des blancs',
    41988: 'Zoom numérique',
    41989: 'Focale équivalente 35 mm',
    41990: 'Type de scène',
    41991: 'Gain de contrôle',
    41992: 'Contraste',
    41993: 'Saturation',
    41994: 'Netteté',
    42036: 'Modèle d’objectif',
    42037: 'Numéro de série objectif'
  };

  function humanTagName(key) {
    if (typeof key === 'number' || /^\d+$/.test(String(key))) {
      const id = Number(key);
      return TAG_ID_NAMES[id] || `Tag EXIF n° ${id}`;
    }
    return key;
  }

  // Groupes de métadonnées (ordre + libellés français)
  const GROUPS = [
    {
      id: 'camera',
      title: '📷 Appareil & Objectif',
      keys: [
        ['Make', 'Marque'],
        ['Model', 'Modèle'],
        ['LensModel', 'Objectif'],
        ['LensMake', 'Marque objectif'],
        ['Software', 'Logiciel'],
        ['Firmware', 'Firmware'],
        ['SerialNumber', 'N° de série appareil'],
        ['LensSerialNumber', 'N° de série objectif'],
        ['BodySerialNumber', 'N° de série boîtier']
      ]
    },
    {
      id: 'exposure',
      title: '⚙️ Réglages d’exposition',
      keys: [
        ['FNumber', 'Ouverture (f/)'],
        ['ExposureTime', 'Vitesse d’obturation'],
        ['ISO', 'ISO'],
        ['ISOSpeedRatings', 'ISO (SpeedRatings)'],
        ['FocalLength', 'Focale'],
        ['FocalLengthIn35mmFormat', 'Focale équiv. 35 mm'],
        ['ExposureProgram', 'Programme d’exposition'],
        ['MeteringMode', 'Mode de mesure'],
        ['Flash', 'Flash'],
        ['WhiteBalance', 'Balance des blancs'],
        ['ExposureBiasValue', 'Compensation d’exposition'],
        ['MaxApertureValue', 'Ouverture max'],
        ['ShutterSpeedValue', 'Vitesse (valeur)'],
        ['ApertureValue', 'Ouverture (valeur)'],
        ['BrightnessValue', 'Luminosité'],
        ['SubjectDistance', 'Distance sujet'],
        ['DigitalZoomRatio', 'Zoom numérique']
      ]
    },
    {
      id: 'datetime',
      title: '📅 Date & Heure',
      keys: [
        ['DateTimeOriginal', 'Date de prise de vue'],
        ['CreateDate', 'Date de création'],
        ['ModifyDate', 'Date de modification'],
        ['DateTime', 'Date/heure fichier'],
        ['OffsetTimeOriginal', 'Fuseau horaire (prise de vue)'],
        ['OffsetTime', 'Fuseau horaire'],
        ['SubSecTimeOriginal', 'Sous-secondes']
      ]
    },
    {
      id: 'gps',
      title: '📍 Géolocalisation',
      keys: [
        ['latitude', 'Latitude'],
        ['longitude', 'Longitude'],
        ['GPSAltitude', 'Altitude'],
        ['GPSAltitudeRef', 'Réf. altitude'],
        ['GPSImgDirection', 'Direction de la photo'],
        ['GPSImgDirectionRef', 'Réf. direction'],
        ['GPSSpeed', 'Vitesse'],
        ['GPSSpeedRef', 'Unité vitesse'],
        ['GPSDateStamp', 'Date GPS'],
        ['GPSTimeStamp', 'Heure GPS'],
        ['GPSProcessingMethod', 'Méthode GPS'],
        ['GPSMapDatum', 'Datum cartographique']
      ]
    },
    {
      id: 'image',
      title: '🖼️ Informations image',
      keys: [
        ['ImageWidth', 'Largeur'],
        ['ImageHeight', 'Hauteur'],
        ['ExifImageWidth', 'Largeur EXIF'],
        ['ExifImageHeight', 'Hauteur EXIF'],
        ['Orientation', 'Orientation'],
        ['XResolution', 'Résolution X'],
        ['YResolution', 'Résolution Y'],
        ['ResolutionUnit', 'Unité résolution'],
        ['ColorSpace', 'Espace colorimétrique'],
        ['BitsPerSample', 'Bits par échantillon'],
        ['Compression', 'Compression'],
        ['PhotometricInterpretation', 'Interprétation photométrique']
      ]
    },
    {
      id: 'other',
      title: 'ℹ️ Autres métadonnées',
      keys: [
        ['Artist', 'Artiste / Auteur'],
        ['Copyright', 'Copyright'],
        ['ImageDescription', 'Description'],
        ['UserComment', 'Commentaire utilisateur'],
        ['XPComment', 'Commentaire XP'],
        ['XPTitle', 'Titre XP'],
        ['XPAuthor', 'Auteur XP'],
        ['XPKeywords', 'Mots-clés XP'],
        ['Rating', 'Note'],
        ['SceneCaptureType', 'Type de scène'],
        ['LightSource', 'Source lumineuse'],
        ['Contrast', 'Contraste'],
        ['Saturation', 'Saturation'],
        ['Sharpness', 'Netteté'],
        ['DigitalZoomRatio', 'Zoom numérique'],
        ['SceneType', 'Type de scène (EXIF)'],
        ['CustomRendered', 'Rendu personnalisé']
      ]
    }
  ];

  // ---------- Extraction ----------
  async function extractMetadata(file) {
    const options = {
      // On récupère le maximum
      tiff: true,
      xmp: true,
      icc: false,
      jfif: true,
      ihdr: true,
      iptc: true,
      // GPS
      gps: true,
      // Merge tout
      mergeOutput: true,
      // Plus de détails
      reviveValues: true,
      sanitize: false,
      translateKeys: false,
      translateValues: false
    };

    try {
      const output = await exifr.parse(file, options);
      return output || {};
    } catch (err) {
      console.error('Erreur exifr:', err);
      return {};
    }
  }

  // Reverse geocoding (OpenStreetMap Nominatim – gratuit, usage raisonnable)
  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1&accept-language=fr`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    } catch (e) {
      console.warn('Géocodage inverse impossible:', e);
      return null;
    }
  }

  // ---------- Affichage ----------
  async function renderMetadata(meta, file) {
    currentMeta = meta;
    metadataContainer.innerHTML = '';

    // GPS spéciaux
    const lat = meta.latitude ?? meta.GPSLatitude;
    const lon = meta.longitude ?? meta.GPSLongitude;

    if (lat != null && lon != null) {
      mapWrapper.classList.remove('hidden');
      gpsCoords.innerHTML = `
        <strong>Coordonnées :</strong><br>
        Latitude : ${formatCoord(lat, true)}<br>
        Longitude : ${formatCoord(lon, false)}
        <div id="geoExplanation" style="margin-top:0.75rem; padding:0.75rem; background:#eff6ff; border-radius:8px; font-size:0.9rem; color:#1e40af;">
          Recherche de la situation géographique…
        </div>
      `;
      initMap(lat, lon);

      // Explication textuelle de la situation géographique
      reverseGeocode(lat, lon).then(geo => {
        const el = document.getElementById('geoExplanation');
        if (!el) return;
        if (geo && geo.display_name) {
          const addr = geo.address || {};
          const parts = [];
          if (addr.road || addr.pedestrian) parts.push(addr.road || addr.pedestrian);
          if (addr.suburb || addr.neighbourhood || addr.quarter) parts.push(addr.suburb || addr.neighbourhood || addr.quarter);
          if (addr.city || addr.town || addr.village || addr.municipality) parts.push(addr.city || addr.town || addr.village || addr.municipality);
          if (addr.state || addr.region) parts.push(addr.state || addr.region);
          if (addr.country) parts.push(addr.country);

          const shortPlace = parts.filter(Boolean).join(', ') || geo.display_name;
          el.innerHTML = `
            <strong>📍 Situation géographique :</strong><br>
            Cette photo a très probablement été prise à proximité de :<br>
            <em>${escapeHtml(shortPlace)}</em><br>
            <span style="font-size:0.85em; opacity:0.85;">(${escapeHtml(geo.display_name)})</span>
          `;
        } else {
          el.innerHTML = `
            <strong>📍 Situation géographique :</strong><br>
            Coordonnées GPS détectées (${lat.toFixed(5)}, ${lon.toFixed(5)}).<br>
            Impossible de déterminer le lieu exact pour le moment.
          `;
        }
      });
    } else {
      mapWrapper.classList.add('hidden');
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
      }
    }

    let hasAny = false;

    GROUPS.forEach(group => {
      const rows = [];

      group.keys.forEach(([key, label]) => {
        let value = meta[key];

        // Cas spéciaux
        if (key === 'latitude' && lat != null) value = formatCoord(lat, true);
        if (key === 'longitude' && lon != null) value = formatCoord(lon, false);
        if (key === 'FNumber' && value != null) value = `f/${value}`;
        if (key === 'ExposureTime' && value != null) {
          if (value < 1) value = `1/${Math.round(1 / value)} s`;
          else value = `${value} s`;
        }
        if (key === 'FocalLength' && value != null) value = `${value} mm`;
        if (key === 'FocalLengthIn35mmFormat' && value != null) value = `${value} mm`;
        if (key === 'GPSAltitude' && value != null) value = `${value} m`;

        if (value !== undefined && value !== null && value !== '') {
          rows.push({ label, value: formatValue(value) });
        }
      });

      // Ajouter les clés non listées avec noms lisibles
      if (group.id === 'other') {
        const knownKeys = new Set(GROUPS.flatMap(g => g.keys.map(k => k[0])));
        Object.keys(meta).forEach(k => {
          if (!knownKeys.has(k) && !['thumbnail', 'Thumbnail', 'MakerNote'].includes(k)) {
            const v = meta[k];
            if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') {
              rows.push({ label: humanTagName(k), value: formatValue(v) });
            }
          }
        });
      }

      if (rows.length === 0) return;
      hasAny = true;

      const card = document.createElement('div');
      card.className = 'meta-card';
      card.innerHTML = `
        <h3>${group.title}</h3>
        <table class="meta-table">
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${r.label}</td>
                <td>${escapeHtml(r.value)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      metadataContainer.appendChild(card);
    });

    if (!hasAny) {
      metadataContainer.innerHTML = `
        <div class="meta-card empty-state">
          <p>Aucune métadonnée EXIF trouvée dans ce fichier.<br>
          (Les applications de messagerie et réseaux sociaux suppriment souvent les métadonnées.)</p>
        </div>
      `;
    }

    btnDownloadPdf.disabled = false;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function initMap(lat, lon) {
    if (mapInstance) {
      mapInstance.remove();
    }
    mapInstance = L.map('map').setView([lat, lon], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(mapInstance);
    markerInstance = L.marker([lat, lon]).addTo(mapInstance)
      .bindPopup(`📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}`)
      .openPopup();
  }

  // ---------- PDF ----------
  // jsPDF (Helvetica) ne gère pas bien les accents → on normalise le texte
  function pdfSafe(str) {
    if (str == null) return '';
    return String(str)
      .replace(/[àáâãäå]/gi, 'a')
      .replace(/[èéêë]/gi, 'e')
      .replace(/[ìíîï]/gi, 'i')
      .replace(/[òóôõö]/gi, 'o')
      .replace(/[ùúûü]/gi, 'u')
      .replace(/[ýÿ]/gi, 'y')
      .replace(/[ç]/gi, 'c')
      .replace(/[ñ]/gi, 'n')
      .replace(/[°]/g, ' deg')
      .replace(/[–—]/g, '-')
      .replace(/[“”«»]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[…]/g, '...')
      .replace(/[^\x20-\x7E\n\r\t]/g, ''); // garde seulement ASCII imprimable
  }

  function generatePdf() {
    if (!currentMeta || !currentFile) {
      alert('Aucune métadonnée à exporter. Chargez d\'abord une photo.');
      return;
    }

    try {
      if (typeof window.jspdf === 'undefined') {
        throw new Error('Bibliothèque PDF non chargée. Rechargez la page.');
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;
      let y = 18;

      // En-tête
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(pdfSafe('Rapport de Metadonnees Photo'), pageWidth / 2, y, { align: 'center' });
      y += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text(pdfSafe(`Genere le ${new Date().toLocaleString('fr-FR')}`), pageWidth / 2, y, { align: 'center' });
      y += 6;
      doc.text(pdfSafe(`Fichier : ${currentFile.name}`), pageWidth / 2, y, { align: 'center' });
      y += 5;
      doc.text(pdfSafe(`Taille : ${(currentFile.size / 1024).toFixed(1)} Ko`), pageWidth / 2, y, { align: 'center' });
      y += 10;
      doc.setTextColor(0);

      // Ligne
      doc.setDrawColor(37, 99, 235);
      doc.setLineWidth(0.6);
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;

      // Groupes
      GROUPS.forEach(group => {
        const rows = [];
        const lat = currentMeta.latitude ?? currentMeta.GPSLatitude;
        const lon = currentMeta.longitude ?? currentMeta.GPSLongitude;

        group.keys.forEach(([key, label]) => {
          let value = currentMeta[key];
          if (key === 'latitude' && lat != null) value = formatCoord(lat, true);
          if (key === 'longitude' && lon != null) value = formatCoord(lon, false);
          if (key === 'FNumber' && value != null) value = `f/${value}`;
          if (key === 'ExposureTime' && value != null) {
            value = value < 1 ? `1/${Math.round(1 / value)} s` : `${value} s`;
          }
          if ((key === 'FocalLength' || key === 'FocalLengthIn35mmFormat') && value != null) value = `${value} mm`;
          if (key === 'GPSAltitude' && value != null) value = `${value} m`;

          if (value !== undefined && value !== null && value !== '') {
            rows.push([pdfSafe(label), pdfSafe(formatValue(value))]);
          }
        });

        if (group.id === 'other') {
          const knownKeys = new Set(GROUPS.flatMap(g => g.keys.map(k => k[0])));
          Object.keys(currentMeta).forEach(k => {
            if (!knownKeys.has(k) && !['thumbnail', 'Thumbnail', 'MakerNote'].includes(k)) {
              const v = currentMeta[k];
              if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') {
                rows.push([pdfSafe(humanTagName(k)), pdfSafe(formatValue(v))]);
              }
            }
          });
        }

        if (rows.length === 0) return;

        // Titre de section
        if (y > 250) {
          doc.addPage();
          y = 18;
        }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(37, 99, 235);
        const sectionTitle = pdfSafe(group.title.replace(/📷|⚙️|📅|📍|🖼️|ℹ️/g, '').trim());
        doc.text(sectionTitle, margin, y);
        y += 6;
        doc.setTextColor(0);

        if (typeof doc.autoTable !== 'function') {
          // Fallback sans autoTable
          rows.forEach(([lab, val]) => {
            if (y > 270) { doc.addPage(); y = 18; }
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.text(lab + ' :', margin, y);
            doc.setFont('helvetica', 'normal');
            const split = doc.splitTextToSize(val, pageWidth - margin * 2 - 55);
            doc.text(split, margin + 55, y);
            y += Math.max(6, split.length * 5);
          });
          y += 6;
          return;
        }

        doc.autoTable({
          startY: y,
          head: [['Champ', 'Valeur']],
          body: rows,
          margin: { left: margin, right: margin },
          styles: { fontSize: 9, cellPadding: 2.5, font: 'helvetica' },
          headStyles: { fillColor: [37, 99, 235], textColor: 255 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: {
            0: { cellWidth: 60, fontStyle: 'bold' },
            1: { cellWidth: 'auto' }
          }
        });

        y = doc.lastAutoTable.finalY + 10;
      });

      // Pied de page
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(
          pdfSafe(`Page ${i} / ${pageCount}  -  Extracteur de Metadonnees Photo (100 % local)`),
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 12,
          { align: 'center' }
        );
        doc.text(
          'By Twagirumukiza  -  linkedin.com/in/innocent-twagirumukiza',
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 7,
          { align: 'center' }
        );
      }

      // Téléchargement (méthode plus fiable que doc.save())
      const safeName = (currentFile.name || 'photo').replace(/\.[^/.]+$/, '').replace(/[^\w\-]+/g, '_').substring(0, 40) || 'photo';
      const fileName = `rapport-metadonnees-${safeName}.pdf`;

      // Méthode 1 : blob + lien (meilleure compatibilité)
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);

      // Feedback visuel
      const originalText = btnDownloadPdf.innerHTML;
      btnDownloadPdf.innerHTML = '✅ PDF téléchargé !';
      btnDownloadPdf.disabled = true;
      setTimeout(() => {
        btnDownloadPdf.innerHTML = originalText;
        btnDownloadPdf.disabled = false;
      }, 2500);

    } catch (err) {
      console.error('Erreur generation PDF:', err);
      alert('Erreur lors de la generation du PDF :\n\n' + (err.message || err) + '\n\nOuvrez la console (F12 → Console) et copiez le message d\'erreur.');
    }
  }

  // ---------- Gestion fichier ----------
  async function handleFile(file) {
    if (!file || (!file.type.startsWith('image/') && !/\.(heic|heif|tiff?|dng|cr2|nef|arw|raf|orf|rw2)$/i.test(file.name))) {
      alert('Veuillez sélectionner un fichier image valide (JPEG, PNG, HEIC, TIFF, RAW…).');
      return;
    }

    currentFile = file;
    currentMeta = null;

    // Aperçu
    const url = URL.createObjectURL(file);
    previewImage.src = url;
    fileInfo.textContent = `${file.name}  •  ${(file.size / 1024).toFixed(1)} Ko  •  ${file.type || 'image'}`;

    // Afficher section
    dropZone.classList.add('hidden');
    previewSection.classList.remove('hidden');
    btnDownloadPdf.disabled = true;
    btnDownloadPdf.innerHTML = '📄 Télécharger le rapport PDF';
    metadataContainer.innerHTML = '<div class="meta-card empty-state"><p>Extraction des métadonnées en cours…</p></div>';

    try {
      const meta = await extractMetadata(file);
      await renderMetadata(meta || {}, file);
    } catch (err) {
      console.error('Erreur extraction:', err);
      currentMeta = {};
      metadataContainer.innerHTML = `
        <div class="meta-card empty-state">
          <p>Impossible d’extraire les métadonnées de ce fichier.<br>
          Vous pouvez quand même générer un rapport minimal.</p>
        </div>`;
      btnDownloadPdf.disabled = false;
    }
  }

  function reset() {
    currentFile = null;
    currentMeta = null;
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
    previewImage.src = '';
    fileInput.value = '';
    dropZone.classList.remove('hidden');
    previewSection.classList.add('hidden');
    mapWrapper.classList.add('hidden');
    metadataContainer.innerHTML = '';
    btnDownloadPdf.disabled = true;
  }

  // ---------- Events ----------
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  btnDownloadPdf.addEventListener('click', function (e) {
    e.preventDefault();
    console.log('Clic sur Télécharger PDF – currentFile:', !!currentFile, 'currentMeta:', !!currentMeta);
    generatePdf();
  });
  btnReset.addEventListener('click', reset);

  console.log('Extracteur de Métadonnées Photo chargé – By Twagirumukiza');
})();
