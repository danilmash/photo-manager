from fastapi import FastAPI

app = FastAPI(title="Photo Archive Skeleton")

@app.get("/")
async def root():
    return {"status": "Backend is online", "message": "Ready for architecture design"}