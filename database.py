import os
from sqlalchemy import create_engine, Column, String, Float, Integer, ForeignKey, Text, event
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

if TURSO_DATABASE_URL and TURSO_AUTH_TOKEN:
    # Connect to Turso Cloud Database
    db_url = TURSO_DATABASE_URL
    if db_url.startswith("libsql://"):
        db_url = db_url.replace("libsql://", "sqlite+libsql://")
    elif db_url.startswith("https://"):
        db_url = db_url.replace("https://", "sqlite+libsql://")
    elif not db_url.startswith("sqlite+"):
        db_url = f"sqlite+{db_url}"

    if "?" not in db_url:
        db_url = f"{db_url}?secure=true"
    elif "secure=" not in db_url:
        db_url = f"{db_url}&secure=true"

    engine = create_engine(
        db_url,
        connect_args={"auth_token": TURSO_AUTH_TOKEN}
    )
else:
    # Connect to local SQLite file
    DATABASE_URL = "sqlite:///db.sqlite"
    engine = create_engine(
        DATABASE_URL, 
        connect_args={"check_same_thread": False}
    )

    # Enable SQLite foreign key constraint support on connect
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Location(Base):
    __tablename__ = "locations"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    
    # Relationships (Cascades deletes)
    buildings = relationship("Building", back_populates="location", cascade="all, delete-orphan")
    floors = relationship("Floor", back_populates="location", cascade="all, delete-orphan")
    acs = relationship("AirConditioner", back_populates="location", cascade="all, delete-orphan")

class Building(Base):
    __tablename__ = "buildings"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    location_id = Column(String, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)
    
    # Relationships
    location = relationship("Location", back_populates="buildings")
    floors = relationship("Floor", back_populates="building", cascade="all, delete-orphan")
    acs = relationship("AirConditioner", back_populates="building", cascade="all, delete-orphan")

class Floor(Base):
    __tablename__ = "floors"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    building_id = Column(String, ForeignKey("buildings.id", ondelete="CASCADE"), nullable=False)
    location_id = Column(String, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)
    image_data = Column(Text, nullable=True) # Blueprint image (Base64 data url)
    
    # Relationships
    location = relationship("Location", back_populates="floors")
    building = relationship("Building", back_populates="floors")
    acs = relationship("AirConditioner", back_populates="floor", cascade="all, delete-orphan")

class AirConditioner(Base):
    __tablename__ = "air_conditioners"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    brand = Column(String, nullable=True)
    model = Column(String, nullable=True)
    type = Column(String, nullable=True)
    system_type = Column(String, nullable=True)
    btu = Column(String, nullable=True)
    status = Column(String, default="normal") # normal, check, repair, broken, inactive
    install_date = Column(String, nullable=True)
    serial_number = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    
    location_id = Column(String, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)
    building_id = Column(String, ForeignKey("buildings.id", ondelete="CASCADE"), nullable=False)
    floor_id = Column(String, ForeignKey("floors.id", ondelete="CASCADE"), nullable=False)
    
    room = Column(String, nullable=True)
    x = Column(Float, nullable=False) # X coordinate in percent (0 to 100)
    y = Column(Float, nullable=False) # Y coordinate in percent (0 to 100)
    
    updated_at = Column(String, nullable=True)
    updated_by = Column(String, nullable=True)
    
    # Relationships
    location = relationship("Location", back_populates="acs")
    building = relationship("Building", back_populates="acs")
    floor = relationship("Floor", back_populates="acs")
    images = relationship("ACImage", back_populates="ac", cascade="all, delete-orphan")
    maintenance_history = relationship("MaintenanceLog", back_populates="ac", cascade="all, delete-orphan")

class ACImage(Base):
    __tablename__ = "ac_images"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    ac_id = Column(String, ForeignKey("air_conditioners.id", ondelete="CASCADE"), nullable=False)
    image_data = Column(Text, nullable=False) # Base64 image data url
    
    # Relationships
    ac = relationship("AirConditioner", back_populates="images")

class MaintenanceLog(Base):
    __tablename__ = "maintenance_logs"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    ac_id = Column(String, ForeignKey("air_conditioners.id", ondelete="CASCADE"), nullable=False)
    date = Column(String, nullable=False)
    note = Column(Text, nullable=False)
    technician = Column(String, nullable=False)
    status = Column(String, nullable=False)
    
    # Relationships
    ac = relationship("AirConditioner", back_populates="maintenance_history")

# Create all database tables
def init_db():
    Base.metadata.create_all(bind=engine)
