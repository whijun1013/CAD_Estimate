import json
import os
import argparse
import sys
import logging
from copy import deepcopy

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def build_sample_actual_dataset(expected_json_path, output_json_path=None):
    """
    Builds a deterministic sample "actual" dataset from a public golden fixture.

    The generated dataset intentionally contains one unmatched item and one
    low-confidence matched item so evaluation metrics exercise missing,
    over-detected, and confidence-review paths without committing generated
    *_actual.json files to the repository.
    """
    if not os.path.exists(expected_json_path):
        raise FileNotFoundError(f"Expected golden dataset file not found: {expected_json_path}")

    with open(expected_json_path, "r", encoding="utf-8") as f:
        expected_data = json.load(f)

    actual_items = deepcopy(expected_data.get("items", []))
    if actual_items:
        over_item = actual_items[0]
        over_item["product_name"] = "__SAMPLE_OVER_DETECTED_ITEM__"
        over_item["item_name"] = "__SAMPLE_OVER_DETECTED_ITEM__"
        over_item["category"] = "__sample_over_detected__"
        over_item["product_code"] = "__SAMPLE__"
        over_item["confidence"] = 0.95

    if len(actual_items) > 1:
        actual_items[1]["confidence"] = 0.70

    actual_data = {
        "source": "generated_sample_actual",
        "expected_fixture": os.path.basename(expected_json_path),
        "items": actual_items,
    }

    if output_json_path:
        output_dir = os.path.dirname(output_json_path)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(actual_data, f, ensure_ascii=False, indent=2)

    return actual_data

def get_unit_price(product_name, category):
    """
    Attempts to fetch unit price from the CabinetPriceMaster database,
    falling back to standard category-based defaults if DB is unavailable.
    """
    try:
        # Import dynamically to avoid loading models/db unnecessarily
        sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from database import SessionLocal
        from models import CabinetPriceMaster
        db = SessionLocal()
        pm = db.query(CabinetPriceMaster).filter(CabinetPriceMaster.product_name == product_name).first()
        if pm:
            price = pm.unit_price
            db.close()
            return price
        db.close()
    except Exception:
        pass

    # Fallbacks from DB Price Seeding categories
    if category == "상부장":
        return 75000
    elif category == "하부장":
        return 95000
    elif category == "키큰장":
        return 120000
    else:
        return 45000

def evaluate(expected_json_path, actual_json_path, apartment_type_filter=None, dimension_tolerance_mm=10):
    """
    Evaluates actual analysis against expected golden dataset.
    """
    if not os.path.exists(expected_json_path):
        raise FileNotFoundError(f"Expected golden dataset file not found: {expected_json_path}")
    if not os.path.exists(actual_json_path):
        raise FileNotFoundError(f"Actual analysis file not found: {actual_json_path}")

    with open(expected_json_path, "r", encoding="utf-8") as f:
        expected_data = json.load(f)
    with open(actual_json_path, "r", encoding="utf-8") as f:
        actual_data = json.load(f)

    # Get items
    expected_items = expected_data.get("items", [])
    # Support both flat list or nested structure in actual
    actual_items = actual_data.get("items", [])
    if isinstance(actual_data, dict) and "items" not in actual_data:
        # Check if actual is raw task structure
        if "structured_analysis" in actual_data:
            struct = actual_data["structured_analysis"]
            if isinstance(struct, str):
                try:
                    struct = json.loads(struct)
                except Exception:
                    struct = {}
            actual_items = struct.get("items", [])

    ambiguous_actual_items = []

    # Track items with missing apartment_type for warnings/metrics
    for it in actual_items:
        if not it.get("apartment_type"):
            ambiguous_actual_items.append(it)

    # Filter expected and actual items by apartment type symmetrically
    if apartment_type_filter:
        expected_items = [it for it in expected_items if it.get("apartment_type") == apartment_type_filter]

        # When evaluating a specific apartment type, isolate actual items lacking apartment_type
        # and ignore items belonging to other apartment types entirely
        evaluated_actual_items = []
        for it in actual_items:
            apt_type = it.get("apartment_type")
            if apt_type == apartment_type_filter:
                evaluated_actual_items.append(it)

        actual_items = evaluated_actual_items
    else:
        # For overall evaluation, evaluate all items
        pass

    total_expected = len(expected_items)
    total_actual = len(actual_items)

    matched_pairs = []
    missing_items = []
    over_detected_items = []
    low_confidence_items = []

    # Track which actual items have been matched
    matched_actual_indices = set()

    for exp_item in expected_items:
        # Try to find a match in actual items
        best_match_idx = None
        best_match_score = -1 # Higher is better

        for idx, act_item in enumerate(actual_items):
            if idx in matched_actual_indices:
                continue

            # Compute match score based on product_name / category similarity
            score = 0

            # Match product name
            exp_name = exp_item.get("product_name", "").strip()
            act_name = act_item.get("product_name", act_item.get("item_name", "")).strip()
            exp_cat = exp_item.get("category", "").strip()
            act_cat = act_item.get("category", "").strip()

            if exp_name == act_name:
                score += 10
            elif exp_name in act_name or act_name in exp_name:
                score += 5

            if exp_cat == act_cat:
                score += 3

            if score > 0 and score > best_match_score:
                best_match_score = score
                best_match_idx = idx

        if best_match_idx is not None and best_match_score >= 5:
            matched_actual_indices.add(best_match_idx)
            act_item = actual_items[best_match_idx]
            matched_pairs.append((exp_item, act_item))

            # Check confidence
            conf = act_item.get("confidence", 1.0)
            if conf < 0.8:
                low_confidence_items.append({
                    "product_name": act_name,
                    "confidence": conf,
                    "category": act_cat
                })
        else:
            missing_items.append(exp_item)

    # Unmatched actuals are over-detected
    for idx, act_item in enumerate(actual_items):
        if idx not in matched_actual_indices:
            over_detected_items.append(act_item)

    # Sizing, Dimension match tolerance, and Quantity evaluation for matched pairs
    width_errors = []
    height_errors = []
    depth_errors = []
    qty_errors = []
    dimension_matches = 0

    product_code_matches = 0
    product_code_total = 0

    for exp, act in matched_pairs:
        # expected sizes
        exp_w = exp.get("width")
        exp_h = exp.get("height")
        exp_d = exp.get("depth")
        exp_qty = exp.get("qty", 0)

        # actual sizes
        act_w = act.get("width_mm", act.get("width"))
        act_h = act.get("height_mm", act.get("height"))
        act_d = act.get("depth_mm", act.get("depth"))
        act_qty = act.get("quantity", act.get("qty", 0))

        # Sizing checks
        w_err = abs(exp_w - act_w) if exp_w is not None and act_w is not None else 9999
        h_err = abs(exp_h - act_h) if exp_h is not None and act_h is not None else 9999
        d_err = abs(exp_d - act_d) if exp_d is not None and act_d is not None else 9999

        if exp_w is not None and act_w is not None:
            width_errors.append(w_err)
        if exp_h is not None and act_h is not None:
            height_errors.append(h_err)
        if exp_d is not None and act_d is not None:
            depth_errors.append(d_err)
        if exp_qty is not None and act_qty is not None:
            qty_errors.append(act_qty - exp_qty)

        # Tolerance calculation
        if w_err <= dimension_tolerance_mm and h_err <= dimension_tolerance_mm and d_err <= dimension_tolerance_mm:
            dimension_matches += 1

        # Product code match
        exp_code = exp.get("product_code")
        act_code = act.get("product_code")
        if exp_code:
            product_code_total += 1
            if exp_code == act_code:
                product_code_matches += 1

    # Calculate statistics
    num_matched = len(matched_pairs)
    match_rate = num_matched / total_expected if total_expected > 0 else 0
    code_match_rate = product_code_matches / product_code_total if product_code_total > 0 else 0
    dimension_match_rate = dimension_matches / num_matched if num_matched > 0 else 0

    # Precision, Recall, F1 calculations
    precision = num_matched / total_actual if total_actual > 0 else 0.0
    recall = num_matched / total_expected if total_expected > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    avg_w_error = sum(width_errors) / len(width_errors) if width_errors else 0
    avg_h_error = sum(height_errors) / len(height_errors) if height_errors else 0
    avg_d_error = sum(depth_errors) / len(depth_errors) if depth_errors else 0
    total_qty_error = sum(qty_errors)

    # Sizing quantity error rate: total abs deviations / total expected qty
    expected_qty_total = sum(item.get("qty", 0) for item in expected_items)
    abs_qty_deviation = (
        sum(abs(act.get("quantity", act.get("qty", 0)) - exp.get("qty", 0)) for exp, act in matched_pairs) +
        sum(it.get("qty", 0) for it in missing_items) +
        sum(it.get("quantity", it.get("qty", 0)) for it in over_detected_items)
    )
    quantity_error_rate = (abs_qty_deviation / expected_qty_total) * 100 if expected_qty_total > 0 else 0.0

    # Amount error rate: total abs amount deviations / total expected amount
    expected_amount_total = sum(
        item.get("qty", 0) * get_unit_price(item.get("product_name"), item.get("category"))
        for item in expected_items
    )

    matched_amount_dev = sum(
        abs(
            act.get("quantity", act.get("qty", 0)) * get_unit_price(act.get("product_name", act.get("item_name")), act.get("category")) -
            exp.get("qty", 0) * get_unit_price(exp.get("product_name"), exp.get("category"))
        )
        for exp, act in matched_pairs
    )
    missing_amount_dev = sum(
        item.get("qty", 0) * get_unit_price(item.get("product_name"), item.get("category"))
        for item in missing_items
    )
    over_amount_dev = sum(
        item.get("quantity", item.get("qty", 0)) * get_unit_price(item.get("product_name", item.get("item_name")), item.get("category"))
        for item in over_detected_items
    )

    abs_amount_deviation = matched_amount_dev + missing_amount_dev + over_amount_dev
    amount_error_rate = (abs_amount_deviation / expected_amount_total) * 100 if expected_amount_total > 0 else 0.0

    report = {
        "apartment_type_filter": apartment_type_filter,
        "summary": {
            "total_expected_items": total_expected,
            "total_actual_items": total_actual,
            "matched_items": num_matched,
            "missing_items_count": len(missing_items),
            "over_detected_items_count": len(over_detected_items),
            "product_name_match_rate": round(match_rate * 100, 2),
            "product_code_match_rate": round(code_match_rate * 100, 2),
            "precision": round(precision * 100, 2),
            "recall": round(recall * 100, 2),
            "f1_score": round(f1 * 100, 2),
            "dimension_match_rate": round(dimension_match_rate * 100, 2),
            "avg_width_error_mm": round(avg_w_error, 2),
            "avg_height_error_mm": round(avg_h_error, 2),
            "avg_depth_error_mm": round(avg_d_error, 2),
            "total_qty_deviation": total_qty_error,
            "quantity_error_rate": round(quantity_error_rate, 2),
            "amount_error_rate": round(amount_error_rate, 2),
            "low_confidence_count": len(low_confidence_items),
            "ambiguous_actual_count": len(ambiguous_actual_items)
        },
        "missing_items": [
            {
                "product_name": it.get("product_name"),
                "category": it.get("category"),
                "width": it.get("width"),
                "height": it.get("height"),
                "depth": it.get("depth"),
                "qty": it.get("qty")
            } for it in missing_items
        ],
        "over_detected_items": [
            {
                "product_name": it.get("product_name", it.get("item_name")),
                "category": it.get("category"),
                "width": it.get("width_mm", it.get("width")),
                "height": it.get("height_mm", it.get("height")),
                "depth": it.get("depth_mm", it.get("depth")),
                "qty": it.get("quantity", it.get("qty"))
            } for it in over_detected_items
        ],
        "low_confidence_items": low_confidence_items,
        "ambiguous_actual_items": [
            {
                "product_name": it.get("product_name", it.get("item_name")),
                "category": it.get("category"),
                "qty": it.get("quantity", it.get("qty"))
            } for it in ambiguous_actual_items
        ]
    }

    return report

def print_console_summary(report):
    print("==================================================")
    print("          AI ANALYSIS EVALUATION REPORT           ")
    print("==================================================")
    f = report["apartment_type_filter"]
    print(f"Filter Apartment Type : {f if f else 'ALL'}")
    print("--------------------------------------------------")
    summary = report["summary"]
    print(f"Expected Items Count  : {summary['total_expected_items']}")
    print(f"Actual Items Count    : {summary['total_actual_items']}")
    print(f"Matched Items         : {summary['matched_items']}")
    print(f"Missing Items         : {summary['missing_items_count']}")
    print(f"Over-detected Items   : {summary['over_detected_items_count']}")
    print(f"Precision             : {summary['precision']}%")
    print(f"Recall                : {summary['recall']}%")
    print(f"F1-Score              : {summary['f1_score']}%")
    print(f"Dimension Match Rate  : {summary['dimension_match_rate']}%")
    print(f"Name Match Rate       : {summary['product_name_match_rate']}%")
    print(f"Code Match Rate       : {summary['product_code_match_rate']}%")
    print("--------------------------------------------------")
    print(f"Average Width Error   : {summary['avg_width_error_mm']} mm")
    print(f"Average Height Error  : {summary['avg_height_error_mm']} mm")
    print(f"Average Depth Error   : {summary['avg_depth_error_mm']} mm")
    print(f"Total Qty Deviation   : {summary['total_qty_deviation']} pcs")
    print(f"Quantity Error Rate   : {summary['quantity_error_rate']}%")
    print(f"Amount Error Rate     : {summary['amount_error_rate']}%")
    print(f"Low Confidence Items  : {summary['low_confidence_count']}")
    print(f"Ambiguous Actual Items: {summary['ambiguous_actual_count']}")
    if summary["ambiguous_actual_count"] > 0:
        print("[WARN] Some actual items lack 'apartment_type' metadata!")
    print("==================================================")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate AI analysis result against expected golden dataset.")
    parser.add_argument("--expected", default="tests/fixtures/golden/po_synthetic_sample.json", help="Path to golden dataset JSON.")
    parser.add_argument("--actual", required=True, help="Path to actual analysis result JSON.")
    parser.add_argument("--apartment-type", default=None, help="Filter evaluation by apartment type (e.g. 84A).")
    parser.add_argument("--dimension-tolerance-mm", type=int, default=10, help="Dimension matching tolerance in mm.")
    parser.add_argument("--output", default=None, help="Path to save evaluation report JSON.")
    args = parser.parse_args()

    try:
        report = evaluate(args.expected, args.actual, args.apartment_type, args.dimension_tolerance_mm)
        print_console_summary(report)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            print(f"Report saved to: {args.output}")
    except Exception as e:
        logging.exception("Evaluation failed.")
        sys.exit(1)
