from django.urls import path

from . import quizbank_views, views


def _content_urls(prefix, content_views):
    """QuizVocabItem／QuizClozePassage／QuizSituationItem 三種內容的路由
    形狀完全一樣，用這個小工廠避免複製貼上 7 條路由 x 3 次。"""
    return [
        path(f'{prefix}/', content_views["list"]),
        path(f'{prefix}/<int:pk>/', content_views["detail"]),
        path(f'{prefix}/<int:pk>/submit/', content_views["submit"]),
        path(f'{prefix}/<int:pk>/withdraw/', content_views["withdraw"]),
        path(f'{prefix}/<int:pk>/approve/', content_views["approve"]),
        path(f'{prefix}/<int:pk>/reject/', content_views["reject"]),
        path(f'{prefix}/<int:pk>/unpublish/', content_views["unpublish"]),
    ]


urlpatterns = [
    path('announcements/', views.announcement_list),
    path('announcements/<int:pk>/', views.announcement_detail),
    path('announcements/<int:pk>/submit/', views.announcement_submit),
    path('announcements/<int:pk>/withdraw/', views.announcement_withdraw),
    path('announcements/<int:pk>/approve/', views.announcement_approve),
    path('announcements/<int:pk>/reject/', views.announcement_reject),
    path('announcements/<int:pk>/unpublish/', views.announcement_unpublish),
    path('announcements/<int:pk>/republish/', views.announcement_republish),
    path('announcements/sync-crawler/', views.announcement_sync_crawler),
    path('audit-log/', views.audit_log_list),
    path('public/announcements/', views.public_announcement_list),
    path('exam-schedule/', views.exam_schedule_admin),
    path('exam-schedule/overrides/<str:phase>/', views.exam_schedule_override_detail),
    path('homepage-config/', views.homepage_config_admin),
    path('public/homepage-config/', views.public_homepage_config),
    *_content_urls('quiz-bank/vocab', quizbank_views.quiz_vocab_views),
    *_content_urls('quiz-bank/cloze', quizbank_views.quiz_cloze_views),
    *_content_urls('quiz-bank/situations', quizbank_views.quiz_situation_views),
    *_content_urls('quiz-bank/true-false', quizbank_views.quiz_true_false_views),
    *_content_urls('quiz-bank/choice', quizbank_views.quiz_choice_views),
    path('quiz-bank/sources/', quizbank_views.quiz_source_config_list),
    path('quiz-bank/sources/<str:tribe>/', quizbank_views.quiz_source_config_detail),
    path('irt-config/', quizbank_views.irt_config_admin),
    path('public/irt-config/', quizbank_views.public_irt_config),
]
