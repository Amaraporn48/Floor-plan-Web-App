import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional
import bcrypt
import jwt
from fastapi import FastAPI, Request, Depends, HTTPException, status, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import (
    SessionLocal, init_db,
    Location, Building, Floor, AirConditioner, ACImage, MaintenanceLog,
    User, UserAssignment
)

# JWT Auth Configuration
JWT_SECRET = os.environ.get("JWT_SECRET", "technical-water-secret-key-123456789")
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def create_access_token(user_id: str, username: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    to_encode = {
        "sub": user_id,
        "username": username,
        "role": role,
        "exp": expire
    }
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None

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
    # Ensure default admin exists in the database (local or cloud)
    try:
        init_db()
        db = SessionLocal()
        try:
            admin_exists = db.query(User).filter_by(role="admin").first()
            if not admin_exists:
                print("Seeding default admin user...")
                admin = User(
                    id="admin-uuid-1111-2222",
                    username="admin",
                    hashed_password=hash_password("admin1234"),
                    role="admin",
                    full_name="Admin System"
                )
                db.add(admin)
                db.commit()
                print("Default admin user created: admin / admin1234")
        finally:
            db.close()
    except Exception as e:
        print("Error seeding default admin:", str(e))

    # Skip DB initialization on Vercel production to optimize cold-start speed
    if os.environ.get("TURSO_DATABASE_URL"):
        print("Running in production mode (Turso Cloud DB). Skipping startup init/seeding.")
        return

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

# User Session Dependency Injection (Cookie-Based JWT Auth)
def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            
    if not token:
        if "text/html" in request.headers.get("accept", ""):
            raise HTTPException(
                status_code=status.HTTP_307_TEMPORARY_REDIRECT,
                headers={"Location": "/login"}
            )
        raise HTTPException(status_code=401, detail="Not authenticated")
        
    payload = decode_access_token(token)
    if not payload:
        if "text/html" in request.headers.get("accept", ""):
            raise HTTPException(
                status_code=status.HTTP_307_TEMPORARY_REDIRECT,
                headers={"Location": "/login"}
            )
        raise HTTPException(status_code=401, detail="Session expired")
        
    user_id = payload.get("sub")
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        if "text/html" in request.headers.get("accept", ""):
            raise HTTPException(
                status_code=status.HTTP_307_TEMPORARY_REDIRECT,
                headers={"Location": "/login"}
            )
        raise HTTPException(status_code=401, detail="User not found")
        
    return user

def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return current_user

def get_user_locations_query(user: User, db: Session):
    if user.role == "admin":
        return db.query(Location)
    else:
        return (
            db.query(Location)
            .join(Floor, Floor.location_id == Location.id)
            .join(UserAssignment, UserAssignment.floor_id == Floor.id)
            .filter(UserAssignment.user_id == user.id)
            .distinct()
        )

def check_location_access(user: User, location_id: str, db: Session):
    if user.role == "admin":
        return True
    assignment = (
        db.query(UserAssignment)
        .join(Floor, Floor.id == UserAssignment.floor_id)
        .filter(UserAssignment.user_id == user.id, Floor.location_id == location_id)
        .first()
    )
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="คุณไม่มีสิทธิ์เข้าถึงสถานที่นี้"
        )
    return True

def check_floor_access(user: User, floor_id: str, db: Session):
    if user.role == "admin":
        return True
    assignment = (
        db.query(UserAssignment)
        .filter_by(user_id=user.id, floor_id=floor_id)
        .first()
    )
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="คุณไม่มีสิทธิ์เข้าถึงชั้นข้อมูลนี้"
        )
    return True




# Pydantic schemas for REST API validations
class SyncPayload(BaseModel):
    locations: List[dict]
    acs: List[dict]

class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: str

class AssignmentCreate(BaseModel):
    floor_id: str

class BulkAssignmentCreate(BaseModel):
    floor_ids: List[str]

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
    name: Optional[str] = None
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

# Login Page
@app.get("/login", response_class=HTMLResponse)
def page_login(request: Request, error: Optional[str] = None):
    # If already logged in, redirect to home
    token = request.cookies.get("access_token")
    if token and decode_access_token(token):
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(request, "login.html", {"error": error})

# Handle Login POST
@app.post("/login")
def handle_login(request: Request, username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=username).first()
    if not user or not verify_password(password, user.hashed_password):
        return templates.TemplateResponse(request, "login.html", {"error": "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง"})
    
    # Create token and set in cookie
    token = create_access_token(user.id, user.username, user.role)
    response = RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        max_age=TOKEN_EXPIRE_HOURS * 3600,
        samesite="lax",
        secure=False
    )
    return response

# Logout Route
@app.get("/logout")
def handle_logout():
    response = RedirectResponse(url="/login", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie("access_token")
    return response

# User Administration Panel (Admin Only)
@app.get("/admin/users", response_class=HTMLResponse)
def page_admin_users(request: Request, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    users = db.query(User).all()
    locations = db.query(Location).all()
    
    # Map assignments to helper structures for easy rendering
    user_list = []
    for u in users:
        assignments = []
        for assign in u.assignments:
            flr = db.query(Floor).filter_by(id=assign.floor_id).first()
            if flr:
                bld = db.query(Building).filter_by(id=flr.building_id).first()
                loc = db.query(Location).filter_by(id=flr.location_id).first()
                assignments.append({
                    "floor_id": assign.floor_id,
                    "floor_name": flr.name,
                    "building_name": bld.name if bld else "ไม่พบอาคาร",
                    "location_name": loc.name if loc else "ไม่พบสถานที่"
                })
        user_list.append({
            "id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "role": u.role,
            "assignments": assignments
        })
        
    return templates.TemplateResponse(request, "admin/users.html", {
        "users": user_list,
        "locations": locations,
        "active_tab": "users",
        "current_user_id": current_user.id,
        "current_user": current_user
    })

# Dashboard Page
@app.get("/", response_class=HTMLResponse)
def page_dashboard(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    locations = get_user_locations_query(current_user, db).all()
    assigned_loc_ids = [l.id for l in locations]
    
    if current_user.role == "admin":
        acs = db.query(AirConditioner).all()
    else:
        acs = db.query(AirConditioner).filter(AirConditioner.location_id.in_(assigned_loc_ids)).all() if assigned_loc_ids else []
    
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
            "completed_count": sum(1 for ac in loc_acs if ac.status == "normal"),
            "check_count": sum(1 for ac in loc_acs if ac.status == "check"),
            "repair_count": sum(1 for ac in loc_acs if ac.status == "repair"),
            "broken_count": sum(1 for ac in loc_acs if ac.status == "broken"),
            "inactive_count": sum(1 for ac in loc_acs if ac.status == "inactive"),
            "buildings": [{"id": b.id, "name": b.name} for b in loc.buildings]
        })

    return templates.TemplateResponse(request, "dashboard.html", {
        "stats": stats,
        "locations": loc_list,
        "active_tab": "dashboard",
        "current_user": current_user
    })

# Locations List Page
@app.get("/locations", response_class=HTMLResponse)
def page_locations(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    locations = get_user_locations_query(current_user, db).all()
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
        "active_tab": "locations",
        "current_user": current_user
    })

# Floors List Page (Building Specific)
@app.get("/locations/{loc_id}/buildings/{bld_id}", response_class=HTMLResponse)
def page_floors(request: Request, loc_id: str, bld_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    check_location_access(current_user, loc_id, db)
    loc = db.query(Location).filter_by(id=loc_id).first()
    bld = db.query(Building).filter_by(id=bld_id, location_id=loc_id).first()
    if not loc or not bld:
        raise HTTPException(status_code=404, detail="สถานที่หรืออาคารไม่ถูกต้อง")

    # Optimize: Query only ID and name, and check image_data existence without transferring it over the network
    query = (
        db.query(Floor.id, Floor.name, (Floor.image_data != None).label("has_blueprint"))
        .filter_by(location_id=loc_id, building_id=bld_id)
    )
    if current_user.role != "admin":
        query = query.join(UserAssignment, UserAssignment.floor_id == Floor.id).filter(UserAssignment.user_id == current_user.id)
    floors = query.all()
    
    # Optimize: Query AC counts for all floors in this building in a single database call
    from sqlalchemy import func
    ac_counts_raw = (
        db.query(AirConditioner.floor_id, func.count(AirConditioner.id))
        .filter_by(location_id=loc_id, building_id=bld_id)
        .group_by(AirConditioner.floor_id)
        .all()
    )
    ac_counts = {floor_id: count for floor_id, count in ac_counts_raw}

    floor_list = []
    for fl in floors:
        floor_list.append({
            "id": fl.id,
            "name": fl.name,
            "ac_count": ac_counts.get(fl.id, 0),
            "has_blueprint": fl.has_blueprint
        })

    return templates.TemplateResponse(request, "floors.html", {
        "location": loc,
        "building": bld,
        "floors": floor_list,
        "active_tab": "locations",
        "current_user": current_user
    })

# Floor Plan CAD/PDF Interactive Workspace
@app.get("/workspace/{loc_id}/{bld_id}/{flr_id}", response_class=HTMLResponse)
def page_workspace(request: Request, loc_id: str, bld_id: str, flr_id: str, highlight: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    check_location_access(current_user, loc_id, db)
    loc = db.query(Location).filter_by(id=loc_id).first()
    bld = db.query(Building).filter_by(id=bld_id, location_id=loc_id).first()
    
    # Try querying direct or using unique prefix
    flr = db.query(Floor).filter_by(id=flr_id, building_id=bld_id, location_id=loc_id).first()
    if not flr:
        unique_flr_id = f"{loc_id}_{bld_id}_{flr_id}"
        flr = db.query(Floor).filter_by(id=unique_flr_id, building_id=bld_id, location_id=loc_id).first()
    
    if not loc or not bld or not flr:
        raise HTTPException(status_code=404, detail="แผนผังชั้นที่ระบุไม่ถูกต้อง")

    # Enforce floor-level security guard!
    check_floor_access(current_user, flr.id, db)

    # Query and serialize AC units for this floor to render instantly on load
    acs = db.query(AirConditioner).filter_by(location_id=loc_id, building_id=bld_id, floor_id=flr.id).all()
    ac_list = [ac_to_dict(ac) for ac in acs]
        
    return templates.TemplateResponse(request, "workspace.html", {
        "location": loc,
        "building": bld,
        "floor": flr,
        "initial_acs": ac_list,
        "highlight_ac_id": highlight or "",
        "active_tab": "locations",
        "current_user": current_user
    })

# Direct QR Code Route (Public - No Login Required)
@app.get("/ac/{ac_id}", response_class=HTMLResponse)
def route_qr_code(request: Request, ac_id: str, db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="ไม่พบรหัสเครื่องปรับอากาศนี้ในฐานข้อมูล")
    
    # Retrieve Location, Building, and Floor details for presentation
    loc = db.query(Location).filter_by(id=ac.location_id).first()
    bld = db.query(Building).filter_by(id=ac.building_id).first()
    flr = db.query(Floor).filter_by(id=ac.floor_id).first()
    
    # Optional authentication check to render workspace link if logged in
    current_user = None
    token = request.cookies.get("access_token")
    if token:
        try:
            payload = decode_access_token(token)
            if payload:
                user_id = payload.get("sub")
                current_user = db.query(User).filter_by(id=user_id).first()
        except Exception:
            pass

    # Sort maintenance history by date descending
    logs = sorted(ac.maintenance_history, key=lambda l: l.date, reverse=True)
    
    return templates.TemplateResponse(request, "ac_public.html", {
        "ac": ac,
        "location": loc,
        "building": bld,
        "floor": flr,
        "logs": logs,
        "current_user": current_user
    })

# AC List Page
@app.get("/acs", response_class=HTMLResponse)
def page_acs(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "acs.html", {
        "active_tab": "acs",
        "current_user": current_user
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
def get_locations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    locations = get_user_locations_query(current_user, db).all()
    
    if current_user.role == "admin":
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
            } for l in locations
        ]
    else:
        assigned_floor_ids = {assign.floor_id for assign in current_user.assignments}
        res = []
        for l in locations:
            bld_list = []
            for b in l.buildings:
                fl_list = [{"id": f.id, "name": f.name} for f in b.floors if f.id in assigned_floor_ids]
                if fl_list:
                    bld_list.append({
                        "id": b.id,
                        "name": b.name,
                        "floors": fl_list
                    })
            if bld_list:
                res.append({
                    "id": l.id,
                    "name": l.name,
                    "buildings": bld_list
                })
        return res

@app.post("/api/v1/locations")
def create_location(data: LocationCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    loc = Location(id=data.id, name=data.name)
    db.add(loc)
    db.commit()
    return {"id": loc.id, "name": loc.name}

@app.put("/api/v1/locations/{loc_id}")
def update_location(loc_id: str, data: LocationUpdate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    loc = db.query(Location).filter_by(id=loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    loc.name = data.name
    db.commit()
    return {"id": loc.id, "name": loc.name}

@app.delete("/api/v1/locations/{loc_id}")
def delete_location(loc_id: str, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    loc = db.query(Location).filter_by(id=loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    db.delete(loc)
    db.commit()
    return {"status": "success"}

# Buildings CRUD APIs
@app.post("/api/v1/locations/{loc_id}/buildings")
def create_building(loc_id: str, data: BuildingCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    bld = Building(id=data.id, name=data.name, location_id=loc_id)
    db.add(bld)
    db.commit()
    return {"id": bld.id, "name": bld.name}

@app.put("/api/v1/locations/{loc_id}/buildings/{bld_id}")
def update_building(loc_id: str, bld_id: str, data: BuildingUpdate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    bld = db.query(Building).filter_by(id=bld_id, location_id=loc_id).first()
    if not bld:
        raise HTTPException(status_code=404, detail="Building not found")
    bld.name = data.name
    db.commit()
    return {"id": bld.id, "name": bld.name}

@app.delete("/api/v1/locations/{loc_id}/buildings/{bld_id}")
def delete_building(loc_id: str, bld_id: str, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    bld = db.query(Building).filter_by(id=bld_id, location_id=loc_id).first()
    if not bld:
        raise HTTPException(status_code=404, detail="Building not found")
    db.delete(bld)
    db.commit()
    return {"status": "success"}

# Floors CRUD APIs
@app.post("/api/v1/locations/{loc_id}/buildings/{bld_id}/floors")
def create_floor(loc_id: str, bld_id: str, data: FloorCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
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
def update_floor(loc_id: str, bld_id: str, flr_id: str, data: FloorUpdate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
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
def delete_floor(loc_id: str, bld_id: str, flr_id: str, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    flr = db.query(Floor).filter_by(id=flr_id, building_id=bld_id, location_id=loc_id).first()
    if not flr:
        raise HTTPException(status_code=404, detail="Floor not found")
    db.delete(flr)
    db.commit()
    return {"status": "success"}

# Air Conditioners CRUD APIs
@app.get("/api/v1/acs")
def get_acs(locationId: Optional[str] = None, buildingId: Optional[str] = None, floorId: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(AirConditioner)
    
    if current_user.role != "admin":
        assigned_ids = [assign.floor_id for assign in current_user.assignments]
        if floorId:
            if floorId not in assigned_ids:
                raise HTTPException(status_code=403, detail="คุณไม่มีสิทธิ์เข้าถึงชั้นข้อมูลนี้")
            query = query.filter_by(floor_id=floorId)
        else:
            query = query.filter(AirConditioner.floor_id.in_(assigned_ids)) if assigned_ids else query.filter(False)
            if locationId:
                query = query.filter_by(location_id=locationId)
    else:
        if floorId:
            query = query.filter_by(floor_id=floorId)
        if locationId:
            query = query.filter_by(location_id=locationId)
            
    if buildingId:
        query = query.filter_by(building_id=buildingId)
    
    return [ac_to_dict(ac) for ac in query.all()]

@app.get("/api/v1/acs/{ac_id}")
def get_single_ac(ac_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    check_floor_access(current_user, ac.floor_id, db)
    return ac_to_dict(ac)

@app.post("/api/v1/acs")
def create_ac(data: ACCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    check_floor_access(current_user, data.floorId, db)
    
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
        updated_at=data.updatedAt or datetime.now(timezone.utc).isoformat(),
        updated_by=current_user.full_name
    )
    db.add(ac)
    
    # Store images
    if data.images:
        for img in data.images:
            db.add(ACImage(ac_id=ac.id, image_data=img))
            
    # Auto initialize first history log
    db.add(MaintenanceLog(
        ac_id=ac.id,
        date=ac.install_date or datetime.now(timezone.utc).isoformat(),
        note=ac.note or "ติดตั้งเครื่องแอร์ใหม่เข้าระบบ",
        technician=ac.updated_by,
        status=ac.status
    ))
    
    db.commit()
    return ac_to_dict(ac)

@app.put("/api/v1/acs/{ac_id}")
def update_ac(ac_id: str, data: ACUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    check_floor_access(current_user, ac.floor_id, db)
        
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
        
    ac.updated_at = data.updatedAt or datetime.now(timezone.utc).isoformat()
    ac.updated_by = current_user.full_name
    
    # Update images
    if data.images is not None:
        # Clear existing and write new
        db.query(ACImage).filter_by(ac_id=ac.id).delete()
        for img in data.images:
            db.add(ACImage(ac_id=ac.id, image_data=img))
            
    db.commit()
    return ac_to_dict(ac)

@app.delete("/api/v1/acs/{ac_id}")
def delete_ac(ac_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    check_floor_access(current_user, ac.floor_id, db)
    db.delete(ac)
    db.commit()
    return {"status": "success"}

# Maintenance History APIs
@app.post("/api/v1/acs/{ac_id}/maintenance")
def create_maintenance_log(ac_id: str, data: LogCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    check_floor_access(current_user, ac.floor_id, db)
        
    log = MaintenanceLog(
        ac_id=ac.id,
        date=datetime.now(timezone.utc).isoformat(),
        note=data.note,
        technician=current_user.full_name,
        status=data.status
    )
    db.add(log)
    
    # Synchronize latest log data to the main AC record
    ac.status = data.status
    ac.note = data.note
    ac.updated_at = datetime.now(timezone.utc).isoformat()
    ac.updated_by = current_user.full_name
    
    db.commit()
    return ac_to_dict(ac)

@app.put("/api/v1/acs/{ac_id}/maintenance/{log_id}")
def update_maintenance_log(ac_id: str, log_id: int, data: LogCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    check_floor_access(current_user, ac.floor_id, db)
    log = db.query(MaintenanceLog).filter_by(id=log_id, ac_id=ac_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Maintenance log not found")
        
    log.note = data.note
    log.technician = current_user.full_name
    log.status = data.status
    
    # Synchronize latest log data to the main AC record
    ac.status = data.status
    ac.note = data.note
    ac.updated_at = datetime.now(timezone.utc).isoformat()
    ac.updated_by = current_user.full_name
    
    db.commit()
    return ac_to_dict(ac)

@app.delete("/api/v1/acs/{ac_id}/maintenance/{log_id}")
def delete_maintenance_log(ac_id: str, log_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ac = db.query(AirConditioner).filter_by(id=ac_id).first()
    if not ac:
        raise HTTPException(status_code=404, detail="Air conditioner not found")
    check_floor_access(current_user, ac.floor_id, db)
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
    ac.updated_at = datetime.now(timezone.utc).isoformat()
    
    db.commit()
    return ac_to_dict(ac)


# ==========================================
# USER MANAGEMENT REST APIs (ADMIN ONLY)
# ==========================================

import uuid

@app.post("/api/v1/admin/users")
def api_create_user(data: UserCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    # Check if username already exists
    exists = db.query(User).filter_by(username=data.username).first()
    if exists:
        raise HTTPException(status_code=400, detail="ชื่อผู้ใช้งานนี้มีอยู่ในระบบแล้ว")
        
    user = User(
        id=str(uuid.uuid4()),
        username=data.username,
        hashed_password=hash_password(data.password),
        role=data.role,
        full_name=data.full_name
    )
    db.add(user)
    db.commit()
    return {"status": "success", "user_id": user.id}

@app.delete("/api/v1/admin/users/{user_id}")
def api_delete_user(user_id: str, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="ไม่สามารถลบบัญชีของตัวเองได้")
        
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งานนี้")
        
    db.delete(user)
    db.commit()
    return {"status": "success"}

@app.post("/api/v1/admin/users/{user_id}/assignments")
def api_create_assignment(user_id: str, data: AssignmentCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งานนี้")
        
    # Check if assignment already exists
    exists = db.query(UserAssignment).filter_by(user_id=user_id, floor_id=data.floor_id).first()
    if exists:
        return {"status": "success", "message": "ได้รับสิทธิ์เข้าถึงชั้นข้อมูลนี้อยู่แล้ว"}
        
    assignment = UserAssignment(
        user_id=user_id,
        floor_id=data.floor_id
    )
    db.add(assignment)
    db.commit()
    return {"status": "success"}

@app.post("/api/v1/admin/users/{user_id}/assignments/bulk")
def api_create_assignments_bulk(user_id: str, data: BulkAssignmentCreate, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งานนี้")
        
    added_count = 0
    for f_id in data.floor_ids:
        exists = db.query(UserAssignment).filter_by(user_id=user_id, floor_id=f_id).first()
        if not exists:
            assignment = UserAssignment(
                user_id=user_id,
                floor_id=f_id
            )
            db.add(assignment)
            added_count += 1
            
    db.commit()
    return {"status": "success", "added_count": added_count}

@app.delete("/api/v1/admin/users/{user_id}/assignments/{floor_id}")
def api_delete_assignment(user_id: str, floor_id: str, current_user: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    assignment = db.query(UserAssignment).filter_by(user_id=user_id, floor_id=floor_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการมอบหมายงานนี้")
        
    db.delete(assignment)
    db.commit()
    return {"status": "success"}
