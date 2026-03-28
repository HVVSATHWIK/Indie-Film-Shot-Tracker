from flask import Flask, render_template, request, jsonify, Response, session, redirect, url_for, g
from datetime import datetime
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import sys
import os

# Make the model/ directory importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "model"))

from predict import load_model, predict_shot  # noqa: E402

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "shot-tracker-dev-secret")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

BASE_DIR = os.path.dirname(__file__)
INSTANCE_DIR = os.path.join(BASE_DIR, "instance")
if not os.environ.get("VERCEL"):
    os.makedirs(INSTANCE_DIR, exist_ok=True)

DB_PATH = "/tmp/shot_tracker.db" if os.environ.get("VERCEL") else os.path.join(INSTANCE_DIR, "shot_tracker.db")

# Load the ML model once at startup (returns None gracefully if pkl missing)
model = load_model()


# ── SQLite auth helpers ──────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('director', 'ad', 'camera')),
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
@login_required
def index():
    return render_template("index.html", user=session.get("username"), role=session.get("role", "director"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        if not username or not password:
            return render_template("login.html", error="Username and password are required.")

        user = get_db().execute(
            "SELECT id, username, password_hash, role FROM users WHERE username = ?",
            (username,),
        ).fetchone()

        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["role"] = user["role"]
            return redirect(url_for("index"))

        # Debug: print why login failed
        import logging
        logging.warning(f"Login failed for user '{username}'. User exists: {bool(user)}")
        return render_template("login.html", error="Invalid credentials. Try again.")

    return render_template("login.html")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        role = (request.form.get("role") or "director").strip().lower()

        if role not in {"director", "ad", "camera"}:
            role = "director"

        if len(username) < 3:
            return render_template("signup.html", error="Username must be at least 3 characters.")

        if len(password) < 6:
            return render_template("signup.html", error="Password must be at least 6 characters.")

        try:
            cur = get_db().execute(
                """
                INSERT INTO users (username, password_hash, role, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (username, generate_password_hash(password), role, datetime.utcnow().isoformat()),
            )
            get_db().commit()
        except sqlite3.IntegrityError:
            return render_template("signup.html", error="Username already exists.")

        session.clear()
        session["user_id"] = cur.lastrowid
        session["username"] = username
        session["role"] = role
        return redirect(url_for("index"))

    return render_template("signup.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/predict", methods=["POST"])
@login_required
def predict():
    """
    Accepts shot metadata JSON, returns a simple ML-powered suggestion.
    Falls back to a rule-based hint if model.pkl is not yet trained.
    """
    data       = request.get_json(force=True)
    suggestion = predict_shot(model, data)
    return jsonify({"suggestion": suggestion})


@app.route("/export", methods=["POST"])
@login_required
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
            lines.append(f"    Priority : {shot.get('priority', 'Medium')}")

            target_date = shot.get("targetDate", "")
            if target_date:
                lines.append(f"    Target   : {target_date}")

            depends_on = shot.get("dependsOnCode", "")
            if depends_on:
                lines.append(f"    Depends  : {depends_on}")

            location_name = shot.get("locationName", "")
            location_lat = shot.get("locationLat")
            location_lng = shot.get("locationLng")
            if location_name:
                lines.append(f"    Location : {location_name}")
            if location_lat is not None and location_lng is not None:
                lines.append(f"    Coords   : {location_lat}, {location_lng}")

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


init_db()


if __name__ == "__main__":
    app.run(debug=True)
