from flask import Flask, render_template, request, jsonify, Response, session, redirect, url_for
from datetime import datetime
import json
import sys
import os

# Make the model/ directory importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "model"))

from predict import load_model, predict_shot  # noqa: E402

app = Flask(__name__)
app.secret_key = "shot-tracker-secret-key"  # Required for sessions

# Path to our simple JSON "database"
USERS_FILE = os.path.join(os.path.dirname(__file__), "users.json")

def load_users():
    if not os.path.exists(USERS_FILE):
        return []
    with open(USERS_FILE, "r") as f:
        return json.load(f).get("users", [])

def save_users(users):
    with open(USERS_FILE, "w") as f:
        json.dump({"users": users}, f, indent=2)

# Load the ML model once at startup (returns None gracefully if pkl missing)
model = load_model()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if "user_id" not in session:
        return redirect(url_for("login"))
    return render_template("index.html", user=session.get("username"), role=session.get("role"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        
        users = load_users()
        user = next((u for u in users if u["username"] == username and u["password"] == password), None)
        
        if user:
            session["user_id"] = user["username"]
            session["username"] = user["username"]
            session["role"] = user["role"]
            return redirect(url_for("index"))
        return render_template("login.html", error="Invalid credentials. Try again.")
        
    return render_template("login.html")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        role = request.form.get("role", "director")
        
        users = load_users()
        if any(u["username"] == username for u in users):
            return render_template("signup.html", error="Username already exists!")
            
        users.append({"username": username, "password": password, "role": role})
        save_users(users)
        
        session["user_id"] = username
        session["username"] = username
        session["role"] = role
        return redirect(url_for("index"))
        
    return render_template("signup.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/predict", methods=["POST"])
def predict():
    """
    Accepts shot metadata JSON, returns a simple ML-powered suggestion.
    Falls back to a rule-based hint if model.pkl is not yet trained.
    """
    data       = request.get_json(force=True)
    suggestion = predict_shot(model, data)
    return jsonify({"suggestion": suggestion})


@app.route("/export", methods=["POST"])
def export_call_sheet():
    """
    Receives the full IndexedDB shot list from the browser,
    formats it as a plain-text Daily Call Sheet and returns it
    as a downloadable .txt file.
    """
    data         = request.get_json(force=True)
    shots        = data.get("shots", [])
    project_name = data.get("projectName", "Main Unit")
    role_view    = data.get("roleView", "director")

    lines = []
    lines.append("=" * 60)
    lines.append("  INDIE FILM SHOT TRACKER — DAILY CALL SHEET")
    lines.append(f"  Generated: {datetime.now().strftime('%Y-%m-%d  %H:%M:%S')}")
    lines.append(f"  Project  : {project_name}")
    lines.append(f"  Role View: {role_view}")
    lines.append("=" * 60)

    scenes = {}
    for shot in shots:
        scene = shot.get("scene", "Unknown Scene")
        scenes.setdefault(scene, []).append(shot)

    for scene, scene_shots in sorted(scenes.items()):
        scene_shots = sorted(scene_shots, key=lambda s: s.get("order", 0))
        lines.append(f"\n{'─' * 60}")
        lines.append(f"  SCENE: {scene}")
        lines.append(f"{'─' * 60}")

        for i, shot in enumerate(scene_shots, 1):
            lines.append(f"\n  Shot {i}: {shot.get('shotName', 'Untitled')}")
            code = shot.get("shotCode", "")
            if code:
                lines.append(f"    Code     : {code}")
            lines.append(f"    Size     : {shot.get('shotSize', '—')}")
            lines.append(f"    Angle    : {shot.get('cameraAngle', '—')}")
            lines.append(f"    Movement : {shot.get('movement', '—')}")
            setup_min = shot.get("estimatedSetupMin", 0)
            shoot_min = shot.get("estimatedShootMin", 0)
            total_min = shot.get("estimatedTotalMin", 0)
            lines.append(f"    Time Est : setup {setup_min}m + shoot {shoot_min}m = {total_min}m")

            notes = shot.get("directorNotes", "").strip()
            if notes:
                lines.append(f"    Notes    : {notes}")

            takes = shot.get("takes", [])
            if takes:
                lines.append("    Takes    :")
                for take in takes:
                    lines.append(f"      • {take}")

            lines.append(f"    Status   : {shot.get('status', 'Pending')}")

    lines.append(f"\n{'=' * 60}")
    lines.append(f"  TOTAL SHOTS  : {len(shots)}")
    lines.append(f"  TOTAL SCENES : {len(scenes)}")
    lines.append(f"{'=' * 60}\n")

    content = "\n".join(lines)
    return Response(
        content,
        mimetype="text/plain",
        headers={"Content-Disposition": "attachment; filename=call_sheet.txt"},
    )


if __name__ == "__main__":
    app.run(debug=True)
