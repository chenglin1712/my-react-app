from django.urls import path
from .views import get_quiz_data, get_tayal_imformation, get_exam_schedule

urlpatterns = [
    path('', get_quiz_data),
    path('news/',get_tayal_imformation),
    path('exam_schedule/', get_exam_schedule),
]
