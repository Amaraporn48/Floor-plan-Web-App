# TECHNICAL WATER - AC Management System (Vercel Build Trigger)
import os
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Request, Depends, HTTPException, status, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import (
    SessionLocal, init_db,
    Location, Building, Floor, AirConditioner, ACImage, MaintenanceLog
)

# Initialize FastAPI App
app = FastAPI(title="TECHNICAL WATER - AC Management System")

# Mount Static Files and Templates using absolute paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

def get_floor_abbreviation(floor_name: str) -> str:
    name = floor_name.strip().lower()
    if 'ดาดฟ้า' in name or 'roof' in name:
        return 'RF'
    if 'ใต้ดิน' in name or 'basement' in name or name.startswith('b'):
        digits = ''.join(c for c in name if c.isdigit())
        return f"B{digits}" if digits else 'B'
    digits = ''.join(c for c in floor_name if c.isdigit())
    if digits:
        return f"F{digits}"
    return floor_name[:2].upper()

templates.env.filters["floor_abbrev"] = get_floor_abbreviation

def seed_db(db: Session):
    if db.query(Location).count() > 0:
        return
    
    # 1. Add Default Locations
    default_locations = [
        {
            "id": "loc-1",
            "name": "โรงพยาบาลเปาโล รังสิต",
            "buildings": [
                {
                    "id": "bld-a",
                    "name": "อาคาร A",
                    "floors": [
                        {"id": "floor-1", "name": "ชั้น 1"},
                        {"id": "floor-2", "name": "ชั้น 2"},
                        {"id": "floor-3", "name": "ชั้น 3"},
                        {"id": "floor-4", "name": "ชั้น 4"},
                        {"id": "floor-5", "name": "ชั้น 5"}
                    ]
                },
                {
                    "id": "bld-b",
                    "name": "อาคาร B",
                    "floors": [
                        {"id": "floor-1", "name": "ชั้น 1"},
                        {"id": "floor-2", "name": "ชั้น 2"},
                        {"id": "floor-3", "name": "ชั้น 3"}
                    ]
                }
            ]
        },
        {
            "id": "loc-2",
            "name": "สำนักงานใหญ่กรุงเทพ",
            "buildings": [
                {
                    "id": "bld-hq",
                    "name": "อาคารหลัก",
                    "floors": [
                        {"id": "floor-1", "name": "ชั้น 1"},
                        {"id": "floor-2", "name": "ชั้น 2"},
                        {"id": "floor-3", "name": "ชั้น 3"}
                    ]
                }
            ]
        }
    ]

    for loc_data in default_locations:
        loc = Location(id=loc_data["id"], name=loc_data["name"])
        db.add(loc)
        for bld_data in loc_data["buildings"]:
            bld = Building(id=bld_data["id"], name=bld_data["name"], location_id=loc.id)
            db.add(bld)
            for flr_data in bld_data["floors"]:
                flr_id = f"{loc.id}_{bld.id}_{flr_data['id']}"
                flr = Floor(
                    id=flr_id,
                    name=flr_data["name"],
                    building_id=bld.id,
                    location_id=loc.id,
                    image_data=None
                )
                db.add(flr)

    # 2. Add Default AC units
    default_acs = [
        {
            "id": "ac-001",
            "name": "AC-001",
            "brand": "Daikin",
            "model": "FTKC18TV2S",
            "type": "Wall Type",
            "system_type": "ระบบน้ำยา",
            "btu": "18,000",
            "status": "normal",
            "install_date": "2024-03-15",
            "serial_number": "DK88273918-B",
            "note": "บำรุงรักษาล่าสุดเมื่อสัปดาห์ก่อน ล้างฟิลเตอร์เรียบร้อย",
            "location_id": "loc-1",
            "building_id": "bld-a",
            "floor_id": "floor-1",
            "room": "ห้องโถงผู้ป่วยนอก (OPD Hall)",
            "x": 48.5,
            "y": 35.2,
            "updated_at": "2026-08-19T10:00:00+07:00",
            "updated_by": "ช่างสมชาย มั่นคง"
        },
        {
            "id": "ac-002",
            "name": "AC-002",
            "brand": "Mitsubishi Electric",
            "model": "PLY-SP36BA",
            "type": "Cassette Type",
            "system_type": "ระบบน้ำเย็น",
            "btu": "36,000",
            "status": "check",
            "install_date": "2023-07-10",
            "serial_number": "MS-36294029",
            "note": "เริ่มมีเสียงดังผิดปกติและแอร์ไม่ค่อยเย็น คาดว่าพัดลมคอยล์เย็นเริ่มเสื่อมสภาพ",
            "location_id": "loc-1",
            "building_id": "bld-a",
            "floor_id": "floor-1",
            "room": "ห้องตรวจแพทย์ 102",
            "x": 62.1,
            "y": 28.4,
            "updated_at": "2026-08-19T11:30:00+07:00",
            "updated_by": "ช่างสมชาย มั่นคง"
        },
        {
            "id": "ac-003",
            "name": "AC-003",
            "brand": "Carrier",
            "model": "42TGV0241UP",
            "type": "Ceiling Type",
            "system_type": "ระบบน้ำยา",
            "btu": "24,000",
            "status": "repair",
            "install_date": "2022-11-05",
            "serial_number": "CR-772901-C",
            "note": "น้ำยาแอร์รั่ว คอยล์ร้อนไม่ทำงาน ช่างแจ้งเปลี่ยนหัววาล์วบริการ",
            "location_id": "loc-1",
            "building_id": "bld-a",
            "floor_id": "floor-1",
            "room": "ห้องจ่ายยาหลัก",
            "x": 32.8,
            "y": 58.1,
            "updated_at": "2026-08-19T14:15:00+07:00",
            "updated_by": "ช่างวิชัย เรียนรู้"
        }
    ]

    for ac_data in default_acs:
        raw_flr_id = ac_data["floor_id"]
        unique_flr_id = raw_flr_id if "_" in raw_flr_id else f"{ac_data['location_id']}_{ac_data['building_id']}_{raw_flr_id}"
        ac = AirConditioner(
            id=ac_data["id"],
            name=ac_data["name"],
            brand=ac_data["brand"],
            model=ac_data["model"],
            type=ac_data["type"],
            system_type=ac_data["system_type"],
            btu=ac_data["btu"],
            status=ac_data["status"],
            install_date=ac_data["install_date"],
            serial_number=ac_data["serial_number"],
            note=ac_data["note"],
            location_id=ac_data["location_id"],
            building_id=ac_data["building_id"],
            floor_id=unique_flr_id,
            room=ac_data["room"],
            x=ac_data["x"],
            y=ac_data["y"],
            updated_at=ac_data["updated_at"],
            updated_by=ac_data["updated_by"]
        )
        db.add(ac)
        
    db.commit()
    print("Database seeding complete!")

# Initialize database tables on startup
@app.on_event("startup")
def on_startup():
    try:
        init_db()
        db = SessionLocal()
        try:
            seed_db(db)
        finally:
            db.close()
    except Exception as e:
        import traceback
        print("DATABASE STARTUP ERROR:", str(e))
        traceback.print_exc()
        raise e

# DB Session Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic schemas for REST API validations
class SyncPayload(BaseModel):
    locations: List[dict]
    acs: List[dict]

class LocationCreate(BaseModel):
    id: str
    name: str

class LocationUpdate(BaseModel):
    name: str

class BuildingCreate(BaseModel):
    id: str
    name: str

class BuildingUpdate(BaseModel):
    name: str

class FloorCreate(BaseModel):
    id: str
    name: str
    image_data: Optional[str] = None # Base64 string

class FloorUpdate(BaseModel):
    name: str
    image_data: Optional[str] = None

class ACCreate(BaseModel):
    id: str
    name: str
    brand: Optional[str] = None
    model: Optional[str] = None
    type: Optional[str] = None
    systemType: Optional[str] = None
    btu: Optional[str] = None
    status: Optional[str] = "normal"
    installDate: Optional[str] = None
    serialNumber: Optional[str] = None
    note: Optional[str] = None
    locationId: str
    buildingId: str
    floorId: str
    room: Optional[str] = None
    x: float
    y: float
    images: Optional[List[str]] = [] # Base64 images list
    updatedAt: Optional[str] = None
    updatedBy: Optional[str] = None

class ACUpdate(BaseModel):
    name: str
    brand: Optional[str] = None
    model: Optional[str] = None
    type: Optional[str] = None
    systemType: Optional[str] = None
    btu: Optional[str] = None
    status: Optional[str] = None
    installDate: Optional[str] = None
    serialNumber: Optional[str] = None
    note: Optional[str] = None
    room: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    images: Optional[List[str]] = None
    updatedAt: Optional[str] = None
    updatedBy: Optional[str] = None

class LogCreate(BaseModel):
    note: str
    status: str
    technician: str

# Helper to serialize DB object model to dict
def ac_to_dict(ac: AirConditioner) -> dict:
    return {
        "id": ac.id,
        "name": ac.name,
        "brand": ac.brand,
        "model": ac.model,
        "type": ac.type,
        "systemType": ac.system_type,
        "btu": ac.btu,
        "status": ac.status,
        "installDate": ac.install_date,
        "serialNumber": ac.serial_number,
        "note": ac.note,
        "locationId": ac.location_id,
        "buildingId": ac.building_id,
        "floorId": ac.floor_id,
        "room": ac.room,
        "x": ac.x,
        "y": ac.y,
        "updatedAt": ac.updated_at,
        "updatedBy": ac.updated_by,
        "images": [img.image_data for img in ac.images],
        "maintenanceHistory": [
            {
                "id": log.id,
                "date": log.date,
                "note": log.note,
                "technician": log.technician,
                "status": log.status
            } for log in ac.maintenance_history
        ]
    }

# ==========================================
# HTML ROUTING PAGES (MPA LAYERS)
# ==========================================

# Dashboard Page
@app.get("/", response_class=HTMLResponse)
def page_dashboard(request: Request, db: Session = Depends(get_db)):
    locations = db.query(Location).all()
    acs = db.query(AirConditioner).all()
    
    # Calculate global counters
    stats = {
        "locations_count": len(locations),
        "acs_count": len(acs),
        "normal_count": sum(1 for ac in acs if ac.status == "normal"),
        "check_count": sum(1 for ac in acs if ac.status == "check"),
        "repair_count": sum(1 for ac in acs if ac.status == "repair"),
        "broken_count": sum(1 for ac in acs if ac.status == "broken"),
        "inactive_count": sum(1 for ac in acs if ac.status == "inactive")
    }
    
    # Generate list of locations with custom attributes
    loc_list = []
    for loc in locations:
        floors_count = 0
        bld_names = []
        for bld in loc.buildings:
            floors_count += len(bld.floors)
            bld_names.append(bld.name)
        
        loc_acs = [ac for ac in acs if ac.location_id == loc.id]
        loc_list.append({
            "id": loc.id,
            "name": loc.name,
            "floors_count": floors_count,
            "buildings_list": ", ".join(bld_names) if bld_names else "ไม่มีอาคาร",
            "acs_count": len(loc_acs),
            "completed_count": sum(1 for ac in loc_acs if ac.status == "normal")
        })

    return templates.TemplateResponse(request, "dashboard.html", {
        "stats": stats,
        "locations": loc_list,
        "active_tab": "dashboard"
    })

# Locations List Page
@app.get("/locations", response_class=HTMLResponse)
def page_locations(request: Request, db: Session = Depends(get_db)):
    locations = db.query(Location).all()
    loc_list = []
    for loc in locations:
        floors_count = sum(len(bld.floors) for bld in loc.buildings)
        loc_acs = db.query(AirConditioner).filter_by(location_id=loc.id).all()
        loc_list.append({
            "id": loc.id,
            "name": loc.name,
            "floors_count": floors_count,
            "buildings": [
                {
                    "id": bld.id,
                    "name": bld.name,
                    "floors_count": len(bld.floors),
                    "acs_count": db.query(AirConditioner).filter_by(location_id=loc.id, building_id=bld.id).count()
                } for bld in loc.buildings
            ],
            "acs_count": len(loc_acs),
            "completed_count": sum(1 for ac in loc_acs if ac.status == "normal")
        })
        
    return templates.TemplateResponse(request, "locations.html", {
        "locations": loc_list,
        "active_tab": "locations"
    })

# Floors List Page (Building Specific)
@app.get("/locations/{loc_id}/buildings/{bld_id}", response_class=HTMLResponse)
def page_floors(request: Request, loc_id: str, bld_id: str, db: Session = Depends(get_db)):
    loc = db.query(Location).filter_by(id=loc_id).first()
    bld = db.query(Building).filter_by(id=bld_id, location_id=loc_id).first()
    if not loc or not bld:
        raise HTTPException(status_code=404, detail="สถานที่หรืออาคารไม่ถูกต้อง")

    floors = db.query(Floor).filter_by(location_id=loc_id, building_id=bld_id).all()
    floor_list = []
    for fl in floors:
        ac_count = db.query(AirConditioner).filter_by(location_id=loc_id, building_id=bld_id, floor_id=fl.id).count()
        floor_list.append({
            "id": fl.id,
            "name": fl.name,
            "ac_count": ac_count,
            "has_blueprint": bool(fl.image_data)
        })

    return templates.TemplateResponse(request, "floors.html", {
        "location": loc,
        "building": bld,
        "floors": floor_list,
        "active_tab": "locations"
    })

# Floor Plan CAD/PDF Interactive Workspace
@app.get("/workspace/{loc_id}/{bld_id}/{flr_id}", response_class=HTMLResponse)
def page_workspace(request: Request, loc_id: str, bld_id: str, flr_id: str, highlight: Optional[str] = None, db: Session = Depends(get_db)):
    loc = db.query(Location).filter_by(id=loc_id).first()
    bld = db.query(Building).filter_by(id=bld_id, location_id=loc_id).first()
    
    # Try querying direct or using unique prefix
    flr = db.query(Floor).filter_by(id=flr_id, building_id=bld_id, location_id=loc_id).first()
    if not flr:
        unique_flr_id = f"{loc_id}_{bld_id}_{flr_id}"
        flr = db.query(Floor).filter_by(id=unique_flr_id, building_id=bld_id, location_id=loc_id).first()
    
    if not loc or not bld or not flr:
        raise HTTPException(status_code=404, detail="แผนผังชั้นที่ระบุไม่ถูกต้อง")
        
    return templates.TemplateResponse(request, "workspace.html", {
        "location": loc,
        "building": bld,
        "floor": flr,
        "highlight_ac_id": highlight or "",
        "active_tab": "locations"
    })

# Direct QR Code Route
@app.get("/ac/{ac_id}")
def route_qr_code(ac_id: str, db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="ไม่พบรหัสเครื่องปรับอากาศนี้ในฐานข้อมูล")
    
    # Redirect directly to workspace and highlight this AC marker
    return RedirectResponse(url=f"/workspace/{ac.location_id}/{ac.building_id}/{ac.floor_id}?highlight={ac.id}")

# AC List Page
@app.get("/acs", response_class=HTMLResponse)
def page_acs(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "acs.html", {
        "active_tab": "acs"
    })

# ==========================================
# REST API CONTROLLERS (/api/v1/)
# ==========================================

# Database Bulk Import/Sync (IndexedDB -> SQLite Migrator)
@app.post("/api/v1/sync")
def api_sync_data(payload: SyncPayload, db: Session = Depends(get_db)):
    # Clear existing database tables to perform a clean import
    db.query(MaintenanceLog).delete()
    db.query(ACImage).delete()
    db.query(AirConditioner).delete()
    db.query(Floor).delete()
    db.query(Building).delete()
    db.query(Location).delete()
    
    # 1. Sync Locations and Buildings/Floors nested structure
    for loc_data in payload.locations:
        loc = Location(id=loc_data["id"], name=loc_data["name"])
        db.add(loc)
        
        for bld_data in loc_data.get("buildings", []):
            bld = Building(id=bld_data["id"], name=bld_data["name"], location_id=loc.id)
            db.add(bld)
            
            for flr_data in bld_data.get("floors", []):
                raw_flr_id = flr_data["id"]
                unique_flr_id = raw_flr_id if "_" in raw_flr_id else f"{loc.id}_{bld.id}_{raw_flr_id}"
                flr = Floor(
                    id=unique_flr_id,
                    name=flr_data["name"],
                    building_id=bld.id,
                    location_id=loc.id,
                    image_data=flr_data.get("imageData") # indexeddb field name
                )
                db.add(flr)
                
    # 2. Sync Air Conditioners and related Logs/Images
    for ac_data in payload.acs:
        raw_flr_id = ac_data["floorId"]
        unique_flr_id = raw_flr_id if "_" in raw_flr_id else f"{ac_data['locationId']}_{ac_data['buildingId']}_{raw_flr_id}"
        ac = AirConditioner(
            id=ac_data["id"],
            name=ac_data["name"],
            brand=ac_data.get("brand"),
            model=ac_data.get("model"),
            type=ac_data.get("type"),
            system_type=ac_data.get("systemType"),
            btu=ac_data.get("btu"),
            status=ac_data.get("status", "normal"),
            install_date=ac_data.get("installDate"),
            serial_number=ac_data.get("serialNumber"),
            note=ac_data.get("note"),
            location_id=ac_data["locationId"],
            building_id=ac_data["buildingId"],
            floor_id=unique_flr_id,
            room=ac_data.get("room"),
            x=ac_data["x"],
            y=ac_data["y"],
            updated_at=ac_data.get("updatedAt"),
            updated_by=ac_data.get("updatedBy")
        )
        db.add(ac)
        
        # Add Base64 images
        for img_base64 in ac_data.get("images", []):
            db.add(ACImage(ac_id=ac.id, image_data=img_base64))
            
        # Add Maintenance Logs history list
        for log_data in ac_data.get("maintenanceHistory", []):
            db.add(MaintenanceLog(
                ac_id=ac.id,
                date=log_data["date"],
                note=log_data["note"],
                technician=log_data["technician"],
                status=log_data["status"]
            ))
            
    db.commit()
    return {"status": "success", "imported_locations": len(payload.locations), "imported_acs": len(payload.acs)}

# Locations CRUD APIs
@app.get("/api/v1/locations")
def get_locations(db: Session = Depends(get_db)):
    return [
        {
            "id": l.id,
            "name": l.name,
            "buildings": [
                {
                    "id": b.id,
                    "name": b.name,
                    "floors": [{"id": f.id, "name": f.name} for f in b.floors]
                } for b in l.buildings
            ]
        } for l in db.query(Location).all()
    ]

@app.post("/api/v1/locations")
def create_location(data: LocationCreate, db: Session = Depends(get_db)):
    loc = Location(id=data.id, name=data.name)
    db.add(loc)
    db.commit()
    return {"id": loc.id, "name": loc.name}

@app.put("/api/v1/locations/{loc_id}")
def update_location(loc_id: str, data: LocationUpdate, db: Session = Depends(get_db)):
    loc = db.query(Location).filter_by(id=loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    loc.name = data.name
    db.commit()
    return {"id": loc.id, "name": loc.name}

@app.delete("/api/v1/locations/{loc_id}")
def delete_location(loc_id: str, db: Session = Depends(get_db)):
    loc = db.query(Location).filter_by(id=loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    db.delete(loc)
    db.commit()
    return {"status": "success"}

# Buildings CRUD APIs
@app.post("/api/v1/locations/{loc_id}/buildings")
def create_building(loc_id: str, data: BuildingCreate, db: Session = Depends(get_db)):
    bld = Building(id=data.id, name=data.name, location_id=loc_id)
    db.add(bld)
    db.commit()
    return {"id": bld.id, "name": bld.name}

@app.put("/api/v1/locations/{loc_id}/buildings/{bld_id}")
def update_building(loc_id: str, bld_id: str, data: BuildingUpdate, db: Session = Depends(get_db)):
    bld = db.query(Building).filter_by(id=bld_id, location_id=loc_id).first()
    if not bld:
        raise HTTPException(status_code=404, detail="Building not found")
    bld.name = data.name
    db.commit()
    return {"id": bld.id, "name": bld.name}

@app.delete("/api/v1/locations/{loc_id}/buildings/{bld_id}")
def delete_building(loc_id: str, bld_id: str, db: Session = Depends(get_db)):
    bld = db.query(Building).filter_by(id=bld_id, location_id=loc_id).first()
    if not bld:
        raise HTTPException(status_code=404, detail="Building not found")
    db.delete(bld)
    db.commit()
    return {"status": "success"}

# Floors CRUD APIs
@app.post("/api/v1/locations/{loc_id}/buildings/{bld_id}/floors")
def create_floor(loc_id: str, bld_id: str, data: FloorCreate, db: Session = Depends(get_db)):
    flr = Floor(
        id=data.id, 
        name=data.name, 
        building_id=bld_id, 
        location_id=loc_id, 
        image_data=data.image_data
    )
    db.add(flr)
    db.commit()
    return {"id": flr.id, "name": flr.name}

@app.put("/api/v1/locations/{loc_id}/buildings/{bld_id}/floors/{flr_id}")
def update_floor(loc_id: str, bld_id: str, flr_id: str, data: FloorUpdate, db: Session = Depends(get_db)):
    flr = db.query(Floor).filter_by(id=flr_id, building_id=bld_id, location_id=loc_id).first()
    if not flr:
        raise HTTPException(status_code=404, detail="Floor not found")
    if data.name:
        flr.name = data.name
    if data.image_data:
        flr.image_data = data.image_data
    db.commit()
    return {"id": flr.id, "name": flr.name}

@app.delete("/api/v1/locations/{loc_id}/buildings/{bld_id}/floors/{flr_id}")
def delete_floor(loc_id: str, bld_id: str, flr_id: str, db: Session = Depends(get_db)):
    flr = db.query(Floor).filter_by(id=flr_id, building_id=bld_id, location_id=loc_id).first()
    if not flr:
        raise HTTPException(status_code=404, detail="Floor not found")
    db.delete(flr)
    db.commit()
    return {"status": "success"}

# Air Conditioners CRUD APIs
@app.get("/api/v1/acs")
def get_acs(locationId: Optional[str] = None, buildingId: Optional[str] = None, floorId: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(AirConditioner)
    if locationId:
        query = query.filter_by(location_id=locationId)
    if buildingId:
        query = query.filter_by(building_id=buildingId)
    if floorId:
        query = query.filter_by(floor_id=floorId)
    
    return [ac_to_dict(ac) for ac in query.all()]

@app.get("/api/v1/acs/{ac_id}")
def get_single_ac(ac_id: str, db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    return ac_to_dict(ac)

@app.post("/api/v1/acs")
def create_ac(data: ACCreate, db: Session = Depends(get_db)):
    # Validate unique name
    exists = db.query(AirConditioner).filter(AirConditioner.name == data.name).first()
    if exists:
        raise HTTPException(status_code=400, detail=f"หมายเลขเครื่อง {data.name} มีอยู่ในระบบแล้ว")
        
    ac = AirConditioner(
        id=data.id,
        name=data.name,
        brand=data.brand,
        model=data.model,
        type=data.type,
        system_type=data.systemType,
        btu=data.btu,
        status=data.status or "normal",
        install_date=data.installDate,
        serial_number=data.serialNumber,
        note=data.note,
        location_id=data.locationId,
        building_id=data.buildingId,
        floor_id=data.floorId,
        room=data.room,
        x=data.x,
        y=data.y,
        updated_at=data.updatedAt or datetime.now().isoformat(),
        updated_by=data.updatedBy or "ช่างเทคนิค"
    )
    db.add(ac)
    
    # Store images
    if data.images:
        for img in data.images:
            db.add(ACImage(ac_id=ac.id, image_data=img))
            
    # Auto initialize first history log
    db.add(MaintenanceLog(
        ac_id=ac.id,
        date=ac.install_date or datetime.now().isoformat(),
        note=ac.note or "ติดตั้งเครื่องแอร์ใหม่เข้าระบบ",
        technician=ac.updated_by,
        status=ac.status
    ))
    
    db.commit()
    return ac_to_dict(ac)

@app.put("/api/v1/acs/{ac_id}")
def update_ac(ac_id: str, data: ACUpdate, db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
        
    if data.name:
        ac.name = data.name
    if data.brand is not None:
        ac.brand = data.brand
    if data.model is not None:
        ac.model = data.model
    if data.type is not None:
        ac.type = data.type
    if data.systemType is not None:
        ac.system_type = data.systemType
    if data.btu is not None:
        ac.btu = data.btu
    if data.status is not None:
        ac.status = data.status
    if data.installDate is not None:
        ac.install_date = data.installDate
    if data.serialNumber is not None:
        ac.serial_number = data.serialNumber
    if data.note is not None:
        ac.note = data.note
    if data.room is not None:
        ac.room = data.room
    if data.x is not None:
        ac.x = data.x
    if data.y is not None:
        ac.y = data.y
        
    ac.updated_at = data.updatedAt or datetime.now().isoformat()
    ac.updated_by = data.updatedBy or "ช่างเทคนิค"
    
    # Update images
    if data.images is not None:
        # Clear existing and write new
        db.query(ACImage).filter_by(ac_id=ac.id).delete()
        for img in data.images:
            db.add(ACImage(ac_id=ac.id, image_data=img))
            
    db.commit()
    return ac_to_dict(ac)

@app.delete("/api/v1/acs/{ac_id}")
def delete_ac(ac_id: str, db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    db.delete(ac)
    db.commit()
    return {"status": "success"}

# Maintenance History APIs
@app.post("/api/v1/acs/{ac_id}/maintenance")
def create_maintenance_log(ac_id: str, data: LogCreate, db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
        
    log = MaintenanceLog(
        ac_id=ac.id,
        date=datetime.now().isoformat(),
        note=data.note,
        technician=data.technician,
        status=data.status
    )
    db.add(log)
    
    # Synchronize latest log data to the main AC record
    ac.status = data.status
    ac.note = data.note
    ac.updated_at = datetime.now().isoformat()
    ac.updated_by = data.technician
    
    db.commit()
    return ac_to_dict(ac)

@app.put("/api/v1/acs/{ac_id}/maintenance/{log_id}")
def update_maintenance_log(ac_id: str, log_id: int, data: LogCreate, db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    log = db.query(MaintenanceLog).filter_by(id=log_id, ac_id=ac_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Maintenance log not found")
        
    log.note = data.note
    log.technician = data.technician
    log.status = data.status
    
    # Synchronize latest log data to the main AC record
    ac.status = data.status
    ac.note = data.note
    ac.updated_at = datetime.now().isoformat()
    ac.updated_by = data.technician
    
    db.commit()
    return ac_to_dict(ac)

@app.delete("/api/v1/acs/{ac_id}/maintenance/{log_id}")
def delete_maintenance_log(ac_id: str, log_id: int, db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    log = db.query(MaintenanceLog).filter_by(id=log_id, ac_id=ac_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Maintenance log not found")
        
    db.delete(log)
    db.commit()
    
    # Reset AC status/notes to the latest log, if any remain, otherwise default to normal
    latest = db.query(MaintenanceLog).filter_by(ac_id=ac_id).order_by(MaintenanceLog.id.desc()).first()
    if latest:
        ac.status = latest.status
        ac.note = latest.note
        ac.updated_by = latest.technician
    else:
        ac.status = "normal"
        ac.note = ""
        ac.updated_by = ""
    ac.updated_at = datetime.now().isoformat()
    
    db.commit()
    return ac_to_dict(ac)
