# Indie Film Shot Tracker

A full-stack Flask application for tracking film shots, managing takes, and generating daily call sheets. Designed for indie filmmakers.

## Features
- **SQLite Auth**: Signup/login/logout with hashed passwords and role-based sessions.
- **Shot Tracking**: Log shot metadata (size, angle, movement, etc.)
- **Take Management**: Record multiple takes for each shot.
- **ML Integration**: Simple ML-powered shot suggestions (using `scikit-learn`).
- **Assignment Notifications**: Director assignments surface in a top notification tray.
- **Advanced Planning**: Set shot priority, target dates, and dependency blockers.
- **Map Location Picker**: Search or click map to pin shot locations (OpenStreetMap + Leaflet).
- **Operations Analytics**: Live completion, blocked, overdue, and high-priority-open metrics.
- **Call Sheet Export**: Generate and download plain-text daily call sheets.
- **Deployment**: Ready for Vercel deployment.

## Local Setup

### 1. Prerequisites
- **Python 3.x**: Ensure Python is installed. Check with `python --version`.

### 2. Configure Environment (Recommended)
Create and activate a Virtual Environment to keep dependencies isolated:
```bash
# Create
python -m venv venv

# Activate (Windows)
.\venv\Scripts\activate

# Activate (macOS/Linux)
source venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Run the Application
```bash
python app.py
```
Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

## Deployment

This project is pre-configured for **Vercel** (`vercel.json`).
1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` for a preview or `vercel --prod` for production.

### Important Persistence Note
- User accounts use SQLite.
- On Vercel, SQLite storage is ephemeral (`/tmp`) and may reset between cold starts.
- For durable production auth, prefer a persistent DB host or deploy on a platform with persistent disk.
