"""
model/predict.py
────────────────
Loads model.pkl and exposes two public functions used by app.py:

    load_model()            → dict | None
    predict_shot(model, d)  → str  (human-readable suggestion)
"""

import pickle
import os
import numpy as np

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.pkl")

# ── Rule-based fallback (used when model.pkl is absent) ──────────────────────
_RULES = {
    # (movement, num_takes_threshold) → suggestion
    "Handheld"  : "Handheld shots often need extra takes — consider a Steadicam pass.",
    "Dutch Angle": "Dutch angles can disorient; confirm framing with the DP.",
    "Dolly"     : "Dolly moves need a rehearsal take — budget at least 2 takes.",
    "Steadicam" : "Steadicam requires operator warm-up; expect 2–3 takes minimum.",
}

_TAKE_WARN = 5   # warn if >= this many takes logged


def load_model() -> dict | None:
    """Return the pickled model bundle, or None if not yet trained."""
    if not os.path.exists(MODEL_PATH):
        return None
    with open(MODEL_PATH, "rb") as f:
        return pickle.load(f)


def predict_shot(model: dict | None, shot_data: dict) -> str:
    """
    Predict a status recommendation for the given shot_data dict.

    shot_data keys used:
        shotSize, cameraAngle, movement, takes (list)
    """
    movement  = shot_data.get("movement", "Static")
    num_takes = len(shot_data.get("takes", []))

    # ── ML path ───────────────────────────────────────────────────────────────
    if model is not None:
        try:
            ss  = model["shot_size_map"].get(shot_data.get("shotSize", ""), 1)
            ca  = model["camera_angle_map"].get(shot_data.get("cameraAngle", ""), 0)
            mv  = model["movement_map"].get(movement, 0)
            X   = np.array([[ss, ca, mv, num_takes]], dtype=float)
            idx = model["classifier"].predict(X)[0]
            label = model["label_encoder"].inverse_transform([idx])[0]

            extra = ""
            if num_takes >= _TAKE_WARN:
                extra = f"  ⚠ {num_takes} takes logged — consider a different approach."

            return f"ML suggests: {label}.{extra}"

        except Exception as exc:         # pragma: no cover
            # Fall through to rule-based if anything goes wrong
            pass

    # ── Rule-based fallback ───────────────────────────────────────────────────
    if num_takes >= _TAKE_WARN:
        return (f"⚠ {num_takes} takes logged — review footage before continuing. "
                "Consider marking as No Good and resetting.")

    if movement in _RULES:
        return _RULES[movement]

    return "Looking good — standard shot, no special flags."
