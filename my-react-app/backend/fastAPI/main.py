from fastapi import FastAPI
from .routes import crawler, vision, dictionary, quiz
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(crawler.router, prefix="/crawler")
app.include_router(vision.router, prefix="/vision")
app.include_router(dictionary.router, prefix="/dictionary")
app.include_router(quiz.router, prefix="/quiz")

