from django.urls import path
from .views import tayal_chat, tayal_chat_stream, review_tayal_chat, ai_quota

urlpatterns = [
    path('tayal_chat/', tayal_chat),
    path('tayal_chat/stream/', tayal_chat_stream),
    path('review_tayal_chat/', review_tayal_chat),
    path('quota/', ai_quota),
]
