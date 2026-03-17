from django.urls import path
from .views import get_quiz_data, get_tayal_imformation

urlpatterns = [
    path('', get_quiz_data),
    path('news/',get_tayal_imformation)
]
