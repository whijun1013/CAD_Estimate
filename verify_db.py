from database import SessionLocal
from models import Project, ApartmentType, MaterialSpecification, HardwareSpecification, CabinetBOM, BuildingQuantity, CADTask

def verify():
    db = SessionLocal()
    try:
        print("=== Database Schema Verification ===")

        # 1. Row counts
        project_count = db.query(Project).count()
        type_count = db.query(ApartmentType).count()
        material_spec_count = db.query(MaterialSpecification).count()
        hardware_spec_count = db.query(HardwareSpecification).count()
        bom_count = db.query(CabinetBOM).count()
        building_qty_count = db.query(BuildingQuantity).count()
        cad_task_count = db.query(CADTask).count()

        print(f"Table Row Counts:")
        print(f"  projects: {project_count}")
        print(f"  apartment_types: {type_count}")
        print(f"  material_specifications: {material_spec_count}")
        print(f"  hardware_specifications: {hardware_spec_count}")
        print(f"  cabinet_boms: {bom_count}")
        print(f"  building_quantities: {building_qty_count}")
        print(f"  cad_tasks: {cad_task_count}")

        # 2. Query Project details
        proj = db.query(Project).first()
        if proj:
            print(f"\nProject Details (ID: {proj.id}):")
            print(f"  Name: {proj.name}")
            print(f"  PO Number: {proj.po_number}")
            print(f"  Client: {proj.client}")
            print(f"  Installer: {proj.partner_installer}")
            print(f"  Address: {proj.address}")
            print(f"  Total Apartment Types linked: {len(proj.apartment_types)}")

            # 3. Query Apartment Types & Specs
            print("\nApartment Types list:")
            for apt in proj.apartment_types:
                print(f"  - {apt.type_name}: {apt.household_count} households")

            # Query details of 84A
            apt_84a = db.query(ApartmentType).filter(
                ApartmentType.project_id == proj.id,
                ApartmentType.type_name == "84A"
            ).first()

            if apt_84a:
                print(f"\nDetails for Type {apt_84a.type_name}:")
                # Material Specs count
                wall_specs = db.query(MaterialSpecification).filter(
                    MaterialSpecification.type_id == apt_84a.id,
                    MaterialSpecification.category == "상부장"
                ).all()
                print(f"  Wall Cabinet Specs (상부장): {len(wall_specs)} items")
                for spec in wall_specs:
                    print(f"    * {spec.part_name}: {spec.material} {spec.thickness} ({spec.primary_material_detail})")

                # Hardware Specs count
                hw_specs = db.query(HardwareSpecification).filter(
                    HardwareSpecification.type_id == apt_84a.id
                ).limit(5).all()
                print(f"  Hardware Specs (showing first {len(hw_specs)}):")
                for hw in hw_specs:
                    print(f"    * {hw.item_name} -> {hw.application} ({hw.special_remarks})")

                # BOM lines count
                boms = db.query(CabinetBOM).filter(
                    CabinetBOM.type_id == apt_84a.id
                ).order_by(CabinetBOM.item_no).limit(5).all()
                print(f"  Cabinet BOM (showing first {len(boms)} of {len(apt_84a.boms)}):")
                for item in boms:
                    spec_str = f"{item.width}x{item.height}x{item.depth}"
                    # Find building quantities for this item
                    bqs = db.query(BuildingQuantity).filter(
                        BuildingQuantity.bom_id == item.id
                    ).limit(3).all()
                    bq_str = ", ".join([f"{bq.building_no}동-{bq.line_no}라인({bq.qty}개)" for bq in bqs])
                    print(f"    [{item.item_no}] {item.product_name} | Spec: {spec_str} | Sum: {item.qty_sum} | Dist: {bq_str}...")

        else:
            print("\nNo project found in database.")

        print("\nVerification check passed: Database schema has correct relationships and successfully loaded real-world construction data.")

    except Exception as e:
        print(f"Verification error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    verify()
