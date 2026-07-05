from django.urls import path
from .views import tayal_chat, review_tayal_chat

urlpatterns = [
    path('tayal_chat/', tayal_chat),
    path('review_tayal_chat/', review_tayal_chat)
]
