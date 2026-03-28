# Indie Film Shot Tracker — Design Principles

The Indie Film Shot Tracker is designed to provide a highly functional, non-distracting, and intuitive interface for use on active film sets. The core design philosophy centers around high contrast, rapid data entry, and a professional "equipment-like" aesthetic.

## 1. Aesthetic: Industrial / Cinematic Dark
- **Concept:** The application mimics the interface of professional cinema cameras, digital slates, and onset monitors. 
- **Environment Context:** Built primarily for dark environments (sets, stages, night shoots) to minimize eye strain and screen glare.
- **Visual Texture:** Uses subtle background patterns (like the repeating linear gradient) to provide a tactile, utilitarian feel rather than a flat, corporate web app look.

## 2. Typography System
Typography is strictly allocated to separate data from structure:
- **`Share Tech Mono` (Monospace):** Used exclusively for technical data, counters (Shots, Scenes, Remaining Time), and specific labels. It evokes digital readouts and ensures numbers align perfectly.
- **`Barlow Condensed`:** Used for panel headers, field labels, and button text. It is space-efficient, allowing more information to fit on screen without feeling cramped.
- **`Barlow` (Sans-Serif):** The workhorse font for general UI text, user inputs, and notes, prioritizing readability.

## 3. Color Palette & Status Indicators
Colors are used sparingly and entirely for semantic meaning and hierarchy:
- **Backgrounds:** Deep, neutral darks (`#0d0e10`, `#13151a`, `#1a1d24`) form the base to let content stand out.
- **Primary Accent (`Amber` - `#e8c840`):** Used for primary actions (Log Shot), highlights, and active elements. It provides excellent contrast against the dark background without the harshness of pure white.
- **Semantic Status Colors:**
  - `Amber` (Pending): Indicates action is required.
  - `Blue Roll` (Rolling): Indicates active recording or shooting.
  - `Green OK` (Printed): Indicates a successful take, moving forward.
  - `Red Hot` (No Good): Indicates a failed take or critical alert (like the REC indicator).

## 4. Layout & Information Architecture
- **Split-Screen Dashboard:** The UI is divided into two primary zones:
  - **Left (Action):** The "New Shot" form is pinned for rapid, continuous data entry.
  - **Right (Review):** The "Shot Log" dashboard provides immediate visual feedback and filtering of the day's progress.
- **Role-Based Visibility:** The interface dynamically adapts based on the selected role (Director, AD, Camera), hiding irrelevant fields to reduce cognitive load for specific crew members.

## 5. Interactivity & Micro-interactions
- **Immediate Feedback:** Subtle animations (e.g., the pulsing REC dot, fade/slide animations for new takes and cards) provide assurance that the system is responding without being distracting.
- **Tactile Inputs:** Form controls use custom styling (`.fc-custom`) with distinct focus states (amber glow) to make navigating the form via keyboard or touch feel precise and responsive.
- **Smart Assistance:** ML Hints are presented inline as unobtrusive suggestions, augmenting the user's workflow rather than interrupting it.
