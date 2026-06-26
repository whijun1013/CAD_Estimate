"""
Generate synthetic DXF test fixtures for EzdxfVectorExtractor testing.
Run this script to create test DXF files in tests/fixtures/.
"""
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ezdxf


def create_kitchen_fixture(output_path: str):
    """Create a synthetic DXF file with kitchen cabinet elements."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # --- Layer setup ---
    doc.layers.add("FURN_UPPER", color=3)     # Green
    doc.layers.add("FURN_LOWER", color=1)     # Red
    doc.layers.add("FURN_REF", color=5)       # Blue
    doc.layers.add("FURN_FINISH", color=4)    # Cyan
    doc.layers.add("DIM", color=7)            # White
    doc.layers.add("TEXT", color=7)

    # --- Block definitions ---
    # Upper cabinet block
    upper_block = doc.blocks.new(name="UPPER_CAB_800")
    upper_block.add_line((0, 0), (800, 0))
    upper_block.add_line((800, 0), (800, 700))
    upper_block.add_line((800, 700), (0, 700))
    upper_block.add_line((0, 700), (0, 0))

    # Lower cabinet block
    lower_block = doc.blocks.new(name="LOWER_CAB_800")
    lower_block.add_line((0, 0), (800, 0))
    lower_block.add_line((800, 0), (800, 850))
    lower_block.add_line((800, 850), (0, 850))
    lower_block.add_line((0, 850), (0, 0))

    # Refrigerator flap block
    flap_block = doc.blocks.new(name="FLAP_1000")
    flap_block.add_line((0, 0), (1000, 0))
    flap_block.add_line((1000, 0), (1000, 600))
    flap_block.add_line((1000, 600), (0, 600))
    flap_block.add_line((0, 600), (0, 0))

    # --- Insert block references ---
    msp.add_blockref("UPPER_CAB_800", insert=(100, 2000), dxfattribs={"layer": "FURN_UPPER"})
    msp.add_blockref("UPPER_CAB_800", insert=(1000, 2000), dxfattribs={"layer": "FURN_UPPER"})
    msp.add_blockref("LOWER_CAB_800", insert=(100, 0), dxfattribs={"layer": "FURN_LOWER"})
    msp.add_blockref("FLAP_1000", insert=(2000, 2000), dxfattribs={"layer": "FURN_REF"})

    # --- Text entities ---
    msp.add_text("상부장 W800", dxfattribs={
        "layer": "TEXT", "height": 30, "insert": (100, 2750)
    })
    msp.add_text("하부장 W800", dxfattribs={
        "layer": "TEXT", "height": 30, "insert": (100, -50)
    })
    msp.add_text("냉장고 플랩장 W1000", dxfattribs={
        "layer": "TEXT", "height": 30, "insert": (2000, 2650)
    })
    msp.add_text("걸레받이 L1200", dxfattribs={
        "layer": "TEXT", "height": 20, "insert": (100, -120)
    })
    msp.add_text("좌측 마감판넬 W310", dxfattribs={
        "layer": "FURN_FINISH", "height": 20, "insert": (50, 1000)
    })

    # --- MTEXT entity ---
    msp.add_mtext("코니스 상부 휠라 L2521", dxfattribs={
        "layer": "FURN_FINISH", "insert": (100, 3000)
    })

    # --- Dimension entities ---
    # Linear dimension for upper cabinet width
    msp.add_linear_dim(
        base=(100, 2800),
        p1=(100, 2700),
        p2=(900, 2700),
        dimstyle="EZDXF",
        dxfattribs={"layer": "DIM"}
    ).render()

    # --- Line entities (wall outlines) ---
    msp.add_line((0, 0), (3500, 0), dxfattribs={"layer": "0"})
    msp.add_line((3500, 0), (3500, 3200), dxfattribs={"layer": "0"})
    msp.add_line((3500, 3200), (0, 3200), dxfattribs={"layer": "0"})
    msp.add_line((0, 3200), (0, 0), dxfattribs={"layer": "0"})

    # --- LWPOLYLINE (countertop) ---
    msp.add_lwpolyline(
        [(100, 850), (2500, 850), (2500, 900), (100, 900)],
        close=True,
        dxfattribs={"layer": "FURN_LOWER"}
    )

    doc.saveas(output_path)
    print(f"Created: {output_path}")


def create_shoe_cabinet_fixture(output_path: str):
    """Create a synthetic DXF file with shoe cabinet elements."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    doc.layers.add("FURN_SHOE", color=2)
    doc.layers.add("FURN_FINISH", color=4)
    doc.layers.add("TEXT", color=7)

    # Shoe cabinet block
    shoe_block = doc.blocks.new(name="SHOE_BOX_1200")
    shoe_block.add_line((0, 0), (1200, 0))
    shoe_block.add_line((1200, 0), (1200, 2100))
    shoe_block.add_line((1200, 2100), (0, 2100))
    shoe_block.add_line((0, 2100), (0, 0))

    msp.add_blockref("SHOE_BOX_1200", insert=(200, 0), dxfattribs={"layer": "FURN_SHOE"})

    msp.add_text("신발장 W1200", dxfattribs={
        "layer": "TEXT", "height": 30, "insert": (300, 2200)
    })
    msp.add_text("걸레받이 L1200", dxfattribs={
        "layer": "FURN_FINISH", "height": 20, "insert": (300, -50)
    })

    doc.saveas(output_path)
    print(f"Created: {output_path}")


if __name__ == "__main__":
    fixtures_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
    os.makedirs(fixtures_dir, exist_ok=True)

    create_kitchen_fixture(os.path.join(fixtures_dir, "synthetic_kitchen.dxf"))
    create_shoe_cabinet_fixture(os.path.join(fixtures_dir, "synthetic_shoe.dxf"))
    print("All fixtures created successfully.")
