"""
model/train_model.py
────────────────────
Trains a lightweight ML model that predicts a recommended shot STATUS
("Printed" / "No Good" / "Pending") based on shot metadata.

Usage:
    python model/train_model.py

Output:
    model/model.pkl
"""

import pickle
import os
from sklearn.tree import DecisionTreeClassifier
from sklearn.preprocessing import LabelEncoder
import numpy as np

# ── Synthetic training data ────────────────────────────────────────────────────
# Each row: [shot_size, camera_angle, movement, num_takes]  → label
# shot_size   : 0=WS, 1=MS, 2=CU, 3=ECU, 4=OTS
# camera_angle: 0=Eye Level, 1=High Angle, 2=Low Angle, 3=Dutch Angle
# movement    : 0=Static, 1=Pan, 2=Tilt, 3=Dolly, 4=Steadicam, 5=Handheld
# num_takes   : integer count

TRAINING_ROWS = [
    # [size, angle, movement, takes] → status
    [0, 0, 0, 1], [0, 0, 0, 2], [1, 0, 0, 1], [1, 0, 1, 2],
    [2, 0, 0, 1], [2, 1, 0, 3], [3, 0, 0, 2], [3, 2, 0, 1],
    [4, 0, 0, 1], [4, 0, 1, 2], [1, 3, 5, 4], [0, 2, 3, 3],
    [2, 3, 5, 5], [3, 3, 5, 6], [1, 1, 4, 3], [2, 2, 3, 2],
    [0, 0, 2, 1], [1, 0, 2, 2], [4, 1, 1, 3], [3, 2, 4, 4],
    [2, 0, 0, 1], [2, 0, 0, 2], [1, 0, 0, 1], [0, 0, 0, 3],
    [3, 1, 0, 2], [4, 2, 1, 1], [2, 3, 5, 7], [1, 3, 5, 5],
    [0, 2, 3, 4], [3, 0, 4, 2],
]

LABELS = [
    "Printed", "Printed", "Printed", "Printed",
    "Printed", "Pending", "Printed", "Printed",
    "Printed", "Pending", "No Good", "Pending",
    "No Good", "No Good", "Pending", "Printed",
    "Printed", "Printed", "Pending", "No Good",
    "Printed", "Printed", "Printed", "Pending",
    "Printed", "Printed", "No Good", "No Good",
    "No Good", "Printed",
]

# ── Encoders ──────────────────────────────────────────────────────────────────
SHOT_SIZE_MAP    = {"Wide Shot (WS)": 0, "Medium Shot (MS)": 1,
                    "Close Up (CU)": 2, "Extreme Close Up (ECU)": 3,
                    "Over the Shoulder (OTS)": 4}
CAMERA_ANGLE_MAP = {"Eye Level": 0, "High Angle": 1,
                    "Low Angle": 2, "Dutch Angle": 3}
MOVEMENT_MAP     = {"Static": 0, "Pan": 1, "Tilt": 2,
                    "Dolly": 3, "Steadicam": 4, "Handheld": 5}

label_enc = LabelEncoder()
label_enc.fit(["No Good", "Pending", "Printed"])

# ── Train ─────────────────────────────────────────────────────────────────────
X = np.array(TRAINING_ROWS, dtype=float)
y = label_enc.transform(LABELS)

clf = DecisionTreeClassifier(max_depth=6, random_state=42)
clf.fit(X, y)

# ── Save ──────────────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.pkl")
with open(MODEL_PATH, "wb") as f:
    pickle.dump(
        {
            "classifier"      : clf,
            "label_encoder"   : label_enc,
            "shot_size_map"   : SHOT_SIZE_MAP,
            "camera_angle_map": CAMERA_ANGLE_MAP,
            "movement_map"    : MOVEMENT_MAP,
        },
        f,
    )

print(f"[train_model] Model saved → {MODEL_PATH}")
print(f"[train_model] Classes     : {label_enc.classes_}")
print(f"[train_model] Train acc   : {clf.score(X, y):.2%}")
