import json
import os
import argparse
import sys
import logging
from datetime import date

# Add root folder to sys.path to resolve scripts.import_po_xlsx
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.import_po_xlsx import parse_po_xlsx

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, date):
            return obj.isoformat()
        return super().default(obj)

def export_golden_json(excel_path, output_json_path):
    """
    Parses PO Excel and writes a clean JSON fixture representing the golden dataset.
    """
    parsed = parse_po_xlsx(excel_path)

    # Flatten items and summarize for easy comparison
    flat_items = []
    total_qty = 0

    for apt_type in parsed["apartment_types"]:
        for bom in apt_type["boms"]:
            flat_items.append({
                "apartment_type": apt_type["type_name"],
                "category": bom["category"],
                "item_no": bom["item_no"],
                "product_name": bom["product_name"],
                "product_code": bom["product_code"],
                "attribute_code": bom["attribute_code"],
                "width": bom["width"],
                "height": bom["height"],
                "depth": bom["depth"],
                "qty": bom["qty_sum"],
                "is_special": bom["is_special"],
                "remarks": bom["remarks"],
                "evidence": [
                    f"xlsx_row:{bom['item_no']}",
                    f"product_code:{bom['product_code']}",
                    f"attr_code:{bom['attribute_code']}"
                ]
            })
            total_qty += bom["qty_sum"]

    golden_structure = {
        "project": parsed["project"],
        "po_number": parsed["project"]["po_number"],
        "apartment_types": [t["type_name"] for t in parsed["apartment_types"]],
        "items": flat_items,
        "totals": {
            "total_apartment_types": len(parsed["apartment_types"]),
            "total_items_count": len(flat_items),
            "total_quantity": total_qty
        }
    }

    # Ensure directory exists
    dir_name = os.path.dirname(output_json_path)
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(golden_structure, f, ensure_ascii=False, indent=2, cls=DateTimeEncoder)

    logging.info("Successfully exported golden dataset to: %s", output_json_path)
    return golden_structure

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export Purchase Order Excel sheet into a Golden Dataset JSON fixture.")
    parser.add_argument("--file", required=True, help="Path to a local private Excel file to export.")
    parser.add_argument("--output", required=True, help="Output path for the JSON fixture. Keep private fixtures outside public Git.")
    args = parser.parse_args()

    try:
        export_golden_json(args.file, args.output)
        print(f"SUCCESS: Golden dataset JSON exported to {args.output}")
    except Exception as e:
        logging.exception("Failed to export golden dataset.")
        sys.exit(1)
