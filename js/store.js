// js/store.js

const STORE_KEY = 'ac_management_system_data';

// Default static structure for locations and buildings
const DEFAULT_LOCATIONS = [
  {
    id: 'loc-1',
    name: 'โรงพยาบาลเปาโล รังสิต',
    buildings: [
      {
        id: 'bld-a',
        name: 'อาคาร A',
        floors: [
          { id: 'floor-1', name: 'ชั้น 1', image: 'assets/floor_plan_a1.png' },
          { id: 'floor-2', name: 'ชั้น 2', image: '' },
          { id: 'floor-3', name: 'ชั้น 3', image: '' },
          { id: 'floor-4', name: 'ชั้น 4', image: '' },
          { id: 'floor-5', name: 'ชั้น 5', image: '' }
        ]
      },
      {
        id: 'bld-b',
        name: 'อาคาร B',
        floors: [
          { id: 'floor-1', name: 'ชั้น 1', image: '' },
          { id: 'floor-2', name: 'ชั้น 2', image: '' },
          { id: 'floor-3', name: 'ชั้น 3', image: '' }
        ]
      }
    ]
  },
  {
    id: 'loc-2',
    name: 'สำนักงานใหญ่กรุงเทพ',
    buildings: [
      {
        id: 'bld-hq',
        name: 'อาคารหลัก',
        floors: [
          { id: 'floor-1', name: 'ชั้น 1', image: '' },
          { id: 'floor-2', name: 'ชั้น 2', image: '' },
          { id: 'floor-3', name: 'ชั้น 3', image: '' }
        ]
      }
    ]
  }
];

const DEFAULT_ACS = [
  {
    id: 'ac-001',
    name: 'AC-001',
    brand: 'Daikin',
    model: 'FTKC18TV2S',
    type: 'Wall Type',
    systemType: 'ระบบน้ำยา',
    btu: '18,000',
    status: 'normal', // ใช้งานปกติ
    installDate: '2024-03-15',
    serialNumber: 'DK88273918-B',
    note: 'บำรุงรักษาล่าสุดเมื่อสัปดาห์ก่อน ล้างฟิลเตอร์เรียบร้อย',
    locationId: 'loc-1',
    buildingId: 'bld-a',
    floorId: 'floor-1',
    room: 'ห้องโถงผู้ป่วยนอก (OPD Hall)',
    x: 48.5, // percent coordinates on floor plan
    y: 35.2,
    images: [], // base64 images
    updatedAt: '2026-08-19T10:00:00+07:00',
    updatedBy: 'ช่างสมชาย มั่นคง'
  },
  {
    id: 'ac-002',
    name: 'AC-002',
    brand: 'Mitsubishi Electric',
    model: 'PLY-SP36BA',
    type: 'Cassette Type',
    systemType: 'ระบบน้ำเย็น',
    btu: '36,000',
    status: 'check', // ต้องตรวจสอบ
    installDate: '2023-07-10',
    serialNumber: 'MS-36294029',
    note: 'เริ่มมีเสียงดังผิดปกติและแอร์ไม่ค่อยเย็น คาดว่าพัดลมคอยล์เย็นเริ่มเสื่อมสภาพ',
    locationId: 'loc-1',
    buildingId: 'bld-a',
    floorId: 'floor-1',
    room: 'ห้องตรวจแพทย์ 102',
    x: 62.1,
    y: 28.4,
    images: [],
    updatedAt: '2026-08-19T11:30:00+07:00',
    updatedBy: 'ช่างสมชาย มั่นคง'
  },
  {
    id: 'ac-003',
    name: 'AC-003',
    brand: 'Carrier',
    model: '42TGV0241UP',
    type: 'Ceiling Type',
    systemType: 'ระบบน้ำยา',
    btu: '24,000',
    status: 'repair', // ต้องซ่อม
    installDate: '2022-11-05',
    serialNumber: 'CR-772901-C',
    note: 'น้ำยาแอร์รั่ว คอยล์ร้อนไม่ทำงาน ช่างแจ้งเปลี่ยนหัววาล์วบริการ',
    locationId: 'loc-1',
    buildingId: 'bld-a',
    floorId: 'floor-1',
    room: 'ห้องจ่ายยาหลัก',
    x: 32.8,
    y: 58.1,
    images: [],
    updatedAt: '2026-08-19T14:15:00+07:00',
    updatedBy: 'ช่างวิชัย เรียนรู้'
  }
];

class ACStore {
  constructor() {
    this.cache = null;
    this.db = null;
    this.useFallback = false;
  }

  // Load from IndexedDB (or fallback to LocalStorage)
  async init() {
    return new Promise((resolve) => {
      let request;
      try {
        request = indexedDB.open('ACManagementDB', 1);
      } catch (err) {
        console.error('IndexedDB open blocked, using fallback', err);
        this.useFallback = true;
        this.initFallback();
        resolve();
        return;
      }

      request.onerror = (event) => {
        console.error('IndexedDB open error, using fallback', event);
        this.useFallback = true;
        this.initFallback();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        db.createObjectStore('store');
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        
        try {
          const transaction = this.db.transaction(['store'], 'readwrite');
          const objectStore = transaction.objectStore('store');
          const getRequest = objectStore.get('app_state_data');
          
          getRequest.onsuccess = () => {
            if (getRequest.result) {
              this.cache = getRequest.result;
              
              // Automated Migration: Rename hospital while preserving all user-added plans and markers
              let hasChanged = false;
              if (this.cache.locations) {
                this.cache.locations.forEach(loc => {
                  if (loc.name === 'โรงพยาบาลตัวอย่าง') {
                    loc.name = 'โรงพยาบาลเปาโล รังสิต';
                    hasChanged = true;
                  }
                });
              }
              if (hasChanged) {
                const putRequest = objectStore.put(this.cache, 'app_state_data');
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => resolve();
              } else {
                resolve();
              }
            } else {
              // Write default data
              this.cache = {
                locations: DEFAULT_LOCATIONS,
                acs: DEFAULT_ACS
              };
              this.saveData();
              resolve();
            }
          };

          getRequest.onerror = () => {
            this.cache = { locations: DEFAULT_LOCATIONS, acs: DEFAULT_ACS };
            resolve();
          };
        } catch (err) {
          console.error('IndexedDB transaction error, using fallback', err);
          this.useFallback = true;
          this.initFallback();
          resolve();
        }
      };
    });
  }

  initFallback() {
    try {
      const rawData = localStorage.getItem(STORE_KEY);
      this.cache = rawData ? JSON.parse(rawData) : { locations: DEFAULT_LOCATIONS, acs: DEFAULT_ACS };
      
      // Fallback migration
      let hasChanged = false;
      if (this.cache.locations) {
        this.cache.locations.forEach(loc => {
          if (loc.name === 'โรงพยาบาลตัวอย่าง') {
            loc.name = 'โรงพยาบาลเปาโล รังสิต';
            hasChanged = true;
          }
        });
      }
      if (hasChanged) {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.cache));
      }
    } catch (e) {
      console.error("Error reading localStorage, resetting data to defaults", e);
      this.cache = { locations: DEFAULT_LOCATIONS, acs: DEFAULT_ACS };
    }
    
    if (!localStorage.getItem(STORE_KEY)) {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.cache));
    }
  }

  getData() {
    return this.cache || { locations: DEFAULT_LOCATIONS, acs: DEFAULT_ACS };
  }

  saveData(data) {
    if (data) {
      this.cache = data;
    }
    
    if (this.useFallback) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.cache));
      } catch (e) {
        console.error("Failed to save data to localStorage", e);
        alert("ไม่สามารถบันทึกข้อมูลได้ เนื่องจากโควต้าเต็ม (รูปถ่ายอาจมีขนาดใหญ่เกินไป) กรุณาลดขนาดภาพหรือลบบางรูปออก");
      }
      return;
    }

    try {
      const transaction = this.db.transaction(['store'], 'readwrite');
      const objectStore = transaction.objectStore('store');
      objectStore.put(this.cache, 'app_state_data');
    } catch (e) {
      console.error('Failed to save to IndexedDB', e);
    }
  }

  resetData() {
    const initialData = {
      locations: DEFAULT_LOCATIONS,
      acs: DEFAULT_ACS
    };
    this.saveData(initialData);
    return initialData;
  }

  // Location/Building/Floor accessors
  getLocations() {
    const locations = this.getData().locations;
    if (locations) {
      locations.forEach(loc => {
        if (loc.name === 'โรงพยาบาลตัวอย่าง') {
          loc.name = 'โรงพยาบาลเปาโล รังสิต';
        }
      });
    }
    return locations;
  }

  getLocation(id) {
    return this.getLocations().find(loc => loc.id === id);
  }

  addLocation(locationName) {
    const data = this.getData();
    // Check duplicate name
    const exists = data.locations.some(l => l.name.toLowerCase() === locationName.toLowerCase().trim());
    if (exists) {
      throw new Error(`สถานที่ "${locationName}" มีอยู่แล้วในระบบ`);
    }

    const newLocationId = 'loc_' + Date.now();
    const newLocation = {
      id: newLocationId,
      name: locationName.trim(),
      buildings: []
    };

    data.locations.push(newLocation);
    this.saveData(data);
    return newLocation;
  }

  renameLocation(locationId, newName) {
    const data = this.getData();
    const loc = data.locations.find(l => l.id === locationId);
    if (!loc) return false;

    // Check duplicate
    const exists = data.locations.some(l => l.id !== locationId && l.name.toLowerCase() === newName.toLowerCase().trim());
    if (exists) {
      throw new Error(`สถานที่ "${newName}" มีอยู่แล้วในระบบ`);
    }

    loc.name = newName.trim();
    this.saveData(data);
    return true;
  }

  deleteLocation(locationId) {
    const data = this.getData();
    const locIndex = data.locations.findIndex(l => l.id === locationId);
    if (locIndex === -1) return false;

    // Clean up all ACs associated with this location
    data.acs = data.acs.filter(ac => ac.locationId !== locationId);

    // Remove location from database
    data.locations.splice(locIndex, 1);
    
    this.saveData(data);
    return true;
  }

  getBuilding(locationId, buildingId) {
    const loc = this.getLocation(locationId);
    if (!loc) return null;
    return loc.buildings.find(bld => bld.id === buildingId);
  }

  getFloor(locationId, buildingId, floorId) {
    const bld = this.getBuilding(locationId, buildingId);
    if (!bld) return null;
    return bld.floors.find(flr => flr.id === floorId);
  }

  addFloor(locationId, buildingId, floorName) {
    const data = this.getData();
    const loc = data.locations.find(l => l.id === locationId);
    if (!loc) return false;
    
    const bld = loc.buildings.find(b => b.id === buildingId);
    if (!bld) return false;

    // Check if floor name already exists in this building
    const exists = bld.floors.some(f => f.name.toLowerCase() === floorName.toLowerCase().trim());
    if (exists) {
      throw new Error(`ชั้น "${floorName}" มีอยู่ในอาคารนี้แล้ว`);
    }

    const newFloorId = 'floor_' + Date.now();
    const newFloor = {
      id: newFloorId,
      name: floorName.trim(),
      image: ''
    };

    bld.floors.push(newFloor);
    this.saveData(data);
    return newFloor;
  }

  renameFloor(locationId, buildingId, floorId, newName) {
    const data = this.getData();
    const loc = data.locations.find(l => l.id === locationId);
    if (!loc) return false;
    const bld = loc.buildings.find(b => b.id === buildingId);
    if (!bld) return false;
    const floor = bld.floors.find(f => f.id === floorId);
    if (!floor) return false;

    // Check duplicate
    const exists = bld.floors.some(f => f.id !== floorId && f.name.toLowerCase() === newName.toLowerCase().trim());
    if (exists) {
      throw new Error(`ชั้น "${newName}" มีอยู่ในอาคารนี้แล้ว`);
    }

    floor.name = newName.trim();
    this.saveData(data);
    return true;
  }

  deleteFloor(locationId, buildingId, floorId) {
    const data = this.getData();
    const loc = data.locations.find(l => l.id === locationId);
    if (!loc) return false;
    const bld = loc.buildings.find(b => b.id === buildingId);
    if (!bld) return false;
    const floorIndex = bld.floors.findIndex(f => f.id === floorId);
    if (floorIndex === -1) return false;

    // Clean up all ACs associated with this floor
    data.acs = data.acs.filter(ac => !(ac.locationId === locationId && ac.buildingId === buildingId && ac.floorId === floorId));

    // Remove floor
    bld.floors.splice(floorIndex, 1);
    this.saveData(data);
    return true;
  }

  addBuilding(locationId, buildingName) {
    const data = this.getData();
    const loc = data.locations.find(l => l.id === locationId);
    if (!loc) return false;

    // Check duplicate name
    const exists = loc.buildings.some(b => b.name.toLowerCase() === buildingName.toLowerCase().trim());
    if (exists) {
      throw new Error(`อาคาร "${buildingName}" มีอยู่ในสถานที่นี้แล้ว`);
    }

    const newBuildingId = 'bld_' + Date.now();
    const newBuilding = {
      id: newBuildingId,
      name: buildingName.trim(),
      floors: [
        { id: 'floor-1', name: 'ชั้น 1', image: '' } // Default floor 1
      ]
    };

    loc.buildings.push(newBuilding);
    this.saveData(data);
    return newBuilding;
  }

  renameBuilding(locationId, buildingId, newName) {
    const data = this.getData();
    const loc = data.locations.find(l => l.id === locationId);
    if (!loc) return false;

    const bld = loc.buildings.find(b => b.id === buildingId);
    if (!bld) return false;

    // Check duplicate name excluding itself
    const exists = loc.buildings.some(b => b.id !== buildingId && b.name.toLowerCase() === newName.toLowerCase().trim());
    if (exists) {
      throw new Error(`อาคาร "${newName}" มีอยู่ในสถานที่นี้แล้ว`);
    }

    bld.name = newName.trim();
    this.saveData(data);
    return true;
  }

  deleteBuilding(locationId, buildingId) {
    const data = this.getData();
    const loc = data.locations.find(l => l.id === locationId);
    if (!loc) return false;

    const bldIndex = loc.buildings.findIndex(b => b.id === buildingId);
    if (bldIndex === -1) return false;

    // Clean up all ACs associated with this building
    data.acs = data.acs.filter(ac => !(ac.locationId === locationId && ac.buildingId === buildingId));

    // Remove building from locations
    loc.buildings.splice(bldIndex, 1);
    
    this.saveData(data);
    return true;
  }

  // Update Floor Plan image
  updateFloorPlanImage(locationId, buildingId, floorId, base64Image) {
    const data = this.getData();
    const loc = data.locations.find(l => l.id === locationId);
    if (loc) {
      const bld = loc.buildings.find(b => b.id === buildingId);
      if (bld) {
        const flr = bld.floors.find(f => f.id === floorId);
        if (flr) {
          flr.image = base64Image;
          this.saveData(data);
          return true;
        }
      }
    }
    return false;
  }

  // AC CRUD Operations
  getACs(filters = {}) {
    let list = this.getData().acs;

    if (filters.locationId) {
      list = list.filter(ac => ac.locationId === filters.locationId);
    }
    if (filters.buildingId) {
      list = list.filter(ac => ac.buildingId === filters.buildingId);
    }
    if (filters.floorId) {
      list = list.filter(ac => ac.floorId === filters.floorId);
    }
    if (filters.status && filters.status.length > 0) {
      list = list.filter(ac => filters.status.includes(ac.status));
    }
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase().trim();
      list = list.filter(ac => 
        (ac.name && ac.name.toLowerCase().includes(query)) ||
        (ac.serialNumber && ac.serialNumber.toLowerCase().includes(query)) ||
        (ac.brand && ac.brand.toLowerCase().includes(query)) ||
        (ac.model && ac.model.toLowerCase().includes(query)) ||
        (ac.room && ac.room.toLowerCase().includes(query)) ||
        (ac.type && ac.type.toLowerCase().includes(query)) ||
        (ac.btu && ac.btu.toString().includes(query)) ||
        (ac.note && ac.note.toLowerCase().includes(query))
      );
    }

    return list;
  }

  getACById(id) {
    return this.getData().acs.find(ac => ac.id === id);
  }

  addMaintenanceLog(acId, logData) {
    const data = this.getData();
    const ac = data.acs.find(a => a.id === acId);
    if (!ac) return false;

    if (!ac.maintenanceHistory) {
      // Lazy initialize history with current state
      ac.maintenanceHistory = [
        {
          date: ac.updatedAt ? ac.updatedAt.split('T')[0] : (ac.installDate || 'ไม่ระบุ'),
          note: ac.note || 'ติดตั้งเครื่องใหม่เข้าระบบ',
          technician: ac.updatedBy || 'ระบบ',
          status: ac.status
        }
      ];
    }

    const newLog = {
      date: new Date().toISOString().split('T')[0],
      note: logData.note.trim(),
      technician: logData.technician.trim(),
      status: logData.status
    };

    ac.maintenanceHistory.push(newLog);

    // Synchronize latest details
    ac.status = logData.status;
    ac.note = logData.note.trim();
    ac.updatedAt = new Date().toISOString();
    ac.updatedBy = logData.technician.trim();

    this.saveData(data);
    return ac;
  }

  addAC(acData) {
    const data = this.getData();
    // Validate name uniqueness
    const exists = data.acs.some(ac => ac.name.toLowerCase() === acData.name.toLowerCase());
    if (exists) {
      throw new Error(`หมายเลขเครื่อง ${acData.name} มีอยู่ในระบบแล้ว`);
    }

    const newAC = {
      id: 'ac_' + Date.now(),
      name: acData.name || `AC-${data.acs.length + 1}`,
      brand: acData.brand || '',
      model: acData.model || '',
      type: acData.type || 'Wall Type',
      systemType: acData.systemType || 'ระบบน้ำยา',
      btu: acData.btu || '',
      status: acData.status || 'normal',
      installDate: acData.installDate || '',
      serialNumber: acData.serialNumber || '',
      note: acData.note || '',
      locationId: acData.locationId,
      buildingId: acData.buildingId,
      floorId: acData.floorId,
      room: acData.room || '',
      x: acData.x || 50,
      y: acData.y || 50,
      images: acData.images || [],
      updatedAt: new Date().toISOString(),
      updatedBy: acData.updatedBy || 'ช่างผู้ใช้งาน'
    };

    data.acs.push(newAC);
    this.saveData(data);
    return newAC;
  }

  updateAC(id, updateFields) {
    const data = this.getData();
    const index = data.acs.findIndex(ac => ac.id === id);
    if (index === -1) return null;

    // Check name uniqueness if changed
    if (updateFields.name && updateFields.name.toLowerCase() !== data.acs[index].name.toLowerCase()) {
      const exists = data.acs.some(ac => ac.id !== id && ac.name.toLowerCase() === updateFields.name.toLowerCase());
      if (exists) {
        throw new Error(`หมายเลขเครื่อง ${updateFields.name} มีอยู่ในระบบแล้ว`);
      }
    }

    const updatedAC = {
      ...data.acs[index],
      ...updateFields,
      updatedAt: new Date().toISOString()
    };

    data.acs[index] = updatedAC;
    this.saveData(data);
    return updatedAC;
  }

  updateACPosition(id, x, y) {
    const data = this.getData();
    const index = data.acs.findIndex(ac => ac.id === id);
    if (index === -1) return false;

    data.acs[index].x = parseFloat(x);
    data.acs[index].y = parseFloat(y);
    data.acs[index].updatedAt = new Date().toISOString();
    
    this.saveData(data);
    return true;
  }

  deleteAC(id) {
    const data = this.getData();
    const initialLength = data.acs.length;
    data.acs = data.acs.filter(ac => ac.id !== id);
    
    if (data.acs.length < initialLength) {
      this.saveData(data);
      return true;
    }
    return false;
  }

  // Get counters for dashboard metrics
  getStats(locationId) {
    const data = this.getData();
    let locations = data.locations;
    let acs = data.acs;

    if (locationId) {
      locations = locations.filter(loc => loc.id === locationId);
      acs = acs.filter(ac => ac.locationId === locationId);
    }

    let buildingCount = 0;
    let floorCount = 0;
    locations.forEach(loc => {
      buildingCount += loc.buildings.length;
      loc.buildings.forEach(bld => {
        floorCount += bld.floors.length;
      });
    });

    const statusCounts = {
      total: acs.length,
      normal: acs.filter(ac => ac.status === 'normal').length,
      check: acs.filter(ac => ac.status === 'check').length,
      repair: acs.filter(ac => ac.status === 'repair').length,
      broken: acs.filter(ac => ac.status === 'broken').length,
      inactive: acs.filter(ac => ac.status === 'inactive').length
    };

    return {
      locationsCount: locationId ? 1 : data.locations.length,
      buildingsCount: buildingCount,
      floorsCount: floorCount,
      statusCounts
    };
  }
}

// Export store instance globally for SPA files
window.acStore = new ACStore();
