// js/app.js

// Global Application State
const state = {
  currentView: 'dashboard',
  selectedLocationId: 'loc-1',
  selectedBuildingId: 'bld-a',
  selectedFloorId: 'floor-1',
  selectedACId: null,
  isAddMarkerMode: false,
  tempMarkerCoords: null, // {x, y} percentage coordinates
  uploadedPhotos: [],     // Array of Base64 compressed image strings for the active form
  tableSortColumn: 'name',
  tableSortAsc: true
};

// Global reference for PanZoom instance
let panZoomInstance = null;

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
  // Wait for database initialization
  await window.acStore.init();

  // Setup store and default view (with URL routing for QR Code scanning)
  const urlParams = new URLSearchParams(window.location.search);
  const acId = urlParams.get('acId');
  if (acId) {
    const ac = window.acStore.getACById(acId);
    if (ac) {
      state.selectedLocationId = ac.locationId;
      state.selectedBuildingId = ac.buildingId;
      state.selectedFloorId = ac.floorId;
      switchView('floorplan');
      setTimeout(() => {
        openSideDrawer(ac.id);
      }, 300); // Short delay to let workspace render
    } else {
      switchView('dashboard');
    }
  } else {
    switchView('dashboard');
  }
  
  // Set default form values
  resetFormState();

  // Listen to escape key to close modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeACModal();
      closeSideDrawer();
    }
  });

  // Highlight default breadcrumbs
  updateBreadcrumbs();
  
  // Initialize Lucide Icons
  lucide.createIcons();
});

// ==========================================
// 1. ROUTING & VIEW CONTROLLER
// ==========================================
function switchView(viewName) {
  state.currentView = viewName;
  
  // Hide all views
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.add('hidden');
  });
  
  // Show target view
  const targetPanel = document.getElementById(`view-${viewName}`);
  if (targetPanel) {
    targetPanel.classList.remove('hidden');
  }

  // Update navigation styles
  updateNavbarActiveState(viewName);

  // Update Breadcrumbs
  updateBreadcrumbs();

  // Load view-specific data
  if (viewName === 'dashboard') {
    renderDashboard();
  } else if (viewName === 'location') {
    renderLocationSelection();
  } else if (viewName === 'floor') {
    renderFloorSelection();
  } else if (viewName === 'floorplan') {
    renderFloorPlan();
  } else if (viewName === 'list') {
    initTableFilters();
    renderACTable();
  }

  // Disable add marker mode when leaving floor plan
  if (viewName !== 'floorplan') {
    toggleAddMarkerMode(false);
  }

  // Re-render Icons
  setTimeout(() => lucide.createIcons(), 50);
}

function updateNavbarActiveState(activeView) {
  const tabs = {
    'dashboard': 'tab-dashboard',
    'floorplan': 'tab-floorplan',
    'list': 'tab-list'
  };

  Object.entries(tabs).forEach(([viewName, tabId]) => {
    const el = document.getElementById(tabId);
    if (!el) return;
    if (activeView === viewName || (viewName === 'floorplan' && ['location', 'floor', 'floorplan'].includes(activeView))) {
      el.className = "px-4 py-2 rounded-md text-sm font-medium transition bg-brand-500 text-white flex items-center gap-2";
    } else {
      el.className = "px-4 py-2 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition flex items-center gap-2";
    }
  });
}

function updateBreadcrumbs() {
  const sep1 = document.getElementById('breadcrumb-separator-1');
  const breadLoc = document.getElementById('breadcrumb-location');
  const sep2 = document.getElementById('breadcrumb-separator-2');
  const breadFloor = document.getElementById('breadcrumb-floor');

  // Reset
  sep1.classList.add('hidden');
  breadLoc.classList.add('hidden');
  sep2.classList.add('hidden');
  breadFloor.classList.add('hidden');

  if (state.currentView === 'dashboard') return;

  const loc = window.acStore.getLocation(state.selectedLocationId);
  const bld = window.acStore.getBuilding(state.selectedLocationId, state.selectedBuildingId);
  const flr = window.acStore.getFloor(state.selectedLocationId, state.selectedBuildingId, state.selectedFloorId);

  if (loc) {
    sep1.classList.remove('hidden');
    breadLoc.classList.remove('hidden');
    breadLoc.textContent = loc.name;
  }

  if (flr && bld && ['floorplan', 'floor'].includes(state.currentView)) {
    sep2.classList.remove('hidden');
    breadFloor.classList.remove('hidden');
    breadFloor.textContent = `${bld.name} - ${flr.name}`;
  }
}

function navigateToDefaultFloor() {
  const locations = window.acStore.getLocations();
  if (locations.length === 0) {
    alert("กรุณาเพิ่มสถานที่และแบบแปลนก่อนใช้งาน");
    switchView('dashboard');
    return;
  }

  // Check if current selection is valid
  const loc = window.acStore.getLocation(state.selectedLocationId);
  const bld = window.acStore.getBuilding(state.selectedLocationId, state.selectedBuildingId);
  const flr = window.acStore.getFloor(state.selectedLocationId, state.selectedBuildingId, state.selectedFloorId);

  if (loc && bld && flr) {
    switchView('floorplan');
    return;
  }

  // If not valid, find the first location that has a building and a floor
  for (const l of locations) {
    if (l.buildings && l.buildings.length > 0) {
      for (const b of l.buildings) {
        if (b.floors && b.floors.length > 0) {
          state.selectedLocationId = l.id;
          state.selectedBuildingId = b.id;
          state.selectedFloorId = b.floors[0].id;
          switchView('floorplan');
          return;
        }
      }
    }
  }

  // If no floor plan exists in any building, go to location setup view
  state.selectedLocationId = locations[0].id;
  if (locations[0].buildings && locations[0].buildings.length > 0) {
    state.selectedBuildingId = locations[0].buildings[0].id;
    switchView('floor'); // Show floor selection list
  } else {
    state.selectedBuildingId = null;
    switchView('location'); // Show building selection list
  }
}

// ==========================================
// 2. DASHBOARD VIEW RENDER
// ==========================================
function renderDashboard() {
  // Populate dropdown (retaining current selection)
  populateDashboardLocationDropdown();

  const dropdown = document.getElementById('dashboard-location-dropdown');
  const selectedLocationId = dropdown ? dropdown.value : '';

  const stats = window.acStore.getStats(selectedLocationId);
  
  // Update stats cards text content
  document.getElementById('stat-locations').textContent = stats.locationsCount;
  document.getElementById('stat-buildings').textContent = `รวม ${stats.buildingsCount} อาคาร`;
  document.getElementById('stat-total').textContent = stats.statusCounts.total;
  document.getElementById('stat-normal').textContent = stats.statusCounts.normal;
  document.getElementById('stat-check').textContent = stats.statusCounts.check;
  document.getElementById('stat-repair').textContent = stats.statusCounts.repair;
  document.getElementById('stat-broken').textContent = stats.statusCounts.broken;
  document.getElementById('stat-inactive').textContent = stats.statusCounts.inactive;

  // Render locations grid
  const grid = document.getElementById('locations-grid');
  grid.innerHTML = '';

  let locations = window.acStore.getLocations();
  if (selectedLocationId) {
    locations = locations.filter(loc => loc.id === selectedLocationId);
  }

  locations.forEach(loc => {
    // calculate stats per location
    const buildingsList = loc.buildings.map(b => b.name).join(', ') || 'ไม่มีอาคาร';
    const floorsCount = loc.buildings.reduce((sum, b) => sum + b.floors.length, 0);
    const acs = window.acStore.getACs({ locationId: loc.id });
    const completedCount = acs.filter(ac => ac.status === 'normal').length;

    const card = document.createElement('div');
    card.className = "location-card bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md hover:border-brand-500 transition cursor-pointer flex flex-col justify-between";
    card.onclick = () => {
      state.selectedLocationId = loc.id;
      // Automatically select the first building if it exists, otherwise go to building setup
      if (loc.buildings && loc.buildings.length > 0) {
        state.selectedBuildingId = loc.buildings[0].id;
        switchView('floor');
      } else {
        state.selectedBuildingId = null;
        switchView('location');
      }
    };

    card.innerHTML = `
      <div>
        <div class="flex items-start justify-between mb-4">
          <div class="p-3 bg-brand-50 rounded-lg text-brand-800">
            <i data-lucide="building-2" class="w-6 h-6"></i>
          </div>
          <span class="text-xs bg-slate-100 text-slate-600 font-bold px-2 py-1 rounded-full">${floorsCount} ชั้นทั้งหมด</span>
        </div>
        <h4 class="text-lg font-bold text-slate-800">${loc.name}</h4>
        <p class="text-xs text-slate-500 mt-1">อาคาร: ${buildingsList}</p>
      </div>
      
      <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
        <div>
          <span class="text-[11px] text-slate-400 block uppercase font-bold">บันทึกเครื่องปรับอากาศ</span>
          <span class="text-sm font-semibold text-slate-700">${acs.length} เครื่อง <span class="text-xs text-emerald-500 font-bold">(ปกติ ${completedCount})</span></span>
        </div>
        <div class="text-brand-500 font-bold text-xs flex items-center gap-1">
          เปิดดูชั้น <i data-lucide="chevron-right" class="w-4 h-4"></i>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
  
  lucide.createIcons();
}

function filterLocationCards() {
  const q = document.getElementById('location-search-input').value.toLowerCase();
  const cards = document.querySelectorAll('.location-card');
  
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    if (text.includes(q)) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
}

function handleDashboardSearch() {
  const query = document.getElementById('dashboard-search-input').value;
  const resultsContainer = document.getElementById('dashboard-search-results');
  
  if (!query.trim()) {
    resultsContainer.classList.add('hidden');
    return;
  }

  const results = window.acStore.getACs({ searchQuery: query });
  resultsContainer.innerHTML = '';
  resultsContainer.classList.remove('hidden');

  if (results.length === 0) {
    resultsContainer.innerHTML = `<div class="p-4 text-xs text-slate-500 text-center">ไม่พบเครื่องปรับอากาศที่ค้นหา</div>`;
    return;
  }

  results.forEach(ac => {
    const loc = window.acStore.getLocation(ac.locationId);
    const bld = window.acStore.getBuilding(ac.locationId, ac.buildingId);
    const flr = window.acStore.getFloor(ac.locationId, ac.buildingId, ac.floorId);
    
    const div = document.createElement('div');
    div.className = "p-3 hover:bg-slate-50 cursor-pointer flex items-center justify-between text-xs";
    div.onclick = () => {
      resultsContainer.classList.add('hidden');
      document.getElementById('dashboard-search-input').value = '';
      locateAC(ac.id, ac.locationId, ac.buildingId, ac.floorId);
    };

    let statusText = 'ใช้งานปกติ';
    let statusClass = 'bg-emerald-500';
    if (ac.status === 'check') { statusText = 'ต้องตรวจสอบ'; statusClass = 'bg-amber-500'; }
    if (ac.status === 'repair') { statusText = 'ต้องซ่อม'; statusClass = 'bg-orange-500'; }
    if (ac.status === 'broken') { statusText = 'ชำรุด'; statusClass = 'bg-red-500'; }
    if (ac.status === 'inactive') { statusText = 'ไม่ใช้งาน'; statusClass = 'bg-slate-400'; }

    div.innerHTML = `
      <div>
        <div class="font-bold text-slate-800">${ac.name} (${ac.type} - ${ac.btu} BTU)</div>
        <div class="text-slate-500 mt-0.5">${loc?.name} > ${bld?.name} > ${flr?.name} (${ac.room || 'ไม่ระบุห้อง'})</div>
      </div>
      <div class="flex items-center gap-1.5 font-bold">
        <span class="w-2 h-2 rounded-full ${statusClass}"></span>
        <span>${statusText}</span>
      </div>
    `;
    resultsContainer.appendChild(div);
  });
}

// ==========================================
// 3. LOCATION & BUILDING SELECTION VIEW
// ==========================================
function renderLocationSelection() {
  const container = document.getElementById('location-selection-container');
  container.innerHTML = '';

  const locations = window.acStore.getLocations();
  locations.forEach(loc => {
    // calculate stats per location
    const buildingsList = loc.buildings.map(b => b.name).join(', ') || 'ไม่มีอาคาร';
    const floorsCount = loc.buildings.reduce((sum, b) => sum + b.floors.length, 0);
    const acs = window.acStore.getACs({ locationId: loc.id });
    const completedCount = acs.filter(ac => ac.status === 'normal').length;

    const card = document.createElement('div');
    card.className = "location-card bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md hover:border-brand-500 transition cursor-pointer flex flex-col justify-between relative group";
    
    // Clicking the card takes the user to the floor selection view
    card.onclick = () => {
      state.selectedLocationId = loc.id;
      if (loc.buildings && loc.buildings.length > 0) {
        state.selectedBuildingId = loc.buildings[0].id;
        switchView('floor');
      } else {
        state.selectedBuildingId = null;
        switchView('location');
      }
    };

    card.innerHTML = `
      <div>
        <div class="flex items-start justify-between mb-4">
          <div class="p-3 bg-brand-50 rounded-lg text-brand-800 flex-none">
            <i data-lucide="building-2" class="w-6 h-6"></i>
          </div>
          <div class="flex items-center gap-1.5 flex-none">
            <button onclick="promptRenameLocation('${loc.id}'); event.stopPropagation();" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-600 transition p-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded" title="แก้ไขชื่อสถานที่">
              <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="confirmDeleteLocation('${loc.id}'); event.stopPropagation();" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition p-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded" title="ลบสถานที่">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
            <span class="text-xs bg-slate-100 text-slate-600 font-bold px-2 py-1 rounded-full">${floorsCount} ชั้นทั้งหมด</span>
          </div>
        </div>
        <h4 class="text-lg font-bold text-slate-800 truncate" title="${loc.name}">${loc.name}</h4>
        <p class="text-xs text-slate-500 mt-1 truncate">อาคาร: ${buildingsList}</p>
      </div>
      
      <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
        <div>
          <span class="text-[11px] text-slate-400 block uppercase font-bold">บันทึกเครื่องปรับอากาศ</span>
          <span class="text-sm font-semibold text-slate-700">${acs.length} เครื่อง <span class="text-xs text-emerald-500 font-bold">(ปกติ ${completedCount})</span></span>
        </div>
        <div class="text-brand-500 font-bold text-xs flex items-center gap-1">
          เปิดดูชั้น <i data-lucide="chevron-right" class="w-4 h-4"></i>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
  
  lucide.createIcons();
}

function selectLocationAndBuilding(locId, bldId) {
  state.selectedLocationId = locId;
  state.selectedBuildingId = bldId;
  switchView('floor');
}

function filterLocationSelectCards() {
  const q = document.getElementById('select-location-search').value.toLowerCase();
  const sections = document.querySelectorAll('.location-select-item');
  
  sections.forEach(sec => {
    const text = sec.textContent.toLowerCase();
    if (text.includes(q)) {
      sec.style.display = 'block';
    } else {
      sec.style.display = 'none';
    }
  });
}

// ==========================================
// 4. FLOOR SELECTION VIEW RENDER
// ==========================================
function renderFloorSelection() {
  const loc = window.acStore.getLocation(state.selectedLocationId);
  const bld = window.acStore.getBuilding(state.selectedLocationId, state.selectedBuildingId);
  
  if (!loc || !bld) {
    switchView('dashboard');
    return;
  }

  // Update headers
  document.getElementById('floor-select-title').textContent = `${loc.name} - ${bld.name}`;
  document.getElementById('floor-select-subtitle').textContent = `เลือกชั้นที่ต้องการเพื่อจัดตำแหน่งและดูรายละเอียดเครื่องปรับอากาศ`;
  
  const acsInBuilding = window.acStore.getACs({ locationId: loc.id, buildingId: bld.id });
  document.getElementById('floor-select-total-counter').textContent = `ทั้งหมด ${acsInBuilding.length} เครื่อง`;

  // Bind back buttons
  document.getElementById('btn-back-to-location').onclick = () => {
    switchView('location');
  };

  // Render floors
  const listContainer = document.getElementById('floors-list-container');
  listContainer.innerHTML = '';

  bld.floors.forEach(floor => {
    const floorAcs = acsInBuilding.filter(ac => ac.floorId === floor.id);
    const normalCount = floorAcs.filter(ac => ac.status === 'normal').length;
    const attentionCount = floorAcs.filter(ac => ['check', 'repair', 'broken'].includes(ac.status)).length;
    
    const item = document.createElement('div');
    item.className = "group flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer transition border-b border-slate-100 last:border-0";
    item.onclick = () => {
      state.selectedFloorId = floor.id;
      switchView('floorplan');
    };

    item.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center text-brand-800 font-bold text-sm flex-none">
          ${getFloorAbbreviation(floor.name)}
        </div>
        <div>
          <span class="font-bold text-slate-800 flex items-center gap-1.5 text-sm">
            <span>${floor.name}</span>
            <button onclick="promptRenameFloor('${loc.id}', '${bld.id}', '${floor.id}'); event.stopPropagation();" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-600 transition p-0.5 rounded" title="แก้ไขชื่อชั้น">
              <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="confirmDeleteFloor('${loc.id}', '${bld.id}', '${floor.id}'); event.stopPropagation();" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition p-0.5 rounded" title="ลบชั้น">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </span>
          <span class="text-xs text-slate-400 block mt-0.5">แผนผังอาคารปฏิบัติงาน</span>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="text-right">
          <div class="text-sm font-bold text-slate-700">${floorAcs.length} เครื่อง</div>
          <div class="text-[10px] flex items-center gap-1.5 justify-end">
            <span class="text-emerald-500 font-semibold">ปกติ ${normalCount}</span>
            ${attentionCount > 0 ? `<span class="text-rose-500 font-bold">เตือน ${attentionCount}</span>` : ''}
          </div>
        </div>
        <i data-lucide="chevron-right" class="w-5 h-5 text-slate-400"></i>
      </div>
    `;
    listContainer.appendChild(item);
  });
  
  lucide.createIcons();
}

// ==========================================
// 5. FLOOR PLAN WORKSPACE (MAIN COMPONENT)
// ==========================================
function renderFloorPlan() {
  const loc = window.acStore.getLocation(state.selectedLocationId);
  const bld = window.acStore.getBuilding(state.selectedLocationId, state.selectedBuildingId);
  const flr = window.acStore.getFloor(state.selectedLocationId, state.selectedBuildingId, state.selectedFloorId);

  if (!loc || !bld || !flr) {
    switchView('dashboard');
    return;
  }

  // Reset map sidebar to be open by default when a new floor plan is loaded
  const sidebar = document.getElementById('map-sidebar');
  const openBtn = document.getElementById('btn-open-sidebar');
  if (sidebar) sidebar.classList.remove('collapsed-sidebar');
  if (openBtn) openBtn.classList.add('hidden');

  // Update Page Headers
  document.getElementById('floorplan-title').textContent = `${loc.name} - ${bld.name}`;
  document.getElementById('floorplan-subtitle').textContent = `${flr.name} | แผนที่แสดงตำแหน่งอุปกรณ์จริง`;

  // Update floor plan map background image
  const imgEl = document.getElementById('floorplan-image');
  if (flr.image) {
    imgEl.src = flr.image;
  } else {
    // If no plan, set a grid placeholder so the system is always operable
    imgEl.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="%23f1f5f9"/><path d="M0,0 H800 V500 H0 Z" fill="none" stroke="%23cbd5e1" stroke-width="10"/><text x="400" y="230" font-family="Sarabun, sans-serif" font-size="24" font-weight="bold" fill="%2394a3b8" text-anchor="middle">ยังไม่มีไฟล์แผนผัง Floor Plan</p><text x="400" y="270" font-family="Sarabun, sans-serif" font-size="14" fill="%2364748b" text-anchor="middle">อัปโหลดไฟล์ PNG, JPG หรือ PDF ที่แถบด้านซ้ายเพื่อเปิดมาร์คตำแหน่ง</text></svg>';
  }

  // Bind Sidebar AC List
  renderSidebarACList();

  // Render Markers
  renderMarkers();
}

// Triggered when floor plan image successfully loads on screen
function onFloorPlanImageLoaded() {
  const container = document.getElementById('panzoom-viewport');
  const content = document.getElementById('panzoom-content');

  // Initialize or re-fit PanZoom
  if (!panZoomInstance) {
    panZoomInstance = new PanZoom(container, content, {
      onClick: (x, y) => {
        if (state.isAddMarkerMode) {
          state.tempMarkerCoords = { x, y };
          openAddACModal(x, y);
        }
      },
      onDragMarkerStart: () => {
        // disable pan zooming events during marker drag
      },
      onDragMarkerEnd: () => {
        // re-enable
      }
    });
  }

  // Fit image to workspace
  setTimeout(() => {
    panZoomInstance.zoomToFit();
  }, 100);
}

// Sidebar list on the map view
function renderSidebarACList() {
  const acs = window.acStore.getACs({
    locationId: state.selectedLocationId,
    buildingId: state.selectedBuildingId,
    floorId: state.selectedFloorId
  });

  document.getElementById('sidebar-ac-count').textContent = `${acs.length} เครื่อง`;

  const container = document.getElementById('sidebar-ac-list');
  container.innerHTML = '';

  if (acs.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400 text-xs">
        <i data-lucide="info" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
        <span>ยังไม่มีการมาร์คตำแหน่งแอร์ในชั้นนี้</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  acs.forEach(ac => {
    const item = document.createElement('div');
    item.className = "p-3 hover:bg-slate-50 cursor-pointer transition flex items-center justify-between border-b border-slate-100";
    item.onclick = () => highlightMarkerOnMap(ac.id);

    let statusClass = 'bg-emerald-500';
    if (ac.status === 'check') statusClass = 'bg-amber-500';
    if (ac.status === 'repair') statusClass = 'bg-orange-500';
    if (ac.status === 'broken') statusClass = 'bg-red-500';
    if (ac.status === 'inactive') statusClass = 'bg-slate-400';

    item.innerHTML = `
      <div class="text-xs">
        <div class="font-bold text-slate-800">${ac.name}</div>
        <div class="text-slate-500">${ac.room || 'ไม่ระบุห้อง'}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${ac.type} | ${ac.btu || '-'} BTU</div>
      </div>
      <span class="w-2.5 h-2.5 rounded-full ${statusClass} flex-none"></span>
    `;
    container.appendChild(item);
  });
}

// Marker render loop
function renderMarkers() {
  const overlay = document.getElementById('markers-overlay');
  overlay.innerHTML = '';

  // Get active filters
  const checkedFilters = Array.from(document.querySelectorAll('.status-filter:checked')).map(el => el.value);

  const acs = window.acStore.getACs({
    locationId: state.selectedLocationId,
    buildingId: state.selectedBuildingId,
    floorId: state.selectedFloorId,
    status: checkedFilters
  });

  acs.forEach(ac => {
    const marker = document.createElement('div');
    marker.id = `marker-${ac.id}`;
    marker.className = `ac-marker marker-${ac.status} pointer-events-auto`;
    marker.style.left = `${ac.x}%`;
    marker.style.top = `${ac.y}%`;

    marker.innerHTML = `
      <div class="marker-circle">
        <i data-lucide="snowflake" class="w-5 h-5 text-white"></i>
      </div>
      <div class="marker-label">${ac.name}</div>
      
      <!-- Custom popover tooltip on hover -->
      <div class="ac-tooltip no-pan">
        <div class="text-xs font-bold text-slate-900 mb-1 border-b border-slate-100 pb-1">${ac.name}</div>
        <table class="text-[10px] text-slate-600 w-full mb-2">
          <tr>
            <td class="font-semibold py-0.5">ชนิด:</td>
            <td>${ac.type}</td>
          </tr>
          <tr>
            <td class="font-semibold py-0.5">BTU:</td>
            <td>${ac.btu || '-'}</td>
          </tr>
          <tr>
            <td class="font-semibold py-0.5">ห้อง:</td>
            <td class="truncate max-w-[100px]">${ac.room || 'ไม่ระบุ'}</td>
          </tr>
        </table>
        <button onclick="openSideDrawer('${ac.id}'); event.stopPropagation();" class="w-full bg-brand-800 text-white rounded text-[10px] py-1 font-bold hover:bg-slate-700 transition text-center block">
          ดูรายละเอียดเครื่อง
        </button>
      </div>
    `;

    // Make Marker draggable
    if (panZoomInstance) {
      panZoomInstance.makeMarkerDraggable(marker, (newX, newY) => {
        // Save new percentages
        window.acStore.updateACPosition(ac.id, newX, newY);
        // Refresh sidebar coordinates if details are active
        if (state.selectedACId === ac.id) {
          document.getElementById('detail-room').textContent = `${ac.room || '-'} (X: ${newX.toFixed(1)}%, Y: ${newY.toFixed(1)}%)`;
        }
      });
    }

    // Attach click to open side drawer
    marker.addEventListener('click', (e) => {
      // Prevents container pan events trigger
      e.stopPropagation();
      openSideDrawer(ac.id);
    });

    overlay.appendChild(marker);
  });

  // Render Lucide icons inside markers
  lucide.createIcons();
}

// Toggles "Add marker mode" on the map
function toggleAddMarkerMode(forceState) {
  state.isAddMarkerMode = typeof forceState === 'boolean' ? forceState : !state.isAddMarkerMode;
  
  const instruction = document.getElementById('drag-instruction');
  const btn = document.getElementById('btn-toggle-add-mode');
  const viewport = document.getElementById('panzoom-viewport');

  if (state.isAddMarkerMode) {
    instruction.classList.remove('hidden');
    btn.innerHTML = `<i data-lucide="x" class="w-4 h-4"></i> ยกเลิกการเพิ่ม`;
    btn.className = "px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded flex items-center gap-1.5 shadow transition";
    viewport.style.cursor = 'crosshair';
  } else {
    instruction.classList.add('hidden');
    btn.innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4"></i> เพิ่มแอร์ลงแปลน`;
    btn.className = "px-3 py-1.5 bg-brand-800 hover:bg-slate-700 text-white text-xs font-bold rounded flex items-center gap-1.5 shadow transition";
    viewport.style.cursor = 'grab';
    state.tempMarkerCoords = null;
  }
  lucide.createIcons();
}

// Highlights and centers a marker on the Floor Plan
function highlightMarkerOnMap(acId) {
  const ac = window.acStore.getACById(acId);
  if (!ac || !panZoomInstance) return;

  // Zoom onto coordinates
  const viewportRect = document.getElementById('panzoom-viewport').getBoundingClientRect();
  const imgEl = document.getElementById('floorplan-image');
  
  const naturalWidth = imgEl.offsetWidth || imgEl.clientWidth || 800;
  const naturalHeight = imgEl.offsetHeight || imgEl.clientHeight || 650;

  // Calculate absolute target pixels relative to the image
  const targetX = (ac.x / 100) * naturalWidth;
  const targetY = (ac.y / 100) * naturalHeight;

  // Set zoom scale (e.g. 1.2x)
  const zoomScale = 1.5;
  panZoomInstance.state.scale = zoomScale;
  
  // Center translation formula: viewport_center - (marker_coord * scale)
  panZoomInstance.state.x = (viewportRect.width / 2) - (targetX * zoomScale);
  panZoomInstance.state.y = (viewportRect.height / 2) - (targetY * zoomScale);

  panZoomInstance.updateTransform();

  // Add temporary pulsing flash to the target marker element
  const marker = document.getElementById(`marker-${acId}`);
  if (marker) {
    marker.classList.add('dragging');
    setTimeout(() => marker.classList.remove('dragging'), 1500);
  }
}

// Set up PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
}

// Convert PDF file first page to ultra-sharp JPEG image
async function convertPdfToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const typedarray = new Uint8Array(e.target.result);
      try {
        const loadingTask = pdfjsLib.getDocument({ data: typedarray });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        
        // Calculate dynamic scale to target 4K+ resolution (4500px on the longest side)
        // This keeps the vector lines and text razor-sharp while staying safe under iOS Safari canvas limit (16 megapixels)
        const pageViewport = page.getViewport({ scale: 1.0 });
        const width = pageViewport.width;
        const height = pageViewport.height;
        const targetLongestSide = 4500;
        let scale = 1.0;

        if (width > height) {
          scale = targetLongestSide / width;
        } else {
          scale = targetLongestSide / height;
        }
        
        // Ensure scale is at least 1.5 for very small templates
        scale = Math.max(scale, 1.5);

        const viewport = page.getViewport({ scale: scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        const context = canvas.getContext('2d');
        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };
        
        await page.render(renderContext).promise;
        
        // Output high quality JPEG (90% quality)
        const base64Image = canvas.toDataURL('image/jpeg', 0.9);
        resolve(base64Image);
      } catch (err) {
        console.error('PDF rendering failed', err);
        reject(new Error('ไม่สามารถแปลงไฟล์ PDF เป็นรูปภาพได้: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการอ่านไฟล์ PDF'));
    reader.readAsArrayBuffer(file);
  });
}

// Local image / PDF floorplan uploader
async function handleFloorPlanUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Render loading indicator inside sidebar upload area
  const uploaderLabel = event.target.nextElementSibling;
  const originalHtml = uploaderLabel ? uploaderLabel.innerHTML : '';
  
  if (uploaderLabel) {
    uploaderLabel.innerHTML = `
      <div class="text-center text-brand-600 animate-pulse py-2">
        <div class="w-6 h-6 mx-auto border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-1"></div>
        <span class="text-[10px] font-bold block">กำลังแปลงแปลน PDF...</span>
        <span class="text-[8px] text-slate-400 block">กรุณารอสักครู่ (คุณภาพสูง 4K)</span>
      </div>
    `;
  }

  // If the file is a PDF
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      const base64Image = await convertPdfToImage(file);
      
      // Save to active floor details
      window.acStore.updateFloorPlanImage(
        state.selectedLocationId,
        state.selectedBuildingId,
        state.selectedFloorId,
        base64Image
      );

      // Reload plan view
      renderFloorPlan();
    } catch (err) {
      alert("เกิดข้อผิดพลาด: " + err.message);
    } finally {
      // Revert uploader UI
      if (uploaderLabel) uploaderLabel.innerHTML = originalHtml;
    }
    return;
  }

  // Standard Image Upload (PNG/JPG)
  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    
    // Save to active floor details
    window.acStore.updateFloorPlanImage(
      state.selectedLocationId,
      state.selectedBuildingId,
      state.selectedFloorId,
      base64
    );

    // Reload plan view
    renderFloorPlan();
    if (uploaderLabel) uploaderLabel.innerHTML = originalHtml;
  };
  reader.readAsDataURL(file);
}

// Quick map searching search box handler
function handleMapSearch(val) {
  const dropdown = document.getElementById('map-search-dropdown');
  if (!val.trim()) {
    dropdown.classList.add('hidden');
    return;
  }

  const matches = window.acStore.getACs({
    locationId: state.selectedLocationId,
    buildingId: state.selectedBuildingId,
    floorId: state.selectedFloorId,
    searchQuery: val
  });

  dropdown.innerHTML = '';
  dropdown.classList.remove('hidden');

  if (matches.length === 0) {
    dropdown.innerHTML = `<div class="p-2 text-slate-400 text-center">ไม่พบผลลัพธ์</div>`;
    return;
  }

  matches.forEach(ac => {
    const item = document.createElement('div');
    item.className = "p-2 hover:bg-slate-50 cursor-pointer text-slate-700 font-medium";
    item.textContent = `${ac.name} (${ac.room || 'ไม่ระบุห้อง'})`;
    item.onclick = () => {
      dropdown.classList.add('hidden');
      document.getElementById('map-search-input').value = '';
      highlightMarkerOnMap(ac.id);
      openSideDrawer(ac.id);
    };
    dropdown.appendChild(item);
  });
}

// ==========================================
// 6. DETAIL SIDE DRAWER RENDER
// ==========================================
function openSideDrawer(acId) {
  state.selectedACId = acId;
  const ac = window.acStore.getACById(acId);
  if (!ac) return;

  const drawer = document.getElementById('side-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const panel = document.getElementById('drawer-panel');

  // Display drawer
  drawer.classList.remove('hidden');
  setTimeout(() => {
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');
    panel.classList.remove('translate-x-full');
    panel.classList.add('translate-x-0');
  }, 10);

  // Populate data
  document.getElementById('detail-ac-name').textContent = ac.name;
  document.getElementById('detail-brand-model').textContent = `${ac.brand || '-'} / ${ac.model || '-'}`;
  document.getElementById('detail-type').textContent = ac.type;
  document.getElementById('detail-system-type').textContent = ac.systemType || 'ระบบน้ำยา';
  document.getElementById('detail-btu').textContent = ac.btu ? `${ac.btu} BTU` : '-';
  document.getElementById('detail-serial').textContent = ac.serialNumber || '-';
  document.getElementById('detail-install-date').textContent = formatDate(ac.installDate) || '-';
  document.getElementById('detail-note').textContent = ac.note || 'ไม่มีข้อมูลบันทึกหมายเหตุ';
  document.getElementById('detail-updated-by').textContent = ac.updatedBy || 'ช่างประจำโครงการ';
  document.getElementById('detail-updated-at').textContent = formatDateTime(ac.updatedAt);
  
  // Locations metadata
  const loc = window.acStore.getLocation(ac.locationId);
  const bld = window.acStore.getBuilding(ac.locationId, ac.buildingId);
  const flr = window.acStore.getFloor(ac.locationId, ac.buildingId, ac.floorId);
  
  document.getElementById('detail-location').textContent = loc?.name || '-';
  document.getElementById('detail-building-floor').textContent = `${bld?.name || '-'} / ${flr?.name || '-'}`;
  document.getElementById('detail-room').textContent = `${ac.room || '-'} (X: ${ac.x.toFixed(1)}%, Y: ${ac.y.toFixed(1)}%)`;

  // Status mapping
  const statusPill = document.getElementById('detail-status-pill');
  const statusText = document.getElementById('detail-status-text');
  
  statusPill.className = "w-4 h-4 rounded-full";
  if (ac.status === 'normal') {
    statusPill.classList.add('bg-emerald-500');
    statusText.textContent = 'ใช้งานปกติ';
    statusText.className = 'text-sm font-bold text-emerald-600';
  } else if (ac.status === 'check') {
    statusPill.classList.add('bg-amber-500');
    statusText.textContent = 'ต้องตรวจสอบ';
    statusText.className = 'text-sm font-bold text-amber-500';
  } else if (ac.status === 'repair') {
    statusPill.classList.add('bg-orange-500');
    statusText.textContent = 'ต้องซ่อม / รอซ่อม';
    statusText.className = 'text-sm font-bold text-orange-500';
  } else if (ac.status === 'broken') {
    statusPill.classList.add('bg-rose-500');
    statusText.textContent = 'ชำรุด';
    statusText.className = 'text-sm font-bold text-rose-600';
  } else {
    statusPill.classList.add('bg-slate-400');
    statusText.textContent = 'ไม่ได้ใช้งาน';
    statusText.className = 'text-sm font-bold text-slate-500';
  }

  // Populate Photos
  const imgContainer = document.getElementById('detail-images-container');
  imgContainer.innerHTML = '';

  if (ac.images && ac.images.length > 0) {
    ac.images.forEach((imgBase64, idx) => {
      const imgDiv = document.createElement('div');
      imgDiv.className = "relative rounded-lg overflow-hidden border border-slate-200 aspect-[4/3] bg-slate-100 group shadow-sm";
      imgDiv.innerHTML = `
        <img src="${imgBase64}" alt="AC Real Photo" class="w-full h-full object-cover">
        <a href="${imgBase64}" target="_blank" class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition text-xs font-semibold gap-1">
          <i data-lucide="eye" class="w-4 h-4"></i> ดูรูปใหญ่
        </a>
      `;
      imgContainer.appendChild(imgDiv);
    });
  } else {
    imgContainer.className = "block";
    imgContainer.innerHTML = `
      <div class="border border-slate-200 rounded-lg p-6 bg-slate-50 text-slate-400 text-center text-xs">
        <i data-lucide="image-off" class="w-8 h-8 mx-auto text-slate-300 mb-2"></i>
        <span>ไม่มีรูปถ่ายเครื่องปรับอากาศของจริงแนบไว้</span>
      </div>
    `;
  }

  // Render maintenance history list
  renderMaintenanceHistory(ac);

  lucide.createIcons();
}

function closeSideDrawer() {
  const backdrop = document.getElementById('drawer-backdrop');
  const panel = document.getElementById('drawer-panel');

  backdrop.classList.remove('opacity-100');
  backdrop.classList.add('opacity-0');
  panel.classList.remove('translate-x-0');
  panel.classList.add('translate-x-full');

  setTimeout(() => {
    document.getElementById('side-drawer').classList.add('hidden');
    state.selectedACId = null;
  }, 300);
}

function locateACFromDrawer() {
  if (state.selectedACId) {
    const ac = window.acStore.getACById(state.selectedACId);
    if (ac) {
      closeSideDrawer();
      switchView('floorplan');
      highlightMarkerOnMap(ac.id);
    }
  }
}

function editACFromDrawer() {
  if (state.selectedACId) {
    const id = state.selectedACId;
    closeSideDrawer();
    openAddACModal(null, null, id);
  }
}

function deleteACFromDrawer() {
  if (!state.selectedACId) return;
  
  const ac = window.acStore.getACById(state.selectedACId);
  if (confirm(`คุณแน่ใจว่าต้องการลบเครื่องปรับอากาศหมายเลข ${ac.name} หรือไม่? ข้อมูลการมาร์คตำแหน่งและรูปภาพจะถูกลบอย่างถาวร`)) {
    window.acStore.deleteAC(ac.id);
    closeSideDrawer();
    
    // Refresh view
    if (state.currentView === 'floorplan') {
      renderFloorPlan();
    } else if (state.currentView === 'list') {
      renderACTable();
    }
  }
}

// Helper to navigate directly to an AC on map from global search
function locateAC(acId, locId, bldId, flrId) {
  state.selectedLocationId = locId;
  state.selectedBuildingId = bldId;
  state.selectedFloorId = flrId;
  
  switchView('floorplan');
  setTimeout(() => {
    highlightMarkerOnMap(acId);
    openSideDrawer(acId);
  }, 300);
}

// ==========================================
// 7. FORM MODAL & IMAGE UPLOADS
// ==========================================
function openAddACModal(x = null, y = null, editId = null) {
  const modal = document.getElementById('ac-modal');
  modal.classList.remove('hidden');

  // Reset form inputs and local state
  resetFormState();
  populateFormDropdowns();

  const titleEl = document.getElementById('modal-title');
  const coordIndicator = document.getElementById('form-coords-indicator');
  
  if (editId) {
    // EDIT MODE
    titleEl.textContent = 'แก้ไขข้อมูลเครื่องปรับอากาศ';
    coordIndicator.classList.remove('hidden');

    const ac = window.acStore.getACById(editId);
    if (ac) {
      document.getElementById('form-ac-id').value = ac.id;
      document.getElementById('form-name').value = ac.name;
      document.getElementById('form-serial').value = ac.serialNumber || '';
      
      const standardTypes = ["Wall Type", "Cassette Type", "Ceiling Type", "Duct Type", "Floor Type", "Package", "Split Type"];
      if (standardTypes.includes(ac.type)) {
        document.getElementById('form-type').value = ac.type;
        document.getElementById('form-custom-type-container').classList.add('hidden');
        document.getElementById('form-custom-type').value = '';
      } else {
        document.getElementById('form-type').value = 'อื่นๆ';
        document.getElementById('form-custom-type-container').classList.remove('hidden');
        document.getElementById('form-custom-type').value = ac.type;
      }

      const standardSystemTypes = ["ระบบน้ำยา", "ระบบน้ำเย็น"];
      if (standardSystemTypes.includes(ac.systemType || '')) {
        document.getElementById('form-system-type').value = ac.systemType || 'ระบบน้ำยา';
        document.getElementById('form-custom-system-type-container').classList.add('hidden');
        document.getElementById('form-custom-system-type').value = '';
      } else {
        document.getElementById('form-system-type').value = 'อื่นๆ';
        document.getElementById('form-custom-system-type-container').classList.remove('hidden');
        document.getElementById('form-custom-system-type').value = ac.systemType;
      }
      document.getElementById('form-btu').value = ac.btu || '';
      document.getElementById('form-brand').value = ac.brand || '';
      document.getElementById('form-model').value = ac.model || '';
      document.getElementById('form-date').value = ac.installDate || '';
      document.getElementById('form-status').value = ac.status;
      document.getElementById('form-room').value = ac.room || '';
      document.getElementById('form-note').value = ac.note || '';
      document.getElementById('form-updated-by').value = ac.updatedBy || 'ช่างสมชาย มั่นคง';

      // Set positions
      document.getElementById('form-ac-x').value = ac.x;
      document.getElementById('form-ac-y').value = ac.y;
      document.getElementById('form-indicator-x').textContent = ac.x.toFixed(1);
      document.getElementById('form-indicator-y').textContent = ac.y.toFixed(1);

      // Select Dropdowns
      document.getElementById('form-location').value = ac.locationId;
      onFormLocationChange();
      document.getElementById('form-building').value = ac.buildingId;
      onFormBuildingChange();
      document.getElementById('form-floor').value = ac.floorId;

      // Populate Images
      state.uploadedPhotos = [...(ac.images || [])];
      renderPhotoPreviews();
    }
  } else {
    // ADD MODE
    titleEl.textContent = 'เพิ่มเครื่องปรับอากาศใหม่';
    
    // Default location dropdown selects current map view values
    document.getElementById('form-location').value = state.selectedLocationId;
    onFormLocationChange();
    document.getElementById('form-building').value = state.selectedBuildingId;
    onFormBuildingChange();
    document.getElementById('form-floor').value = state.selectedFloorId;

    if (x !== null && y !== null) {
      coordIndicator.classList.remove('hidden');
      document.getElementById('form-ac-x').value = x;
      document.getElementById('form-ac-y').value = y;
      document.getElementById('form-indicator-x').textContent = parseFloat(x).toFixed(1);
      document.getElementById('form-indicator-y').textContent = parseFloat(y).toFixed(1);
    } else {
      coordIndicator.classList.add('hidden');
      document.getElementById('form-ac-x').value = 50;
      document.getElementById('form-ac-y').value = 50;
    }
  }

  lucide.createIcons();
}

function closeACModal() {
  document.getElementById('ac-modal').classList.add('hidden');
  resetFormState();
  toggleAddMarkerMode(false);
}

function resetFormState() {
  document.getElementById('ac-form').reset();
  document.getElementById('form-ac-id').value = '';
  document.getElementById('form-ac-x').value = '50';
  document.getElementById('form-ac-y').value = '50';
  
  // Reset custom type inputs
  document.getElementById('form-custom-type-container').classList.add('hidden');
  document.getElementById('form-custom-type').value = '';
  document.getElementById('form-custom-type').required = false;
  document.getElementById('form-system-type').value = 'ระบบน้ำยา';
  document.getElementById('form-custom-system-type-container').classList.add('hidden');
  document.getElementById('form-custom-system-type').value = '';
  document.getElementById('form-custom-system-type').required = false;

  // Set default technician identity
  document.getElementById('form-updated-by').value = 'ช่างสมชาย มั่นคง';

  state.uploadedPhotos = [];
  renderPhotoPreviews();
}

function populateFormDropdowns() {
  const locDropdown = document.getElementById('form-location');
  locDropdown.innerHTML = '';
  
  const locations = window.acStore.getLocations();
  locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = loc.name;
    locDropdown.appendChild(opt);
  });
}

function onFormLocationChange() {
  const locId = document.getElementById('form-location').value;
  const bldDropdown = document.getElementById('form-building');
  bldDropdown.innerHTML = '';

  const loc = window.acStore.getLocation(locId);
  if (loc) {
    loc.buildings.forEach(bld => {
      const opt = document.createElement('option');
      opt.value = bld.id;
      opt.textContent = bld.name;
      bldDropdown.appendChild(opt);
    });
  }
  onFormBuildingChange();
}

function onFormBuildingChange() {
  const locId = document.getElementById('form-location').value;
  const bldId = document.getElementById('form-building').value;
  const flDropdown = document.getElementById('form-floor');
  flDropdown.innerHTML = '';

  const bld = window.acStore.getBuilding(locId, bldId);
  if (bld) {
    bld.floors.forEach(fl => {
      const opt = document.createElement('option');
      opt.value = fl.id;
      opt.textContent = fl.name;
      flDropdown.appendChild(opt);
    });
  }
}

// In-browser image compression to avoid exceeding localStorage quota (usually ~5MB)
function handlePhotoUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const maxDimension = 800; // max width/height

  Array.from(files).forEach(file => {
    if (!file.type.match('image.*')) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        // Canvas compression routine
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Export as JPEG with 0.7 quality factor
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        
        state.uploadedPhotos.push(compressedBase64);
        renderPhotoPreviews();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  
  // Clear file input value to allow uploading same file
  event.target.value = '';
}

function renderPhotoPreviews() {
  const container = document.getElementById('form-photo-previews');
  container.innerHTML = '';

  if (state.uploadedPhotos.length === 0) {
    container.innerHTML = `
      <div class="col-span-3 flex flex-col justify-center items-center h-full text-slate-400 py-6 text-xs">
        <i data-lucide="image-off" class="w-5 h-5 mb-1 text-slate-300"></i>
        ไม่มีรูปภาพแนบ
      </div>
    `;
    lucide.createIcons();
    return;
  }

  state.uploadedPhotos.forEach((imgBase64, index) => {
    const thumb = document.createElement('div');
    thumb.className = "relative rounded border border-slate-200 aspect-square overflow-hidden bg-slate-100 group shadow-sm";
    thumb.innerHTML = `
      <img src="${imgBase64}" alt="Preview" class="w-full h-full object-cover">
      <button type="button" onclick="removeUploadedPhoto(${index})" class="absolute top-1 right-1 bg-rose-500 hover:bg-rose-600 text-white rounded-full p-0.5 shadow transition">
        <i data-lucide="x" class="w-3.5 h-3.5"></i>
      </button>
    `;
    container.appendChild(thumb);
  });

  lucide.createIcons();
}

function removeUploadedPhoto(index) {
  state.uploadedPhotos.splice(index, 1);
  renderPhotoPreviews();
}

// Form Submission (Add or Edit)
function handleFormSubmit(event) {
  event.preventDefault();
  
  const id = document.getElementById('form-ac-id').value;
  const name = document.getElementById('form-name').value.trim();
  const serialNumber = document.getElementById('form-serial').value.trim();
  let type = document.getElementById('form-type').value;
  if (type === 'อื่นๆ') {
    type = document.getElementById('form-custom-type').value.trim() || 'อื่นๆ';
  }
  let systemType = document.getElementById('form-system-type').value;
  if (systemType === 'อื่นๆ') {
    systemType = document.getElementById('form-custom-system-type').value.trim() || 'อื่นๆ';
  }
  const btu = document.getElementById('form-btu').value.trim();
  const brand = document.getElementById('form-brand').value.trim();
  const model = document.getElementById('form-model').value.trim();
  const installDate = document.getElementById('form-date').value;
  const status = document.getElementById('form-status').value;
  const locationId = document.getElementById('form-location').value;
  const buildingId = document.getElementById('form-building').value;
  const floorId = document.getElementById('form-floor').value;
  const room = document.getElementById('form-room').value.trim();
  const note = document.getElementById('form-note').value.trim();
  const updatedBy = document.getElementById('form-updated-by').value.trim() || 'ช่างประจำโครงการ';
  
  const x = parseFloat(document.getElementById('form-ac-x').value) || 50;
  const y = parseFloat(document.getElementById('form-ac-y').value) || 50;

  const acData = {
    name,
    serialNumber,
    type,
    systemType,
    btu,
    brand,
    model,
    installDate,
    status,
    locationId,
    buildingId,
    floorId,
    room,
    note,
    updatedBy,
    x,
    y,
    images: state.uploadedPhotos
  };

  try {
    if (id) {
      // Edit record
      window.acStore.updateAC(id, acData);
    } else {
      // Add record
      window.acStore.addAC(acData);
    }

    closeACModal();
    
    // Switch views/update states
    if (state.currentView === 'floorplan') {
      // Make sure our local state maps matches the saved location/floor
      state.selectedLocationId = locationId;
      state.selectedBuildingId = buildingId;
      state.selectedFloorId = floorId;
      renderFloorPlan();
    } else if (state.currentView === 'list') {
      renderACTable();
    } else {
      // Navigate to floor plan view
      state.selectedLocationId = locationId;
      state.selectedBuildingId = buildingId;
      state.selectedFloorId = floorId;
      switchView('floorplan');
    }

  } catch (err) {
    alert(err.message);
  }
}

// ==========================================
// 8. LIST VIEW TABLE RENDER
// ==========================================
let activeSortColumn = 'name';
let activeSortAsc = true;

function initTableFilters() {
  const locSelect = document.getElementById('table-filter-location');
  locSelect.innerHTML = '<option value="">ทุกสถานที่</option>';
  
  const locations = window.acStore.getLocations();
  locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = loc.name;
    locSelect.appendChild(opt);
  });

  document.getElementById('table-filter-building').innerHTML = '<option value="">ทุกอาคาร</option>';
  document.getElementById('table-filter-building').disabled = true;
}

function onTableFilterLocationChange() {
  const locId = document.getElementById('table-filter-location').value;
  const bldSelect = document.getElementById('table-filter-building');
  
  bldSelect.innerHTML = '<option value="">ทุกอาคาร</option>';
  
  if (!locId) {
    bldSelect.disabled = true;
    renderACTable();
    return;
  }

  bldSelect.disabled = false;
  const loc = window.acStore.getLocation(locId);
  if (loc) {
    loc.buildings.forEach(bld => {
      const opt = document.createElement('option');
      opt.value = bld.id;
      opt.textContent = bld.name;
      bldSelect.appendChild(opt);
    });
  }

  renderACTable();
}

function onTableFilterBuildingChange() {
  renderACTable();
}

function clearTableFilters() {
  document.getElementById('table-search-input').value = '';
  document.getElementById('table-filter-location').value = '';
  document.getElementById('table-filter-building').value = '';
  document.getElementById('table-filter-building').disabled = true;
  document.getElementById('table-filter-status').value = '';
  renderACTable();
}

function sortTable(columnName) {
  if (activeSortColumn === columnName) {
    activeSortAsc = !activeSortAsc;
  } else {
    activeSortColumn = columnName;
    activeSortAsc = true;
  }

  // Update headers sort icons
  ['name', 'type', 'status'].forEach(col => {
    const el = document.getElementById(`sort-icon-${col}`);
    if (el) el.innerHTML = '';
  });

  const arrow = activeSortAsc ? '↑' : '↓';
  document.getElementById(`sort-icon-${columnName}`).textContent = ` ${arrow}`;

  renderACTable();
}

function renderACTable() {
  const query = document.getElementById('table-search-input').value;
  const locationId = document.getElementById('table-filter-location').value;
  const buildingId = document.getElementById('table-filter-building').value;
  const statusFilter = document.getElementById('table-filter-status').value;

  const filters = {
    searchQuery: query,
    locationId
  };
  if (buildingId) filters.buildingId = buildingId;
  if (statusFilter) filters.status = [statusFilter];

  let list = window.acStore.getACs(filters);

  // Sorting
  list.sort((a, b) => {
    let valA = a[activeSortColumn] || '';
    let valB = b[activeSortColumn] || '';

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return activeSortAsc ? -1 : 1;
    if (valA > valB) return activeSortAsc ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('table-body');
  const emptyState = document.getElementById('table-empty-state');
  tbody.innerHTML = '';

  if (list.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  list.forEach(ac => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 transition";
    
    // Status badges Mapping
    let statusText = 'ปกติ';
    let badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (ac.status === 'check') {
      statusText = 'ต้องตรวจสอบ';
      badgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
    } else if (ac.status === 'repair') {
      statusText = 'ต้องซ่อม';
      badgeClass = 'bg-orange-50 text-orange-700 border-orange-200';
    } else if (ac.status === 'broken') {
      statusText = 'ชำรุด';
      badgeClass = 'bg-rose-50 text-rose-700 border-rose-200';
    } else if (ac.status === 'inactive') {
      statusText = 'ไม่ใช้งาน';
      badgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
    }

    const loc = window.acStore.getLocation(ac.locationId);
    const bld = window.acStore.getBuilding(ac.locationId, ac.buildingId);
    const flr = window.acStore.getFloor(ac.locationId, ac.buildingId, ac.floorId);

    // Photo preview icon
    const photoIcon = ac.images && ac.images.length > 0
      ? `<div class="relative w-8 h-8 rounded border border-slate-200 overflow-hidden mx-auto bg-slate-100"><img src="${ac.images[0]}" class="w-full h-full object-cover"></div>`
      : `<i data-lucide="image-off" class="w-4 h-4 mx-auto text-slate-300"></i>`;

    tr.innerHTML = `
      <td class="px-6 py-4 font-bold text-slate-900">${ac.name}</td>
      <td class="px-6 py-4 text-xs text-slate-500">
        <div><strong>${loc?.name || '-'}</strong></div>
        <div>${bld?.name || '-'} > ${flr?.name || '-'}</div>
        <div class="italic text-slate-400 mt-0.5">${ac.room || 'ไม่ระบุห้อง'}</div>
      </td>
      <td class="px-6 py-4 font-semibold text-slate-700">
        <div>${ac.type}</div>
        <div class="text-[10px] text-slate-400 font-medium">${ac.systemType || 'ระบบน้ำยา'}</div>
      </td>
      <td class="px-6 py-4 text-slate-600">${ac.btu || '-'}</td>
      <td class="px-6 py-4 text-xs">
        <div><strong>ยี่ห้อ:</strong> ${ac.brand || '-'}</div>
        <div><strong>รุ่น:</strong> ${ac.model || '-'}</div>
      </td>
      <td class="px-6 py-4 font-mono text-xs text-slate-500">${ac.serialNumber || '-'}</td>
      <td class="px-6 py-4">
        <span class="px-2 py-1 rounded-full text-xs font-bold border ${badgeClass} inline-block">
          ${statusText}
        </span>
      </td>
      <td class="px-6 py-4 text-center">${photoIcon}</td>
      <td class="px-6 py-4 text-right text-xs font-bold space-x-1 whitespace-nowrap">
        <button onclick="locateAC('${ac.id}', '${ac.locationId}', '${ac.buildingId}', '${ac.floorId}')" class="px-2.5 py-1.5 bg-brand-800 hover:bg-slate-700 text-white rounded transition shadow-sm">ดูแผนผัง</button>
        <button onclick="openAddACModal(null, null, '${ac.id}')" class="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition">แก้ไข</button>
        <button onclick="confirmDeleteAC('${ac.id}', '${ac.name}')" class="px-2.5 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded transition">ลบ</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  lucide.createIcons();
}

function confirmDeleteAC(id, name) {
  if (confirm(`คุณแน่ใจว่าต้องการลบข้อมูลเครื่องปรับอากาศหมายเลข ${name} หรือไม่?`)) {
    window.acStore.deleteAC(id);
    renderACTable();
  }
}

// Global reset local storage settings
function confirmResetStore() {
  if (confirm('คำเตือน: คุณต้องการรีเซ็ตข้อมูลทั้งหมดกลับเป็นค่าเริ่มต้น (Demo) หรือไม่? ข้อมูลที่คุณมาร์คเพิ่มเติมและรูปภาพที่อัปโหลดจะถูกลบทั้งหมด')) {
    window.acStore.resetData();
    switchView('dashboard');
  }
}

// ==========================================
// 9. STRING FORMATTING HELPERS
// ==========================================
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) return '';
  try {
    const d = new Date(dateTimeStr);
    if (isNaN(d.getTime())) return dateTimeStr;
    const datePart = d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timePart = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart} น.`;
  } catch (e) {
    return dateTimeStr;
  }
}

// Toggle custom air conditioner type text input visibility
function toggleCustomTypeField() {
  const typeSelect = document.getElementById('form-type');
  const container = document.getElementById('form-custom-type-container');
  const customInput = document.getElementById('form-custom-type');

  if (typeSelect.value === 'อื่นๆ') {
    container.classList.remove('hidden');
    customInput.required = true;
    customInput.focus();
  } else {
    container.classList.add('hidden');
    customInput.required = false;
    customInput.value = '';
  }
}

// Toggle custom system type text input visibility
function toggleCustomSystemTypeField() {
  const systemTypeSelect = document.getElementById('form-system-type');
  const container = document.getElementById('form-custom-system-type-container');
  const customInput = document.getElementById('form-custom-system-type');

  if (systemTypeSelect.value === 'อื่นๆ') {
    container.classList.remove('hidden');
    customInput.required = true;
    customInput.focus();
  } else {
    container.classList.add('hidden');
    customInput.required = false;
    customInput.value = '';
  }
}

// Prompt to add a new floor in the selected building
function promptAddNewFloor() {
  const floorName = prompt("กรุณาระบุชื่อชั้นใหม่ที่ต้องการเพิ่ม (เช่น ชั้น 6, ชั้นใต้ดิน B1):");
  if (!floorName || !floorName.trim()) return;

  try {
    const newFloor = window.acStore.addFloor(
      state.selectedLocationId,
      state.selectedBuildingId,
      floorName
    );

    if (newFloor) {
      // Reload floor selection view
      renderFloorSelection();
      
      // Auto-navigate to the new floor plan
      state.selectedFloorId = newFloor.id;
      switchView('floorplan');
    }
  } catch (err) {
    alert(err.message);
  }
}

// Helper to generate a clean abbreviation for floor names (e.g. "ชั้น 1" -> "F1", "ดาดฟ้า" -> "RF", "ใต้ดิน B1" -> "B1")
function getFloorAbbreviation(floorName) {
  const name = floorName.trim().toLowerCase();
  
  if (name.includes('ดาดฟ้า') || name.includes('roof')) {
    return 'RF';
  }
  
  if (name.includes('ใต้ดิน') || name.includes('basement') || name.startsWith('b')) {
    const digits = name.replace(/\D/g, '');
    return digits ? `B${digits}` : 'B';
  }

  const digits = floorName.replace(/\D/g, '');
  if (digits) {
    return `F${digits}`;
  }

  // If no numbers, take first 2 letters
  return floorName.substring(0, 2).toUpperCase();
}

// Prompt to add a new building to a location
function promptAddNewBuilding(locationId) {
  const buildingName = prompt("กรุณาระบุชื่ออาคารใหม่ที่ต้องการเพิ่ม (เช่น อาคาร C, อาคารจอดรถ):");
  if (!buildingName || !buildingName.trim()) return;

  try {
    const newBld = window.acStore.addBuilding(locationId, buildingName);
    if (newBld) {
      renderLocationSelection();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Prompt to rename an existing building
function promptRenameBuilding(locationId, buildingId) {
  const bld = window.acStore.getBuilding(locationId, buildingId);
  if (!bld) return;

  const newName = prompt(`กรุณาระบุชื่อใหม่สำหรับ "${bld.name}":`, bld.name);
  if (!newName || !newName.trim() || newName.trim() === bld.name) return;

  try {
    const success = window.acStore.renameBuilding(locationId, buildingId, newName);
    if (success) {
      renderLocationSelection();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Confirm and delete a building
function confirmDeleteBuilding(locationId, buildingId) {
  const bld = window.acStore.getBuilding(locationId, buildingId);
  if (!bld) return;

  const confirmation = confirm(`⚠️ คุณแน่ใจหรือไม่ที่จะลบ "${bld.name}"?\n\nการลบนี้จะลบข้อมูลชั้น แปลนอาคาร และจุดมาร์คแอร์ทั้งหมดในอาคารนี้อย่างถาวรและไม่สามารถเรียกคืนได้!`);
  if (!confirmation) return;

  try {
    const success = window.acStore.deleteBuilding(locationId, buildingId);
    if (success) {
      renderLocationSelection();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Populate the dashboard hospital/location selection dropdown
function populateDashboardLocationDropdown() {
  const dropdown = document.getElementById('dashboard-location-dropdown');
  if (!dropdown) return;

  // Save current selection
  const currentValue = dropdown.value;

  // Clear except first option
  dropdown.innerHTML = '<option value="">ทุกสถานที่ (รวมทั้งหมด)</option>';

  const locations = window.acStore.getLocations();
  locations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = loc.name;
    dropdown.appendChild(opt);
  });

  // Restore previous selection if still available
  const exists = Array.from(dropdown.options).some(opt => opt.value === currentValue);
  if (exists) {
    dropdown.value = currentValue;
  }
}

// Callback when the dashboard location dropdown value changes
function onDashboardLocationDropdownChange() {
  renderDashboard();
}

// Prompt to add a new hospital/location
function promptAddNewLocation() {
  const locationName = prompt("กรุณาระบุชื่อโรงพยาบาล/สถานที่ใหม่ที่ต้องการเพิ่ม (เช่น โรงพยาบาลวิภาวดี, อาคารสำนักงานใหญ่):");
  if (!locationName || !locationName.trim()) return;

  try {
    const newLoc = window.acStore.addLocation(locationName);
    if (newLoc) {
      // Re-populate dashboard dropdown to include the new location
      populateDashboardLocationDropdown();

      // Automatically select the new location
      const dropdown = document.getElementById('dashboard-location-dropdown');
      if (dropdown) {
        dropdown.value = newLoc.id;
      }
      
      // Update views and stats
      renderDashboard();
      
      // Keep dropdown options in forms and filters synchronized
      populateFormDropdowns();
      initTableFilters();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Toggle map sidebar open/close state
function toggleMapSidebar() {
  const sidebar = document.getElementById('map-sidebar');
  const openBtn = document.getElementById('btn-open-sidebar');
  if (!sidebar) return;

  sidebar.classList.toggle('collapsed-sidebar');

  // Toggle floating open button visibility
  if (openBtn) {
    if (sidebar.classList.contains('collapsed-sidebar')) {
      openBtn.classList.remove('hidden');
    } else {
      openBtn.classList.add('hidden');
    }
  }

  // Trigger PanZoom scale fit calculations since viewport size has changed
  if (panZoomInstance) {
    setTimeout(() => {
      panZoomInstance.zoomToFit();
    }, 150); // Small delay to wait for CSS reflow to finish
  }
}

// Prompt to rename a location/hospital
function promptRenameLocation(locationId) {
  const loc = window.acStore.getLocation(locationId);
  if (!loc) return;

  const newName = prompt(`กรุณาระบุชื่อสถานที่/โรงพยาบาลใหม่สำหรับ "${loc.name}":`, loc.name);
  if (!newName || !newName.trim() || newName.trim() === loc.name) return;

  try {
    const success = window.acStore.renameLocation(locationId, newName);
    if (success) {
      // Re-populate dashboard dropdown to include updated name
      populateDashboardLocationDropdown();
      
      // Update views and stats
      renderDashboard();
      renderLocationSelection();
      
      // Keep dropdown options in forms and filters synchronized
      populateFormDropdowns();
      initTableFilters();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Confirm and delete a location/hospital
function confirmDeleteLocation(locationId) {
  const loc = window.acStore.getLocation(locationId);
  if (!loc) return;

  const confirmation = confirm(`⚠️ คุณแน่ใจหรือไม่ที่จะลบสถานที่ "${loc.name}"?\n\nการลบนี้จะลบอาคาร ชั้น แบบแปลน และจุดมาร์คแอร์ทั้งหมดในสถานที่นี้อย่างถาวรและไม่สามารถเรียกคืนได้!`);
  if (!confirmation) return;

  try {
    const success = window.acStore.deleteLocation(locationId);
    if (success) {
      // Re-populate dashboard dropdown to remove deleted location
      populateDashboardLocationDropdown();
      
      // Update views and stats
      renderDashboard();
      renderLocationSelection();
      
      // Keep dropdown options in forms and filters synchronized
      populateFormDropdowns();
      initTableFilters();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Prompt to rename a floor
function promptRenameFloor(locationId, buildingId, floorId) {
  const flr = window.acStore.getFloor(locationId, buildingId, floorId);
  if (!flr) return;

  const newName = prompt(`กรุณาระบุชื่อชั้นใหม่สำหรับ "${flr.name}":`, flr.name);
  if (!newName || !newName.trim() || newName.trim() === flr.name) return;

  try {
    const success = window.acStore.renameFloor(locationId, buildingId, floorId, newName);
    if (success) {
      renderFloorSelection();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Confirm and delete a floor
function confirmDeleteFloor(locationId, buildingId, floorId) {
  const flr = window.acStore.getFloor(locationId, buildingId, floorId);
  if (!flr) return;

  const confirmation = confirm(`⚠️ คุณแน่ใจหรือไม่ที่จะลบ "${flr.name}"?\n\nการลบนี้จะลบไฟล์แปลนอาคารและจุดมาร์คแอร์ทั้งหมดในชั้นนี้อย่างถาวรและไม่สามารถเรียกคืนได้!`);
  if (!confirmation) return;

  try {
    const success = window.acStore.deleteFloor(locationId, buildingId, floorId);
    if (success) {
      renderFloorSelection();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Render Maintenance History List in drawer
function renderMaintenanceHistory(ac) {
  const listContainer = document.getElementById('detail-maintenance-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const history = ac.maintenanceHistory || [
    {
      date: ac.updatedAt ? ac.updatedAt.split('T')[0] : (ac.installDate || 'ไม่ระบุ'),
      note: ac.note || 'ติดตั้งเครื่องใหม่เข้าระบบ',
      technician: ac.updatedBy || 'ช่างประจำโครงการ',
      status: ac.status
    }
  ];

  history.forEach(log => {
    const item = document.createElement('div');
    item.className = "p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs flex flex-col gap-1.5 shadow-sm";
    
    let statusText = 'ใช้งานปกติ';
    let statusClass = 'bg-emerald-100 text-emerald-800';
    if (log.status === 'check') { statusText = 'ต้องตรวจสอบ'; statusClass = 'bg-amber-100 text-amber-800'; }
    if (log.status === 'repair') { statusText = 'ต้องซ่อม / รอซ่อม'; statusClass = 'bg-orange-100 text-orange-800'; }
    if (log.status === 'broken') { statusText = 'ชำรุด'; statusClass = 'bg-rose-100 text-rose-800'; }
    if (log.status === 'inactive') { statusText = 'ไม่ได้ใช้งาน'; statusClass = 'bg-slate-200 text-slate-700'; }

    item.innerHTML = `
      <div class="flex items-center justify-between font-bold text-slate-500">
        <span class="flex items-center gap-1"><i data-lucide="calendar" class="w-3.5 h-3.5"></i> ${formatDate(log.date)}</span>
        <span class="px-2 py-0.5 rounded-full text-[9px] ${statusClass}">${statusText}</span>
      </div>
      <div class="text-slate-800 font-medium bg-white p-2 rounded border border-slate-100">${log.note}</div>
      <div class="text-[10px] text-slate-400 flex items-center gap-1 justify-end">
        <i data-lucide="user" class="w-3 h-3"></i> ดำเนินงานโดย: <span class="font-bold text-slate-500">${log.technician}</span>
      </div>
    `;
    listContainer.appendChild(item);
  });
  
  // Reset input fields
  document.getElementById('maintenance-new-note').value = '';
  document.getElementById('maintenance-new-status').value = ac.status;
  document.getElementById('maintenance-new-technician').value = 'ช่างสมชาย มั่นคง';

  lucide.createIcons();
}

// Add a new maintenance log to the active AC record
function addNewMaintenanceLog() {
  const acId = state.selectedACId;
  if (!acId) return;

  const note = document.getElementById('maintenance-new-note').value;
  const status = document.getElementById('maintenance-new-status').value;
  const technician = document.getElementById('maintenance-new-technician').value;

  if (!note || !note.trim()) {
    alert("กรุณากรอกรายละเอียดประวัติการซ่อมบำรุง");
    return;
  }

  if (!technician || !technician.trim()) {
    alert("กรุณาระบุชื่อช่างผู้ดำเนินงาน");
    return;
  }

  try {
    const updatedAC = window.acStore.addMaintenanceLog(acId, {
      note: note,
      status: status,
      technician: technician
    });

    if (updatedAC) {
      // Re-populate details and log lists
      openSideDrawer(acId);

      // Re-render live map and list counters
      renderMarkers();
      renderSidebarACList();
      renderDashboard();
    }
  } catch (err) {
    alert(err.message);
  }
}

// Open dynamic QR code modal
function openACQRSticker() {
  const acId = state.selectedACId;
  if (!acId) return;
  const ac = window.acStore.getACById(acId);
  if (!ac) return;

  const modal = document.getElementById('qr-modal');
  if (!modal) return;

  document.getElementById('qr-sticker-ac-name').textContent = ac.name;
  
  // Build URL with query parameter so scanning directs directly to details view
  const scanUrl = window.location.origin + window.location.pathname + '?acId=' + ac.id;
  document.getElementById('qr-sticker-url').textContent = scanUrl;

  const qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(scanUrl);
  const qrImageEl = document.getElementById('qr-sticker-image');
  if (qrImageEl) {
    qrImageEl.src = qrImageUrl;
  }

  modal.classList.remove('hidden');
  lucide.createIcons();
}

// Close QR code modal
function closeQRModal() {
  const modal = document.getElementById('qr-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Print sticker sheet in a new pop-up window
function printSticker() {
  const stickerContent = document.getElementById('qr-sticker-card').innerHTML;
  const acName = document.getElementById('qr-sticker-ac-name').textContent;
  
  const printWindow = window.open('', '_blank', 'width=600,height=600');
  
  const html = '<html><head><title>TECHNICAL WATER - QR Code ' + acName + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;900&display=swap" rel="stylesheet">' +
    '<script src="https://cdn.tailwindcss.com"></script>' +
    '<style>body{font-family:\'Sarabun\',sans-serif;margin:0;padding:20px;display:flex;justify-content:center;align-items:center;height:100vh;}@media print{body{padding:0;margin:0;}}</style>' +
    '</head><body>' +
    '<div class="border-2 border-slate-800 rounded-xl p-5 bg-white flex flex-col items-center text-center max-w-sm">' +
    stickerContent +
    '</div>' +
    '<script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);};</script>' +
    '</body></html>';
    
  printWindow.document.write(html);
  printWindow.document.close();
}
