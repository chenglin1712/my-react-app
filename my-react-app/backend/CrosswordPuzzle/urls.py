from django.urls import path
from . import views

urlpatterns = [
    path('generate/', views.generate_crossword, name='generate_crossword'),
    path('submit/' , views.submit_ans,name='submit_ans'),

]