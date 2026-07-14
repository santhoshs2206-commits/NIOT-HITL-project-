# Underwater HITL Annotation Platform - Frontend

This is the React + TypeScript + Vite frontend application for the **Human-in-the-Loop (HITL) Underwater Object Detection Annotation Platform**.

---

## Tech Stack

- **Build System**: Vite + TypeScript
- **State Management / APIs**: TanStack React Query + Axios
- **Canvas Rendering**: Fabric.js
- **Styling**: Tailwind CSS
- **Routing**: React Router DOM (v6)
- **Linting & Formatting**: ESLint + Prettier

---

## Getting Started

### 1. Requirements
Ensure you have Node.js (v20+ / LTS) installed.

### 2. Install Dependencies
Run from the `frontend/` directory:
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file in the `frontend/` directory (already preconfigured during initial setup):
```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_APP_NAME=Underwater HITL Annotation Platform
VITE_REQUEST_TIMEOUT=10000
```

### 4. Running the Development Server
```bash
npm run dev
```

### 5. Running the Linter
```bash
npm run lint
```
