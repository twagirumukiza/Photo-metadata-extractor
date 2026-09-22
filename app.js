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

  // ---------- Affichage ----------
  function renderMetadata(meta, file) {
    currentMeta = meta;
    metadataContainer.innerHTML = '';

    // GPS spéciaux
    const lat = meta.latitude ?? meta.GPSLatitude;
    const lon = meta.longitude ?? meta.GPSLongitude;

    if (lat != null && lon != null) {
      mapWrapper.classList.remove('hidden');
      gpsCoords.textContent = `Latitude : ${formatCoord(lat, true)}  •  Longitude : ${formatCoord(lon, false)}`;
      initMap(lat, lon);
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

      // Ajouter aussi les clés non listées qui commencent par le préfixe du groupe (pour maximiser)
      if (group.id === 'other') {
        const knownKeys = new Set(GROUPS.flatMap(g => g.keys.map(k => k[0])));
        Object.keys(meta).forEach(k => {
          if (!knownKeys.has(k) && !['thumbnail', 'Thumbnail', 'MakerNote'].includes(k)) {
            const v = meta[k];
            if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') {
              rows.push({ label: k, value: formatValue(v) });
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
  function generatePdf() {
    if (!currentMeta || !currentFile) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 18;

    // En-tête
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Rapport de Métadonnées Photo', pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.text(`Fichier : ${currentFile.name}`, pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.text(`Taille : ${(currentFile.size / 1024).toFixed(1)} Ko`, pageWidth / 2, y, { align: 'center' });
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
          rows.push([label, formatValue(value)]);
        }
      });

      if (group.id === 'other') {
        const knownKeys = new Set(GROUPS.flatMap(g => g.keys.map(k => k[0])));
        Object.keys(currentMeta).forEach(k => {
          if (!knownKeys.has(k) && !['thumbnail', 'Thumbnail', 'MakerNote'].includes(k)) {
            const v = currentMeta[k];
            if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') {
              rows.push([k, formatValue(v)]);
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
      doc.text(group.title.replace(/📷|⚙️|📅|📍|🖼️|ℹ️/g, '').trim(), margin, y);
      y += 6;
      doc.setTextColor(0);

      doc.autoTable({
        startY: y,
        head: [['Champ', 'Valeur']],
        body: rows,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 2.5 },
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
        `Page ${i} / ${pageCount}  •  Extracteur de Métadonnées Photo (100 % local)`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 12,
        { align: 'center' }
      );
      doc.text(
        'By Twagirumukiza  •  linkedin.com/in/innocent-twagirumukiza',
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 7,
        { align: 'center' }
      );
    }

    // Téléchargement
    const safeName = currentFile.name.replace(/\.[^/.]+$/, '') || 'photo';
    doc.save(`rapport-metadonnees-${safeName}.pdf`);
  }

  // ---------- Gestion fichier ----------
  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/') && !/\.(heic|heif|tiff?|dng|cr2|nef|arw|raf|orf|rw2)$/i.test(file.name)) {
      alert('Veuillez sélectionner un fichier image valide.');
      return;
    }

    currentFile = file;

    // Aperçu
    const url = URL.createObjectURL(file);
    previewImage.src = url;
    fileInfo.textContent = `${file.name}  •  ${(file.size / 1024).toFixed(1)} Ko  •  ${file.type || 'image'}`;

    // Afficher section
    dropZone.classList.add('hidden');
    previewSection.classList.remove('hidden');
    btnDownloadPdf.disabled = true;
    metadataContainer.innerHTML = '<div class="meta-card empty-state"><p>Extraction des métadonnées en cours…</p></div>';

    // Extraction
    const meta = await extractMetadata(file);
    renderMetadata(meta, file);
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

  btnDownloadPdf.addEventListener('click', generatePdf);
  btnReset.addEventListener('click', reset);
})();
