from django.urls import path
from .views import tayal_chat, tayal_chat_stream, review_tayal_chat, review_question, replan_study_plan, ai_quota, ai_feedback
from .memory_views import learner_memory, learner_memory_consent, learner_memory_file

urlpatterns = [
    path('tayal_chat/', tayal_chat),
    path('tayal_chat/stream/', tayal_chat_stream),
    path('review_tayal_chat/', review_tayal_chat),
    path('review_question/', review_question),
    path('replan_study_plan/', replan_study_plan),
    path('quota/', ai_quota),
    path('feedback/', ai_feedback),
    path('memory/', learner_memory),
    path('memory/consent/', learner_memory_consent),
    path('memory/file/', learner_memory_file),
]
