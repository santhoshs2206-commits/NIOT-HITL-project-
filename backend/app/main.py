import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import videos

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("underwater-hitl-backend")

app = FastAPI(
    title="Human-in-the-Loop Underwater Object Detection Training API",
    description="Backend API for managing video frames and annotations to create custom YOLO datasets.",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production for specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(videos.router)

@app.get("/")
async def root():
    """
    Root health check endpoint.
    """
    logger.info("Health check endpoint accessed")
    return {
        "status": "healthy",
        "project": "Human-in-the-Loop Underwater Object Detection Training",
        "phase": 1,
        "docs_url": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
