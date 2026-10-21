from django.urls import path
from .views import tayal_chat, review_tayal_chat, ai_quota

urlpatterns = [
    path('tayal_chat/', tayal_chat),
    path('review_tayal_chat/', review_tayal_chat),
    path('quota/', ai_quota),
]
