from sqlalchemy import Column, Integer, String, Boolean, Date, Text, DateTime, ForeignKey, Float
from sqlalchemy.orm import relationship
import datetime
from database import Base

def utc_naive():
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    po_number = Column(String, unique=True, index=True, nullable=False) # P/O번호
    contract_number = Column(String, nullable=True) # 계약번호
    name = Column(String, nullable=False) # 현장명
    client = Column(String, nullable=True) # 거래선
    partner_installer = Column(String, nullable=True) # 시공거래선
    item_type = Column(String, nullable=True) # 품목 (e.g., 빌트인주방)
    address = Column(String, nullable=True) # 현장 주소
    manager_name = Column(String, nullable=True) # 현장담당자
    manager_contact = Column(String, nullable=True) # 현장연락처
    installer_name = Column(String, nullable=True) # 시공담당자
    installer_contact = Column(String, nullable=True) # 시공연락처
    first_delivery_date = Column(Date, nullable=True) # 최초투입일
    opening_date = Column(Date, nullable=True) # 입주/오픈예정일
    site_type = Column(String, nullable=True) # 현장종류 (e.g., 일반APT)
    max_floor = Column(Integer, nullable=True) # 최고층높이
    is_divided_work = Column(Boolean, default=False) # 분절공사 여부 (Y/N)
    remarks = Column(Text, nullable=True) # 현장특기사항

    created_at = Column(DateTime, default=utc_naive)
    updated_at = Column(DateTime, default=utc_naive, onupdate=utc_naive)

    # Relationships
    apartment_types = relationship("ApartmentType", back_populates="project", cascade="all, delete-orphan")
    cad_tasks = relationship("CADTask", back_populates="project", cascade="all, delete-orphan")


class ApartmentType(Base):
    __tablename__ = "apartment_types"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    type_name = Column(String, nullable=False, index=True) # 평형명 (e.g., 84A, 84AS, 110)
    household_count = Column(Integer, default=0) # 세대수
    is_changed = Column(Boolean, default=False) # 변경여부

    created_at = Column(DateTime, default=utc_naive)
    updated_at = Column(DateTime, default=utc_naive, onupdate=utc_naive)

    # Relationships
    project = relationship("Project", back_populates="apartment_types")
    material_specs = relationship("MaterialSpecification", back_populates="apartment_type", cascade="all, delete-orphan")
    hardware_specs = relationship("HardwareSpecification", back_populates="apartment_type", cascade="all, delete-orphan")
    boms = relationship("CabinetBOM", back_populates="apartment_type", cascade="all, delete-orphan")


class MaterialSpecification(Base):
    __tablename__ = "material_specifications"

    id = Column(Integer, primary_key=True, index=True)
    type_id = Column(Integer, ForeignKey("apartment_types.id", ondelete="CASCADE"), nullable=False)
    category = Column(String, nullable=False, index=True) # 구분 (상부장, 하부장, 키큰장, 보조주방 등)
    part_name = Column(String, nullable=False) # 부위명 (몸통, 코니스, 문짝, 앤드판넬, 휠라, 걸레받이 등)

    # Material Spec Details
    thickness = Column(String, nullable=True) # 두께 (e.g. 15 T, 18 T)
    grade = Column(String, nullable=True) # 등급 (e.g. E0)
    material = Column(String, nullable=True) # 소재 (e.g. PB, MDF)
    finish_method = Column(String, nullable=True) # 가공방법 / 마감방법 (e.g. 접착(양면))
    grain_direction = Column(String, nullable=True) # 무늬결방향 (e.g. 없음)

    primary_material = Column(String, nullable=True) # 주마감재 소재 (e.g. LPM, PET)
    primary_material_detail = Column(String, nullable=True) # 주마감재 모델NO/수종/색/기타

    backing_material = Column(String, nullable=True) # 배면재 소재
    backing_material_detail = Column(String, nullable=True) # 배면재 모델NO/수종/색/기타

    edge_material = Column(String, nullable=True) # 엣지재 소재
    edge_material_detail = Column(String, nullable=True) # 엣지재 모델NO/수종/색

    created_at = Column(DateTime, default=utc_naive)

    # Relationships
    apartment_type = relationship("ApartmentType", back_populates="material_specs")


class HardwareSpecification(Base):
    __tablename__ = "hardware_specifications"

    id = Column(Integer, primary_key=True, index=True)
    type_id = Column(Integer, ForeignKey("apartment_types.id", ondelete="CASCADE"), nullable=False)
    item_group = Column(String, nullable=False, index=True) # 구분 (사양, 하부장, 키큰장 등)
    item_name = Column(String, nullable=False) # 항목 (바디출고사양, 뎀필형태, 힌지, 실린더, 특기사항 등)
    application = Column(String, nullable=True) # 적용값 (e.g. K/D, 수입힌지일체형댐퍼)
    special_remarks = Column(Text, nullable=True) # 특기사항 및 상세내용

    created_at = Column(DateTime, default=utc_naive)

    # Relationships
    apartment_type = relationship("ApartmentType", back_populates="hardware_specs")


class CabinetBOM(Base):
    __tablename__ = "cabinet_boms"

    id = Column(Integer, primary_key=True, index=True)
    type_id = Column(Integer, ForeignKey("apartment_types.id", ondelete="CASCADE"), nullable=False)
    category = Column(String, nullable=False, index=True) # 구분 (상부장, 하부장, 키큰장, 보조주방 등)
    status = Column(String, nullable=True) # 상태 (신규, 변경, 유지 등)
    is_special = Column(Boolean, default=False) # 비규격 여부 (S 여부)
    item_no = Column(Integer, nullable=False) # 순번 (NO)
    product_name = Column(String, nullable=False) # 제품명 (e.g. 삼각휠라, 상부장)
    product_code = Column(String, nullable=True) # 제품코드 (e.g. B000953)
    attribute_code = Column(String, nullable=True) # 속성코드 (e.g. WM-100*800)

    # Specs
    width = Column(Integer, nullable=True) # 규격 - 폭
    height = Column(Integer, nullable=True) # 규격 - 높이
    depth = Column(Integer, nullable=True) # 규격 - 깊이
    width_source = Column(String, nullable=True)
    height_source = Column(String, nullable=True)
    depth_source = Column(String, nullable=True)

    base_direction = Column(String, nullable=True) # 기준방향 (좌, 우, 중)

    # Quantities
    qty_drawing_left = Column(Integer, default=0) # 도면방향 - 좌
    qty_drawing_mid = Column(Integer, default=0) # 도면방향 - 중
    qty_drawing_right = Column(Integer, default=0) # 도면방향 - 우
    qty_opposite_left = Column(Integer, default=0) # 도면반대 - 좌
    qty_opposite_mid = Column(Integer, default=0) # 도면반대 - 중
    qty_opposite_right = Column(Integer, default=0) # 도면반대 - 우
    qty_sum = Column(Integer, default=0) # 합계

    remarks = Column(Text, nullable=True) # 특기사항

    created_at = Column(DateTime, default=utc_naive)
    updated_at = Column(DateTime, default=utc_naive, onupdate=utc_naive)

    # Relationships
    apartment_type = relationship("ApartmentType", back_populates="boms")
    building_quantities = relationship("BuildingQuantity", back_populates="bom", cascade="all, delete-orphan")


class BuildingQuantity(Base):
    __tablename__ = "building_quantities"

    id = Column(Integer, primary_key=True, index=True)
    bom_id = Column(Integer, ForeignKey("cabinet_boms.id", ondelete="CASCADE"), nullable=False)
    building_no = Column(String, nullable=False, index=True) # 동 (e.g., "101")
    line_no = Column(String, nullable=False) # 라인 (e.g., "1-2")
    qty = Column(Integer, default=0) # 수량

    created_at = Column(DateTime, default=utc_naive)

    # Relationships
    bom = relationship("CabinetBOM", back_populates="building_quantities")


class CADTask(Base):
    __tablename__ = "cad_tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    file_name = Column(String, nullable=False) # 원본 파일명
    file_path = Column(String, nullable=False) # 저장 경로
    pdf_path = Column(String, nullable=True) # 변환된 PDF 경로
    file_size = Column(Integer, nullable=True) # 파일 크기 (bytes)
    mime_type = Column(String, nullable=True) # MIME 타입
    status = Column(String, default="PENDING") # 작업 상태 (PENDING, RUNNING, COMPLETED, FAILED)
    error_message = Column(Text, nullable=True) # 에러 메시지
    ai_raw_response = Column(Text, nullable=True) # AI Raw Response
    structured_analysis = Column(Text, nullable=True) # 구조화된 AI 분석 결과 JSON

    started_at = Column(DateTime, nullable=True) # 분석 시작 시간
    completed_at = Column(DateTime, nullable=True) # 분석 완료 시간
    created_at = Column(DateTime, default=utc_naive)
    updated_at = Column(DateTime, default=utc_naive, onupdate=utc_naive)

    # Relationships
    project = relationship("Project", back_populates="cad_tasks")
    quotation = relationship("Quotation", uselist=False, back_populates="task", cascade="all, delete-orphan")


class CabinetPriceMaster(Base):
    __tablename__ = "cabinet_price_masters"

    id = Column(Integer, primary_key=True, index=True)
    product_code = Column(String, unique=True, index=True, nullable=True)
    product_name = Column(String, nullable=False, index=True)
    category = Column(String, nullable=False)
    unit_price = Column(Integer, default=0) # 기준 단가
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utc_naive)


class Quotation(Base):
    __tablename__ = "quotations"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("cad_tasks.id", ondelete="CASCADE"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    doc_number = Column(String, unique=True, index=True, nullable=False)
    date = Column(Date, nullable=False)
    total_amount = Column(Integer, default=0) # 공급가액 합계
    vat_amount = Column(Integer, default=0) # 부가세액
    grand_total = Column(Integer, default=0) # 최종 청구합계액
    status = Column(String, default="DRAFT") # DRAFT, CONFIRMED
    remarks = Column(Text, nullable=True)

    # New Pricing Configuration
    surcharge_rate = Column(Float, default=0.30)
    vat_rate = Column(Float, default=0.10)
    contingency_amount = Column(Integer, default=0)
    installation_fee = Column(Integer, default=0)
    transportation_fee = Column(Integer, default=0)

    created_at = Column(DateTime, default=utc_naive)
    updated_at = Column(DateTime, default=utc_naive, onupdate=utc_naive)

    # Relationships
    project = relationship("Project")
    task = relationship("CADTask", back_populates="quotation")
    items = relationship("QuotationItem", back_populates="quotation", cascade="all, delete-orphan")


class QuotationItem(Base):
    __tablename__ = "quotation_items"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    item_no = Column(Integer, nullable=False)
    category = Column(String, nullable=False)
    item_name = Column(String, nullable=False)
    spec = Column(String, nullable=True) # W*D*H
    qty = Column(Integer, default=0)
    unit = Column(String, default="EA")
    unit_price = Column(Integer, default=0)
    sum_price = Column(Integer, default=0)
    is_special = Column(Boolean, default=False)
    remarks = Column(Text, nullable=True)

    # AI Pipeline Metadata
    confidence = Column(Float, nullable=True, default=1.0)
    source_evidence = Column(Text, nullable=True)
    bounding_box = Column(String, nullable=True)
    original_text = Column(String, nullable=True)
    needs_manual_review = Column(Boolean, default=False)
    width_inferred = Column(Boolean, default=False)
    height_inferred = Column(Boolean, default=False)
    depth_inferred = Column(Boolean, default=False)

    # New Pricing Fields
    price_source = Column(String, nullable=True)
    price_confidence = Column(Float, nullable=True)
    pricing_remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utc_naive)

    # Relationships
    quotation = relationship("Quotation", back_populates="items")
    # NOTE: cascade does NOT include delete-orphan for audits so that
    # deletion audit records survive item deletion (SET NULL on FK).
    audits = relationship("QuotationItemAudit", back_populates="quotation_item",
                          cascade="save-update, merge",
                          passive_deletes=True)


class QuotationItemAudit(Base):
    __tablename__ = "quotation_item_audits"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    # nullable=True + SET NULL allows deletion-audit rows to survive
    # after the parent QuotationItem is deleted, preserving full audit history.
    quotation_item_id = Column(Integer, ForeignKey("quotation_items.id", ondelete="SET NULL"), nullable=True)
    field_name = Column(String, nullable=False)  # e.g., qty, unit_price, item_name, needs_manual_review, item_deleted
    old_value = Column(String, nullable=True)
    new_value = Column(String, nullable=True)
    source = Column(String, default="user_edit")  # user_edit | ai_suggestion | import
    created_at = Column(DateTime, default=utc_naive)

    # Relationships
    quotation = relationship("Quotation")
    quotation_item = relationship("QuotationItem", back_populates="audits")
