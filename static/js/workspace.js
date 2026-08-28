// static/js/workspace.js

const state = {
  locationId: WORKSPACE_META.locationId,
  buildingId: WORKSPACE_META.buildingId,
  floorId: WORKSPACE_META.floorId,
  highlightAcId: WORKSPACE_META.highlightAcId,
  selectedACId: null,
  isAddMarkerMode: false,
  acs: []
};

let panZoomInstance = null;

// Initialize Workspace on Page Load
window.addEventListener('DOMContentLoaded', async () => {
  // Config PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  }

  // Fetch initial AC data and render
  await fetchAndRenderWorkspace();

  // Handle cached image load race condition
  const img = document.getElementById('floorplan-image');
  if (img && img.complete) {
    onFloorPlanImageLoaded();
  }

  // Configure escape listener to close modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeACModal();
      closeSideDrawer();
      closeQRModal();
      closeImagePreviewModal();
    }
  });
});

// Fetch all air conditioners for this floor and render markers + sidebar lists
async function fetchAndRenderWorkspace() {
  try {
    if (window.initialAcs && window.initialAcs.length > 0) {
      state.acs = window.initialAcs;
      window.initialAcs = null; // Clear to allow subsequent refreshes to fetch fresh data
    } else {
      const res = await fetch(`/api/v1/acs?locationId=${state.locationId}&buildingId=${state.buildingId}&floorId=${state.floorId}`);
      state.acs = await res.json();
    }
    
    renderMarkers();
    renderSidebarACList();
    
    // Check highlight parameter (like QR scan or search click redirection)
    if (state.highlightAcId) {
      const acId = state.highlightAcId;
      state.highlightAcId = null; // Clear to avoid loops
      setTimeout(() => {
        highlightMarkerOnMap(acId);
        openSideDrawer(acId);
      }, 500);
    }
  } catch (e) {
    console.error(e);
    alert("ดึงข้อมูลเครื่องปรับอากาศล้มเหลว");
  }
}

// Fit blueprint image to container viewport
function onFloorPlanImageLoaded() {
  const container = document.getElementById('panzoom-viewport');
  const content = document.getElementById('panzoom-content');
  if (!container || !content) return;

  if (!panZoomInstance) {
    panZoomInstance = new PanZoom(container, content, {
      onClick: (x, y) => {
        if (state.isAddMarkerMode) {
          openAddACModal(x, y);
        }
      }
    });
  }

  setTimeout(() => {
    panZoomInstance.zoomToFit();
  }, 100);
}

// Side drawer toggles
function toggleMapSidebar() {
  const sidebar = document.getElementById('map-sidebar');
  const btnOpen = document.getElementById('btn-open-sidebar');
  if (!sidebar) return;

  const isCollapsed = sidebar.classList.contains('hidden');
  if (isCollapsed) {
    sidebar.classList.remove('hidden');
    sidebar.classList.add('flex');
    // On mobile, overlay the sidebar absolutely
    if (window.innerWidth < 1024) {
      sidebar.classList.add('absolute', 'inset-y-0', 'left-0', 'z-30', 'shadow-xl');
    }
    if (btnOpen) {
      btnOpen.classList.add('hidden', 'lg:hidden');
    }
  } else {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('flex', 'lg:flex', 'absolute', 'inset-y-0', 'left-0', 'z-30', 'shadow-xl');
    if (btnOpen) {
      btnOpen.classList.remove('hidden', 'lg:hidden');
    }
  }
  
  if (panZoomInstance) {
    setTimeout(() => {
      panZoomInstance.zoomToFit();
    }, 150);
  }
}

// Left Sidebar Equipment List
function renderSidebarACList() {
  const container = document.getElementById('sidebar-ac-list');
  const counter = document.getElementById('sidebar-ac-count');
  if (!container) return;

  const checkedFilters = Array.from(document.querySelectorAll('.status-filter:checked')).map(el => el.value);
  const filteredAcs = state.acs.filter(ac => {
    return checkedFilters.length === 0 || checkedFilters.includes(ac.status);
  });

  counter.textContent = `${filteredAcs.length} เครื่อง`;
  container.innerHTML = '';

  if (filteredAcs.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400 text-xs">
        <i data-lucide="info" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
        <span>ไม่พบรายการแอร์ตามสถานะที่กรอง</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  filteredAcs.forEach(ac => {
    const item = document.createElement('div');
    item.className = "flex items-center justify-between p-3.5 hover:bg-slate-50 cursor-pointer transition select-none text-xs border-l-4 " + 
      (ac.status === 'normal' ? 'border-emerald-500' :
       ac.status === 'check' ? 'border-amber-500' :
       ac.status === 'repair' ? 'border-red-500' :
       ac.status === 'broken' ? 'border-[#8b4513]' : 'border-slate-400');
       
    item.onclick = () => {
      highlightMarkerOnMap(ac.id);
      openSideDrawer(ac.id);
    };

    item.innerHTML = `
      <div class="text-xs">
        <div class="font-bold text-slate-800">${ac.name}</div>
        <div class="text-slate-500 truncate max-w-[150px]">${ac.room || 'ไม่ระบุห้อง'}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${ac.brand || '-'} | ${ac.btu || '-'} BTU</div>
      </div>
      <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400"></i>
    `;
    container.appendChild(item);
  });

  lucide.createIcons();
}

// Marker Dragging coordinates updates
async function onMarkerDragEnd(acId, x, y) {
  try {
    const res = await fetch(`/api/v1/acs/${acId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y })
    });
    if (res.ok) {
      // Sync local state
      const ac = state.acs.find(a => a.id === acId);
      if (ac) {
        ac.x = x;
        ac.y = y;
      }
    } else {
      alert("ไม่สามารถบันทึกตำแหน่งใหม่ได้");
      fetchAndRenderWorkspace(); // Re-render initial
    }
  } catch (e) {
    alert("เชื่อมต่อเซิร์ฟเวอร์ผิดพลาด");
    fetchAndRenderWorkspace();
  }
}

// Marker Render Loop
function renderMarkers() {
  const container = document.getElementById('markers-overlay');
  if (!container) return;
  container.innerHTML = '';

  const checkedFilters = Array.from(document.querySelectorAll('.status-filter:checked')).map(el => el.value);

  state.acs.forEach(ac => {
    if (checkedFilters.length > 0 && !checkedFilters.includes(ac.status)) {
      return;
    }

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
      
      <!-- Popover Tooltip -->
      <div class="ac-tooltip no-pan">
        <div class="text-xs font-bold text-slate-900 mb-1 border-b border-slate-100 pb-1">${ac.name}</div>
        <table class="text-[10px] text-slate-600 w-full mb-2">
          <tr>
            <td class="font-semibold py-0.5">ยี่ห้อ:</td>
            <td>${ac.brand || '-'}</td>
          </tr>
          <tr>
            <td class="font-semibold py-0.5">ขนาด:</td>
            <td>${ac.btu || '-'} BTU</td>
          </tr>
          <tr>
            <td class="font-semibold py-0.5">ห้อง:</td>
            <td class="truncate max-w-[100px]">${ac.room || 'ไม่ระบุ'}</td>
          </tr>
        </table>
        <button onclick="openSideDrawer('${ac.id}'); event.stopPropagation();" class="w-full bg-brand-800 text-white rounded text-[10px] py-1 font-bold hover:bg-slate-700 transition text-center block">
          ดูข้อมูล / ซ่อมบำรุง
        </button>
      </div>
    `;

    container.appendChild(marker);

    // Click on marker circle directly opens side drawer
    const circle = marker.querySelector('.marker-circle');
    if (circle) {
      circle.style.cursor = 'pointer';
      circle.addEventListener('click', (e) => {
        e.stopPropagation();
        openSideDrawer(ac.id);
      });
    }
    
    // Configure dragging on this marker
    if (panZoomInstance) {
      panZoomInstance.makeMarkerDraggable(marker, (finalX, finalY) => {
        onMarkerDragEnd(ac.id, finalX, finalY);
      });
    }
  });

  lucide.createIcons();
}

// Highlights and zooms into a marker
function highlightMarkerOnMap(acId) {
  const ac = state.acs.find(a => a.id === acId);
  if (!ac || !panZoomInstance) return;

  const viewportRect = document.getElementById('panzoom-viewport').getBoundingClientRect();
  const imgEl = document.getElementById('floorplan-image');
  
  const width = imgEl.offsetWidth || imgEl.clientWidth || 800;
  const height = imgEl.offsetHeight || imgEl.clientHeight || 650;

  const targetX = (ac.x / 100) * width;
  const targetY = (ac.y / 100) * height;

  const zoomScale = 1.6;
  panZoomInstance.state.scale = zoomScale;
  panZoomInstance.state.x = (viewportRect.width / 2) - (targetX * zoomScale);
  panZoomInstance.state.y = (viewportRect.height / 2) - (targetY * zoomScale);
  panZoomInstance.updateTransform();

  const marker = document.getElementById(`marker-${acId}`);
  if (marker) {
    marker.classList.add('dragging');
    setTimeout(() => marker.classList.remove('dragging'), 1500);
  }
}

// Add Marker mode handler
function toggleAddMarkerMode(forceState) {
  state.isAddMarkerMode = typeof forceState === 'boolean' ? forceState : !state.isAddMarkerMode;
  
  const banner = document.getElementById('drag-instruction');
  const btn = document.getElementById('btn-toggle-add-mode');
  const viewport = document.getElementById('panzoom-viewport');

  if (state.isAddMarkerMode) {
    banner.classList.remove('hidden');
    btn.innerHTML = `<i data-lucide="x" class="w-4 h-4"></i> ยกเลิกการปักหมุด`;
    btn.className = "px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow transition";
    viewport.style.cursor = 'crosshair';
  } else {
    banner.classList.add('hidden');
    btn.innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4"></i> เพิ่มแอร์ลงแปลน`;
    btn.className = "px-3 py-2 bg-brand-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow transition";
    viewport.style.cursor = 'grab';
  }
  lucide.createIcons();
}

// ==========================================
// DETAILS SIDE DRAWER CONTROLS
// ==========================================
async function openSideDrawer(acId) {
  state.selectedACId = acId;
  
  try {
    const res = await fetch(`/api/v1/acs/${acId}`);
    if (!res.ok) return;
    const ac = await res.json();

    const drawer = document.getElementById('side-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const panel = document.getElementById('drawer-panel');

    drawer.classList.remove('hidden');
    setTimeout(() => {
      backdrop.classList.remove('opacity-0');
      backdrop.classList.add('opacity-100');
      panel.classList.remove('translate-x-full');
      panel.classList.add('translate-x-0');
    }, 10);

    // Populate metadata
    document.getElementById('detail-ac-name').textContent = ac.name;
    document.getElementById('detail-brand-model').textContent = `${ac.brand || '-'} / ${ac.model || '-'}`;
    document.getElementById('detail-type').textContent = ac.type;
    document.getElementById('detail-system-type').textContent = ac.systemType || 'ระบบน้ำยา';
    document.getElementById('detail-btu').textContent = ac.btu ? `${ac.btu} BTU` : '-';
    document.getElementById('detail-serial').textContent = ac.serialNumber || '-';
    document.getElementById('detail-install-date').textContent = ac.installDate ? formatDate(ac.installDate) : '-';
    document.getElementById('detail-note').textContent = ac.note || 'ไม่มีข้อมูลบันทึกหมายเหตุ';
    document.getElementById('detail-updated-by').textContent = ac.updatedBy || 'ช่างประจำโครงการ';
    document.getElementById('detail-updated-at').textContent = ac.updatedAt ? formatDateTime(ac.updatedAt) : '-';
    document.getElementById('detail-room').textContent = `${ac.room || '-'} (X: ${ac.x.toFixed(1)}%, Y: ${ac.y.toFixed(1)}%)`;

    // Locations details
    document.getElementById('detail-location').textContent = WORKSPACE_META.locationName || '-';
    document.getElementById('detail-building-floor').textContent = `${WORKSPACE_META.buildingName || '-'} / ${WORKSPACE_META.floorName || '-'}`;

    // Status styling
    const pill = document.getElementById('detail-status-pill');
    const label = document.getElementById('detail-status-text');
    pill.className = "w-4 h-4 rounded-full " + 
      (ac.status === 'normal' ? 'bg-emerald-500' :
       ac.status === 'check' ? 'bg-amber-500' :
       ac.status === 'repair' ? 'bg-red-500' :
       ac.status === 'broken' ? 'bg-[#8b4513]' : 'bg-slate-400');
       
    label.textContent = 
      ac.status === 'normal' ? 'ใช้งานปกติ' :
      ac.status === 'check' ? 'ต้องตรวจสอบ' :
      ac.status === 'repair' ? 'ต้องซ่อม / รอซ่อม' :
      ac.status === 'broken' ? 'ชำรุด' : 'ไม่ได้ใช้งาน';
    label.className = "text-sm font-bold " + 
      (ac.status === 'normal' ? 'text-emerald-600' :
       ac.status === 'check' ? 'text-amber-500' :
       ac.status === 'repair' ? 'text-red-500' :
       ac.status === 'broken' ? 'text-[#8b4513]' : 'text-slate-500');

    // Populate photos
    const gallery = document.getElementById('detail-images-container');
    gallery.innerHTML = '';
    
    if (ac.images && ac.images.length > 0) {
      ac.images.forEach(imgBase64 => {
        const div = document.createElement('div');
        div.className = "relative rounded-lg overflow-hidden border border-slate-200 aspect-[4/3] bg-slate-100 group shadow-sm";
        
        const img = document.createElement('img');
        img.src = imgBase64;
        img.alt = "AC Real Photo";
        img.className = "w-full h-full object-cover cursor-pointer";
        img.addEventListener('click', () => openImagePreview(imgBase64));

        const overlay = document.createElement('div');
        overlay.className = "absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition text-xs font-semibold gap-1 cursor-pointer";
        overlay.innerHTML = `<i data-lucide="eye" class="w-4 h-4"></i> ดูรูปใหญ่`;
        overlay.addEventListener('click', () => openImagePreview(imgBase64));

        div.appendChild(img);
        div.appendChild(overlay);
        gallery.appendChild(div);
      });
    } else {
      gallery.innerHTML = `
        <div class="col-span-full border border-slate-200 rounded-lg p-6 bg-slate-50 text-slate-400 text-center text-xs">
          <i data-lucide="image-off" class="w-8 h-8 mx-auto text-slate-300 mb-2"></i>
          <span>ไม่มีรูปถ่ายเครื่องปรับอากาศของจริงแนบไว้</span>
        </div>
      `;
    }

    // Populate history logs list
    renderMaintenanceHistoryList(ac);
    lucide.createIcons();
  } catch (e) {
    console.error(e);
  }
}

function closeSideDrawer() {
  const backdrop = document.getElementById('drawer-backdrop');
  const panel = document.getElementById('drawer-panel');
  const drawer = document.getElementById('side-drawer');

  if (backdrop && panel) {
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
    panel.classList.remove('translate-x-0');
    panel.classList.add('translate-x-full');
    setTimeout(() => {
      drawer.classList.add('hidden');
    }, 300);
  }
}

// HTML escaping helper
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;");
}

// Render historical maintenance log list in drawer
function renderMaintenanceHistoryList(ac) {
  const list = document.getElementById('detail-maintenance-list');
  if (!list) return;
  list.innerHTML = '';

  // Limit sidebar to last 3 entries, reversed (newest first)
  const recentLogs = [...ac.maintenanceHistory].slice(-3).reverse();

  recentLogs.forEach(log => {
    const item = document.createElement('div');
    item.className = "p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs flex flex-col gap-1.5 shadow-sm";

    let label = 'ใช้งานปกติ';
    let labelClass = 'bg-emerald-100 text-emerald-800';
    if (log.status === 'check') { label = 'ต้องตรวจสอบ'; labelClass = 'bg-amber-100 text-amber-800'; }
    if (log.status === 'repair') { label = 'ต้องซ่อม'; labelClass = 'bg-red-100 text-red-800'; }
    if (log.status === 'broken') { label = 'ชำรุด'; labelClass = 'bg-[#f5e6d3] text-[#8b4513]'; }
    if (log.status === 'inactive') { label = 'ไม่ได้ใช้งาน'; labelClass = 'bg-slate-200 text-slate-700'; }

    item.innerHTML = `
      <div class="flex items-center justify-between font-bold text-slate-500">
        <span class="flex items-center gap-1"><i data-lucide="calendar" class="w-3.5 h-3.5"></i> ${formatDateTime(log.date)}</span>
        <div class="flex items-center gap-1.5">
          <span class="px-2 py-0.5 rounded-full text-[9px] ${labelClass}">${label}</span>
          <button onclick="startEditMaintenanceLog('${ac.id}', ${log.id}, \`${escapeHtml(log.note)}\`, '${log.status}', \`${escapeHtml(log.technician)}\`)" class="text-slate-400 hover:text-brand-500 transition p-0.5" title="แก้ไขประวัติ">
            <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
          </button>
          <button onclick="deleteMaintenanceLog('${ac.id}', ${log.id})" class="text-slate-400 hover:text-rose-500 transition p-0.5" title="ลบประวัติ">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
      <div class="text-slate-800 font-medium bg-white p-2 rounded border border-slate-100 whitespace-pre-wrap">${log.note}</div>
      <div class="text-[10px] text-slate-400 flex items-center gap-1 justify-end">
        <i data-lucide="user" class="w-3 h-3"></i> ดำเนินงานโดย: <span class="font-bold text-slate-500">${log.technician}</span>
      </div>
    `;
    list.appendChild(item);
  });

  // Update view full history button
  const viewAllBtn = document.getElementById('view-all-history-btn');
  if (viewAllBtn) {
    if (ac.maintenanceHistory.length > 0) {
      viewAllBtn.style.display = 'flex';
      viewAllBtn.innerHTML = `<i data-lucide="folder-open" class="w-4 h-4"></i> ดูประวัติทั้งหมด (${ac.maintenanceHistory.length} รายการ)`;
    } else {
      viewAllBtn.style.display = 'none';
    }
  }

  // Update history modal dynamically if it is open
  if (state.historyAC && state.historyAC.id === ac.id) {
    state.historyAC = ac;
    renderHistoryModalList();
  }

  // Reset inputs
  cancelEditMaintenance();
}

function startEditMaintenanceLog(acId, logId, note, status, technician) {
  document.getElementById('maintenance-form-title').textContent = "แก้ไขประวัติการบำรุงรักษา";
  document.getElementById('maintenance-new-note').value = note;
  document.getElementById('maintenance-new-status').value = status;
  document.getElementById('maintenance-new-technician').value = technician;
  document.getElementById('maintenance-editing-log-id').value = logId;
  
  // Show cancel button
  document.getElementById('btn-cancel-edit-maintenance').classList.remove('hidden');
  
  // Update submit button text and icon
  document.getElementById('btn-submit-maintenance-text').textContent = "บันทึกการแก้ไข";
  const icon = document.getElementById('btn-submit-maintenance-icon');
  if (icon) {
    icon.setAttribute('data-lucide', 'save');
  }
  lucide.createIcons();
}

function cancelEditMaintenance() {
  document.getElementById('maintenance-form-title').textContent = "บันทึกประวัติการบำรุงรักษาเพิ่ม";
  document.getElementById('maintenance-new-note').value = '';
  document.getElementById('maintenance-editing-log-id').value = '';
  
  // Hide cancel button
  document.getElementById('btn-cancel-edit-maintenance').classList.add('hidden');
  
  // Restore submit button text and icon
  document.getElementById('btn-submit-maintenance-text').textContent = "บันทึกประวัติซ่อมบำรุง";
  const icon = document.getElementById('btn-submit-maintenance-icon');
  if (icon) {
    icon.setAttribute('data-lucide', 'plus-circle');
  }
  
  // Set default status to whatever current AC status is
  const ac = state.acs.find(a => a.id === state.selectedACId);
  if (ac) {
    document.getElementById('maintenance-new-status').value = ac.status;
    document.getElementById('maintenance-new-technician').value = 'ช่างสมชาย มั่นคง';
  }
  lucide.createIcons();
}

async function saveMaintenanceLog() {
  const editingLogId = document.getElementById('maintenance-editing-log-id').value;
  if (editingLogId) {
    const acId = state.selectedACId;
    const note = document.getElementById('maintenance-new-note').value.trim();
    const status = document.getElementById('maintenance-new-status').value;
    const technician = document.getElementById('maintenance-new-technician').value.trim();

    if (!note) return alert("กรุณากรอกบันทึกการซ่อมบำรุง");
    if (!technician) return alert("กรุณาระบุชื่อช่าง");

    try {
      const res = await fetch(`/api/v1/acs/${acId}/maintenance/${editingLogId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, status, technician })
      });
      if (res.ok) {
        cancelEditMaintenance();
        openSideDrawer(acId); // Refresh details spec drawer
        fetchAndRenderWorkspace(); // Sync map highlights
      } else {
        alert("อัปเดตข้อมูลซ่อมบำรุงล้มเหลว");
      }
    } catch (e) {
      alert("เชื่อมต่อเซิร์ฟเวอร์ขัดข้อง");
    }
  } else {
    await addNewMaintenanceLog();
  }
}

async function deleteMaintenanceLog(acId, logId) {
  if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการลบประวัติการซ่อมบำรุงรายการนี้?")) return;
  
  try {
    const res = await fetch(`/api/v1/acs/${acId}/maintenance/${logId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      const editingLogId = document.getElementById('maintenance-editing-log-id').value;
      if (editingLogId == logId) {
        cancelEditMaintenance();
      }
      openSideDrawer(acId); // Refresh details drawer
      fetchAndRenderWorkspace(); // Sync map highlights
    } else {
      alert("ลบข้อมูลซ่อมบำรุงล้มเหลว");
    }
  } catch (e) {
    alert("เชื่อมต่อเซิร์ฟเวอร์ขัดข้อง");
  }
}

// Add new maintenance log via API
async function addNewMaintenanceLog() {
  const acId = state.selectedACId;
  const note = document.getElementById('maintenance-new-note').value.trim();
  const status = document.getElementById('maintenance-new-status').value;
  const technician = document.getElementById('maintenance-new-technician').value.trim();

  if (!note) return alert("กรุณากรอกบันทึกการซ่อมบำรุง");
  if (!technician) return alert("กรุณาระบุชื่อช่าง");

  try {
    const res = await fetch(`/api/v1/acs/${acId}/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, status, technician })
    });
    if (res.ok) {
      openSideDrawer(acId); // Refresh details spec drawer
      fetchAndRenderWorkspace(); // Sync map highlights
    } else {
      alert("บันทึกข้อมูลซ่อมบำรุงล้มเหลว");
    }
  } catch (e) {
    alert("เชื่อมต่อเซิร์ฟเวอร์ขัดข้อง");
  }
}

// ==========================================
// FORM DIALOG MODAL CONTROLS
// ==========================================
let acFormImages = []; // Stores Base64 images array locally on form edits

function openAddACModal(x = 50, y = 50) {
  toggleAddMarkerMode(false);
  
  // Set modal fields default values
  document.getElementById('modal-title').textContent = "เพิ่มเครื่องปรับอากาศใหม่";
  document.getElementById('form-ac-id').value = '';
  document.getElementById('form-ac-x').value = x;
  document.getElementById('form-ac-y').value = y;
  
  document.getElementById('form-name').value = '';
  document.getElementById('form-serial').value = '';
  document.getElementById('form-type').value = 'Wall Type';
  document.getElementById('form-system-type').value = 'ระบบน้ำยา';
  document.getElementById('form-btu').value = '';
  document.getElementById('form-brand').value = '';
  document.getElementById('form-model').value = '';
  document.getElementById('form-install-date').value = '';
  document.getElementById('form-room').value = '';
  document.getElementById('form-status').value = 'normal';
  document.getElementById('form-note').value = '';
  
  acFormImages = [];
  document.getElementById('form-images-preview').innerHTML = '';
  
  // Coordinates indicators
  document.getElementById('form-coords-indicator').classList.remove('hidden');
  document.getElementById('form-indicator-x').textContent = x.toFixed(1);
  document.getElementById('form-indicator-y').textContent = y.toFixed(1);

  document.getElementById('ac-modal').classList.remove('hidden');
  
  toggleCustomTypeField();
  toggleCustomSystemTypeField();
  lucide.createIcons();
}

async function editACFromDrawer() {
  const acId = state.selectedACId;
  closeSideDrawer();

  try {
    const res = await fetch(`/api/v1/acs/${acId}`);
    if (!res.ok) return;
    const ac = await res.json();

    document.getElementById('modal-title').textContent = `แก้ไขข้อมูลเครื่อง ${ac.name}`;
    document.getElementById('form-ac-id').value = ac.id;
    document.getElementById('form-ac-x').value = ac.x;
    document.getElementById('form-ac-y').value = ac.y;

    document.getElementById('form-name').value = ac.name;
    document.getElementById('form-serial').value = ac.serialNumber || '';
    
    // Type mapping fallback
    const standardTypes = ["Wall Type", "Cassette Type", "Ceiling Type", "AHU", "FCU", "Floor Type", "Package", "Split Type"];
    if (standardTypes.includes(ac.type)) {
      document.getElementById('form-type').value = ac.type;
      document.getElementById('form-custom-type').value = '';
    } else {
      document.getElementById('form-type').value = 'อื่นๆ';
      document.getElementById('form-custom-type').value = ac.type;
    }

    // System type fallback
    const standardSystems = ["ระบบน้ำยา", "ระบบน้ำเย็น"];
    if (standardSystems.includes(ac.systemType)) {
      document.getElementById('form-system-type').value = ac.systemType;
      document.getElementById('form-custom-system-type').value = '';
    } else {
      document.getElementById('form-system-type').value = 'อื่นๆ';
      document.getElementById('form-custom-system-type').value = ac.systemType || '';
    }

    document.getElementById('form-btu').value = ac.btu || '';
    document.getElementById('form-brand').value = ac.brand || '';
    document.getElementById('form-model').value = ac.model || '';
    document.getElementById('form-install-date').value = ac.installDate || '';
    document.getElementById('form-room').value = ac.room || '';
    document.getElementById('form-status').value = ac.status;
    document.getElementById('form-note').value = ac.note || '';

    // Coords info
    document.getElementById('form-coords-indicator').classList.remove('hidden');
    document.getElementById('form-indicator-x').textContent = ac.x.toFixed(1);
    document.getElementById('form-indicator-y').textContent = ac.y.toFixed(1);

    acFormImages = ac.images || [];
    renderACFormImagesPreview();

    document.getElementById('ac-modal').classList.remove('hidden');
    toggleCustomTypeField();
    toggleCustomSystemTypeField();
    lucide.createIcons();
  } catch (e) {
    console.error(e);
  }
}

function closeACModal() {
  document.getElementById('ac-modal').classList.add('hidden');
}

// Custom fields toggling
function toggleCustomTypeField() {
  const typeVal = document.getElementById('form-type').value;
  const container = document.getElementById('form-custom-type-container');
  if (typeVal === 'อื่นๆ') {
    container.classList.remove('hidden');
    document.getElementById('form-custom-type').required = true;
  } else {
    container.classList.add('hidden');
    document.getElementById('form-custom-type').required = false;
  }
}

function toggleCustomSystemTypeField() {
  const sysVal = document.getElementById('form-system-type').value;
  const container = document.getElementById('form-custom-system-type-container');
  if (sysVal === 'อื่นๆ') {
    container.classList.remove('hidden');
    document.getElementById('form-custom-system-type').required = true;
  } else {
    container.classList.add('hidden');
    document.getElementById('form-custom-system-type').required = false;
  }
}

// Multi-file photo upload
function handleACImagesSelect(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      acFormImages.push(e.target.result); // Store Base64 string
      renderACFormImagesPreview();
    };
    reader.readAsDataURL(file);
  });
}

function renderACFormImagesPreview() {
  const preview = document.getElementById('form-images-preview');
  preview.innerHTML = '';

  acFormImages.forEach((imgBase64, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = "relative rounded overflow-hidden aspect-[4/3] bg-slate-100 border border-slate-200 group";
    wrapper.innerHTML = `
      <img src="${imgBase64}" class="w-full h-full object-cover">
      <button type="button" onclick="removeACFormImage(${idx})" class="absolute top-1 right-1 p-0.5 bg-rose-500 hover:bg-rose-600 text-white rounded shadow transition flex items-center justify-center">
        <i data-lucide="trash-2" class="w-3 h-3"></i>
      </button>
    `;
    preview.appendChild(wrapper);
  });
  lucide.createIcons();
}

function removeACFormImage(index) {
  acFormImages.splice(index, 1);
  renderACFormImagesPreview();
}

// Form Submission (Add or Update AC via API)
async function handleFormSubmit(event) {
  event.preventDefault();
  
  const acId = document.getElementById('form-ac-id').value;
  const x = parseFloat(document.getElementById('form-ac-x').value);
  const y = parseFloat(document.getElementById('form-ac-y').value);
  
  const name = document.getElementById('form-name').value.trim();
  const serial = document.getElementById('form-serial').value.trim();
  
  let type = document.getElementById('form-type').value;
  if (type === 'อื่นๆ') {
    type = document.getElementById('form-custom-type').value.trim();
  }
  
  let systemType = document.getElementById('form-system-type').value;
  if (systemType === 'อื่นๆ') {
    systemType = document.getElementById('form-custom-system-type').value.trim();
  }

  const btu = document.getElementById('form-btu').value.trim();
  const brand = document.getElementById('form-brand').value.trim();
  const model = document.getElementById('form-model').value.trim();
  const installDate = document.getElementById('form-install-date').value;
  const room = document.getElementById('form-room').value.trim();
  const status = document.getElementById('form-status').value;
  const note = document.getElementById('form-note').value.trim();
  
  const payload = {
    name,
    brand,
    model,
    type,
    systemType,
    btu,
    status,
    installDate,
    serialNumber: serial,
    note,
    room,
    x,
    y,
    images: acFormImages,
    updatedAt: new Date().toISOString(),
    updatedBy: "ช่างสมชาย มั่นคง"
  };

  try {
    let res;
    if (acId) {
      // Update
      res = await fetch(`/api/v1/acs/${acId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      // Add
      payload.id = 'ac-' + Date.now();
      payload.locationId = state.locationId;
      payload.buildingId = state.buildingId;
      payload.floorId = state.floorId;
      res = await fetch('/api/v1/acs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (res.ok) {
      closeACModal();
      fetchAndRenderWorkspace();
    } else {
      const err = await res.json();
      alert(err.detail || "บันทึกไม่สำเร็จ");
    }
  } catch (e) {
    alert("เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว");
  }
}

// Delete AC via API
async function deleteACFromDrawer() {
  const acId = state.selectedACId;
  const conf = confirm("⚠️ คุณแน่ใจหรือไม่ที่จะลบจุดมาร์กเกอร์และประวัติซ่อมของเครื่องปรับอากาศเครื่องนี้ออกจากผังแปลนอาคาร?");
  if (!conf) return;

  try {
    const res = await fetch(`/api/v1/acs/${acId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      closeSideDrawer();
      fetchAndRenderWorkspace();
    } else {
      alert("ลบเครื่องไม่สำเร็จ");
    }
  } catch (e) {
    alert("ล้มเหลว");
  }
}

// ==========================================
// DYNAMIC QR CODE MODAL
// ==========================================
function openACQRSticker() {
  const acId = state.selectedACId;
  const ac = state.acs.find(a => a.id === acId);
  if (!ac) return;

  const modal = document.getElementById('qr-modal');
  document.getElementById('qr-sticker-ac-name').textContent = ac.name;
  
  // Scans will direct directly to routing page
  const scanUrl = window.location.origin + '/ac/' + ac.id;
  document.getElementById('qr-sticker-url').textContent = scanUrl;

  const qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(scanUrl);
  document.getElementById('qr-sticker-image').src = qrImageUrl;

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeQRModal() {
  document.getElementById('qr-modal').classList.add('hidden');
}

function openImagePreview(src) {
  const modal = document.getElementById('image-preview-modal');
  const img = document.getElementById('image-preview-content');
  if (!modal || !img) return;
  img.src = src;
  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeImagePreviewModal() {
  const modal = document.getElementById('image-preview-modal');
  if (modal) modal.classList.add('hidden');
}

// Prints sticker in popup window
function printSticker() {
  const content = document.getElementById('qr-sticker-card').innerHTML;
  const acName = document.getElementById('qr-sticker-ac-name').textContent;
  
  const w = window.open('', '_blank', 'width=600,height=600');
  const html = '<html><head><title>TECHNICAL WATER - QR Code ' + acName + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;900&display=swap" rel="stylesheet">' +
    '<script src="https://cdn.tailwindcss.com"></script>' +
    '<style>body{font-family:\'Sarabun\',sans-serif;margin:0;padding:20px;display:flex;justify-content:center;align-items:center;height:100vh;}@media print{body{padding:0;margin:0;}}</style>' +
    '</head><body>' +
    '<div class="border-2 border-slate-800 rounded-xl p-5 bg-white flex flex-col items-center text-center max-w-sm">' +
    content +
    '</div>' +
    '<script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);};</script>' +
    '</body></html>';
    
  w.document.write(html);
  w.document.close();
}

// ==========================================
// DYNAMIC 4K RESOLUTION BLUEPRINT UPLOADER
// ==========================================
async function handleFloorPlanUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const loader = document.getElementById('uploader-loader');
  if (loader) loader.classList.remove('hidden');

  try {
    let base64Image = '';
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      base64Image = await convertPdfToImage(file);
    } else {
      // Standard image
      base64Image = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
      });
    }

    // Save to server
    const res = await fetch(`/api/v1/locations/${state.locationId}/buildings/${state.buildingId}/floors/${state.floorId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: WORKSPACE_META.floorName || 'Floor', image_data: base64Image })
    });

    if (res.ok) {
      document.getElementById('floorplan-image').src = base64Image;
    } else {
      alert("บันทึกไฟล์ภาพแปลนอาคารล้มเหลว");
    }
  } catch (err) {
    alert("เกิดข้อผิดพลาดในการประมวลผลไฟล์แปลน: " + err.message);
  } finally {
    if (loader) loader.classList.add('hidden');
  }
}

// Date helpers
function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
  } catch (e) {
    return dateStr;
  }
}

function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) return '-';
  try {
    const date = new Date(dateTimeStr);
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const hasTime = dateTimeStr.includes(':') || dateTimeStr.includes('T');
    if (!hasTime) {
      return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
    }
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} น.`;
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543} เวลา ${time}`;
  } catch (e) {
    return dateTimeStr;
  }
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

// ==========================================
// RICH MAINTENANCE HISTORY MODAL CONTROLS
// ==========================================
function openHistoryModal() {
  const acId = state.selectedACId;
  const ac = state.acs.find(a => a.id === acId);
  if (!ac) return;

  // Initialize history modal state
  state.historyAC = ac;
  state.historySortOrder = 'desc';
  state.historyDateFilter = '';

  // Setup modal labels
  document.getElementById('history-modal-title').textContent = `ประวัติการซ่อมบำรุงทั้งหมด`;
  document.getElementById('history-modal-subtitle').textContent = `${ac.name} | ${ac.brand || '-'} / ${ac.model || '-'} (${ac.room || 'ไม่ระบุห้อง'})`;

  // Reset inputs
  document.getElementById('history-filter-date').value = '';
  document.getElementById('history-sort-btn').innerHTML = `<i data-lucide="arrow-down-narrow-wide" class="w-4 h-4"></i> เรียงลำดับ: ล่าสุด`;

  // Render logs
  renderHistoryModalList();

  // Show modal
  document.getElementById('history-modal').classList.remove('hidden');
  lucide.createIcons();
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.add('hidden');
  state.historyAC = null;
}

function toggleHistorySort() {
  const btn = document.getElementById('history-sort-btn');
  if (state.historySortOrder === 'desc') {
    state.historySortOrder = 'asc';
    btn.innerHTML = `<i data-lucide="arrow-up-narrow-wide" class="w-4 h-4"></i> เรียงลำดับ: เก่าสุด`;
  } else {
    state.historySortOrder = 'desc';
    btn.innerHTML = `<i data-lucide="arrow-down-narrow-wide" class="w-4 h-4"></i> เรียงลำดับ: ล่าสุด`;
  }
  renderHistoryModalList();
}

function applyHistoryFilters() {
  state.historyDateFilter = document.getElementById('history-filter-date').value;
  renderHistoryModalList();
}

function clearHistoryDateFilter() {
  document.getElementById('history-filter-date').value = '';
  state.historyDateFilter = '';
  renderHistoryModalList();
}

function getLocalDateString(dateTimeStr) {
  if (!dateTimeStr) return '';
  try {
    const date = new Date(dateTimeStr);
    if (isNaN(date.getTime())) {
      return dateTimeStr.substring(0, 10);
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    return dateTimeStr.substring(0, 10);
  }
}

function renderHistoryModalList() {
  const container = document.getElementById('history-modal-list');
  if (!container) return;
  container.innerHTML = '';

  const ac = state.historyAC;
  if (!ac) return;

  // Filter logs
  let filteredLogs = [...ac.maintenanceHistory];
  if (state.historyDateFilter) {
    filteredLogs = filteredLogs.filter(log => {
      const logLocalDate = getLocalDateString(log.date);
      return logLocalDate === state.historyDateFilter;
    });
  }

  // Sort logs
  filteredLogs.sort((a, b) => {
    const dateComp = a.date.localeCompare(b.date);
    if (dateComp !== 0) {
      return state.historySortOrder === 'desc' ? -dateComp : dateComp;
    }
    return state.historySortOrder === 'desc' ? b.id - a.id : a.id - b.id;
  });

  if (filteredLogs.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400">
        <i data-lucide="info" class="w-10 h-10 mx-auto mb-2 text-slate-300"></i>
        <p class="text-xs">ไม่พบข้อมูลประวัติการซ่อมบำรุงตามตัวกรองที่ระบุ</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  filteredLogs.forEach(log => {
    const item = document.createElement('div');
    item.className = "p-4 bg-white border border-slate-200 rounded-xl text-xs flex flex-col gap-2 shadow-sm";

    let label = 'ใช้งานปกติ';
    let labelClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (log.status === 'check') { label = 'ต้องตรวจสอบ'; labelClass = 'bg-amber-100 text-amber-800 border-amber-200'; }
    if (log.status === 'repair') { label = 'ต้องซ่อม'; labelClass = 'bg-red-100 text-red-800 border-red-200'; }
    if (log.status === 'broken') { label = 'ชำรุด'; labelClass = 'bg-[#f5e6d3] text-[#8b4513] border-[#ebd4bb]'; }
    if (log.status === 'inactive') { label = 'ไม่ได้ใช้งาน'; labelClass = 'bg-slate-100 text-slate-700 border-slate-200'; }

    item.innerHTML = `
      <div class="flex items-center justify-between font-bold text-slate-500">
        <span class="flex items-center gap-1.5"><i data-lucide="calendar" class="w-3.5 h-3.5 text-slate-400"></i> ${formatDateTime(log.date)}</span>
        <div class="flex items-center gap-1.5">
          <span class="px-2 py-0.5 rounded-full text-[10px] border ${labelClass}">${label}</span>
          <button onclick="startEditFromModal(${log.id}, \`${escapeHtml(log.note)}\`, '${log.status}', \`${escapeHtml(log.technician)}\`)" class="text-slate-400 hover:text-brand-500 transition p-1 bg-slate-50 hover:bg-slate-100 rounded" title="แก้ไขประวัติ">
            <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
          </button>
          <button onclick="deleteFromModal(${log.id})" class="text-slate-400 hover:text-rose-500 transition p-1 bg-slate-50 hover:bg-rose-50 rounded" title="ลบประวัติ">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
      <div class="text-slate-800 font-medium bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 whitespace-pre-wrap leading-relaxed">${log.note}</div>
      <div class="text-[10px] text-slate-400 flex items-center gap-1">
        <i data-lucide="user" class="w-3.5 h-3.5 text-slate-300"></i> ดำเนินงานโดย: <span class="font-bold text-slate-600">${log.technician}</span>
      </div>
    `;
    container.appendChild(item);
  });

  lucide.createIcons();
}

function startEditFromModal(logId, note, status, technician) {
  closeHistoryModal();
  startEditMaintenanceLog(state.historyAC.id, logId, note, status, technician);
}

function deleteFromModal(logId) {
  deleteMaintenanceLog(state.historyAC.id, logId);
}

function onStatusFilterChange() {
  renderMarkers();
  renderSidebarACList();
}
