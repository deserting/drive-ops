// ==================== ÉTAT TACTIQUE ====================
const state = {
  catalogue: null,
  plans: new Map(),
  datasets: new Map(), // Cache des CSV parsés
  currentZoneId: null,
  currentDataset: null,
  zoomLevel: 1,
  filters: {
    type: 'mono', // 'mono' ou 'multi'
    dateFrom: null,
    dateTo: null
  }
};

// ==================== DOM ELEMENTS ====================
const els = {
  zoneSelect: document.getElementById('zone-select'),
  typeFilters: document.getElementById('type-filters'),
  dateFrom: document.getElementById('date-from'),
  dateTo: document.getElementById('date-to'),
  planWrapper: document.getElementById('plan-wrapper'),
  planTable: document.getElementById('plan-table'),
  zoomVal: document.getElementById('zoom-val'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  statPoints: document.getElementById('total-points'),
  statMax: document.getElementById('max-intensity'),
  loader: document.getElementById('loader'),
  tooltip: document.getElementById('tooltip')
};

// ==================== INIT ====================
async function init() {
  try {
    // 1. Charger le catalogue
    const resp = await fetch('catalogue.json');
    state.catalogue = await resp.json();

    // 2. Remplir les filtres initiaux
    initControls();

    // 3. Charger la première zone par défaut
    if (state.catalogue.zones.length > 0) {
      const defaultZone = state.catalogue.zones[0];
      await loadZone(defaultZone.id);
    }

    els.loader.classList.add('hidden');
  } catch (err) {
    console.error("Init error:", err);
    els.loader.innerHTML = `<span style="color:red">ERREUR SYSTÈME: ${err.message}</span>`;
  }
}

function initControls() {
  // Zones
  els.zoneSelect.innerHTML = state.catalogue.zones
    .map(z => `<option value="${z.id}">${z.label}</option>`)
    .join('');
  
  els.zoneSelect.addEventListener('change', (e) => loadZone(e.target.value));

  // Types (Mono/Multi) - Boutons Toggle
  const types = ['mono', 'multi'];
  els.typeFilters.innerHTML = types.map(t => 
    `<button class="toggle-btn ${t === state.filters.type ? 'active' : ''}" data-type="${t}">
      ${t.toUpperCase()}
    </button>`
  ).join('');

  els.typeFilters.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Update UI
      els.typeFilters.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Update State
      state.filters.type = btn.dataset.type;
      updateVisualization();
    });
  });

  // Dates - Définir les bornes du catalogue
  // (Simplification: on prend min et max de tous les datasets pour l'instant)
  // Pour l'instant, on set juste des écouteurs
  els.dateFrom.addEventListener('change', updateVisualization);
  els.dateTo.addEventListener('change', updateVisualization);

  // Zoom
  els.zoomIn.addEventListener('click', () => setZoom(state.zoomLevel + 0.1));
  els.zoomOut.addEventListener('click', () => setZoom(state.zoomLevel - 0.1));
}

// ==================== CHARGEMENT ZONE ====================
async function loadZone(zoneId) {
  state.currentZoneId = zoneId;
  
  // Charger le plan JSON si pas en cache
  if (!state.plans.has(zoneId)) {
    const zoneConfig = state.catalogue.zones.find(z => z.id === zoneId);
    const res = await fetch(zoneConfig.plan);
    const planData = await res.json();
    state.plans.set(zoneId, planData);
  }

  renderGrid(state.plans.get(zoneId));
  updateVisualization();
}

// ==================== RENDU GRILLE (PATCHÉ) ====================
function renderGrid(planData) {
  els.planTable.innerHTML = '';
  
  // 1. Trouver les dimensions de la grille
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  // planData est un objet { "MEUBLE_ID": {row: 0, col: 0}, ... }
  const meubles = Object.entries(planData);
  
  meubles.forEach(([id, pos]) => {
    if (pos.col < minX) minX = pos.col;
    if (pos.col > maxX) maxX = pos.col;
    if (pos.row < minY) minY = pos.row;
    if (pos.row > maxY) maxY = pos.row;
  });

  // 2. Construire la grille HTML
  // On itère rangée par rangée
  for (let y = minY; y <= maxY; y++) {
    const tr = document.createElement('tr');
    
    for (let x = minX; x <= maxX; x++) {
      const td = document.createElement('td');
      
      // Trouver s'il y a un meuble à cette position
      // (Pas très optimisé O(N) dans la boucle, mais OK pour < 5000 meubles)
      const meuble = meubles.find(([id, pos]) => pos.row === y && pos.col === x);
      
      if (meuble) {
        const [id, pos] = meuble;
        td.dataset.id = id; // "MA01"
        td.classList.add('meuble-cell');
        // Tooltip events
        td.addEventListener('mouseenter', (e) => showTooltip(e, id));
        td.addEventListener('mouseleave', hideTooltip);
      } else {
        td.classList.add('empty-cell'); // Classe CSS pour transparence
      }
      
      tr.appendChild(td);
    }
    els.planTable.appendChild(tr);
  }
}

// ==================== DATA VIZ ====================
async function updateVisualization() {
  // 1. Récupérer les datasets correspondants aux filtres
  const relevantSets = state.catalogue.datasets.filter(ds => 
    ds.zone === state.currentZoneId &&
    ds.type === state.filters.type
  );

  // 2. Fusionner les données (si plusieurs dates sélectionnées)
  // Simplification: On charge tout et on somme
  const heatMap = new Map(); // MeubleID -> Quantité
  let maxVal = 0;
  let totalPoints = 0;

  for (const ds of relevantSets) {
    // Check dates
    if (els.dateFrom.value && ds.date < els.dateFrom.value) continue;
    if (els.dateTo.value && ds.date > els.dateTo.value) continue;

    // Charger CSV si besoin
    if (!state.datasets.has(ds.file)) {
      const res = await fetch(ds.file);
      const text = await res.text();
      state.datasets.set(ds.file, parseCSV(text));
    }

    const data = state.datasets.get(ds.file);
    data.forEach(row => {
      // Parsing ID robuste: "MA01A1" -> "MA01"
      // On prend les 4 premiers caractères, MAIS on vérifie si c'est cohérent avec le plan
      // Ici on suppose format standard 4 char pour le meuble
      const meubleId = row.loc.substring(0, 4); 
      const qty = parseInt(row.qty) || 0;
      
      const current = heatMap.get(meubleId) || 0;
      heatMap.set(meubleId, current + qty);
      totalPoints += qty;
    });
  }

  // Trouver le nouveau max pour l'échelle
  for (const qty of heatMap.values()) {
    if (qty > maxVal) maxVal = qty;
  }

  // 3. Appliquer les couleurs
  const cells = els.planTable.querySelectorAll('td[data-id]');
  cells.forEach(td => {
    const id = td.dataset.id;
    const val = heatMap.get(id) || 0;
    
    if (val > 0) {
      const intensity = val / maxVal;
      td.style.backgroundColor = getHeatColor(intensity);
      td.dataset.val = val; // Pour le tooltip
    } else {
      td.style.backgroundColor = 'rgba(255,255,255,0.05)'; // Gris très sombre
      td.dataset.val = 0;
    }
  });

  // 4. Stats
  els.statPoints.textContent = totalPoints.toLocaleString();
  els.statMax.textContent = maxVal.toLocaleString();
}

function parseCSV(text) {
  // Format attendu: "ID de lieu,Quantité,"
  // Skip header row
  const lines = text.split('\n').slice(1);
  return lines.map(line => {
    const [loc, qty] = line.split(',');
    if (!loc) return null;
    return { loc: loc.trim(), qty: qty ? qty.trim() : 0 };
  }).filter(x => x);
}

function getHeatColor(intensity) {
  // Echelle Cyan -> Bleu -> Violet -> Rose (Cyberpunk/Tactical)
  // Ou plus simple : Transparence de Cyan
  // 0 -> transparent, 1 -> Cyan pur
  return `rgba(103, 232, 249, ${0.1 + (intensity * 0.9)})`; 
}

// ==================== UI UTILS ====================
function setZoom(lvl) {
  state.zoomLevel = Math.max(0.2, Math.min(3, lvl));
  els.planWrapper.style.transform = `scale(${state.zoomLevel})`;
  els.zoomVal.textContent = Math.round(state.zoomLevel * 100) + '%';
}

function showTooltip(e, id) {
  const td = e.target;
  const val = td.dataset.val || 0;
  
  els.tooltip.innerHTML = `
    <span class="tooltip-header">${id}</span>
    Picks: <strong>${val}</strong>
  `;
  els.tooltip.classList.add('visible');
  
  // Position follow mouse logic à ajouter sur mousemove container si besoin
  // Ici simple fixe proche souris
  const rect = td.getBoundingClientRect();
  els.tooltip.style.top = (rect.top - 40) + 'px';
  els.tooltip.style.left = (rect.left + 20) + 'px';
}

function hideTooltip() {
  els.tooltip.classList.remove('visible');
}

// Start
document.addEventListener('DOMContentLoaded', init);
