from django.urls import path

from . import views

urlpatterns = [
    path('announcements/', views.announcement_list),
    path('announcements/<int:pk>/', views.announcement_detail),
    path('announcements/<int:pk>/submit/', views.announcement_submit),
    path('announcements/<int:pk>/withdraw/', views.announcement_withdraw),
    path('announcements/<int:pk>/approve/', views.announcement_approve),
    path('announcements/<int:pk>/reject/', views.announcement_reject),
    path('announcements/<int:pk>/unpublish/', views.announcement_unpublish),
    path('announcements/<int:pk>/republish/', views.announcement_republish),
    path('audit-log/', views.audit_log_list),
    path('public/announcements/', views.public_announcement_list),
    path('exam-schedule/', views.exam_schedule_admin),
    path('exam-schedule/overrides/<str:phase>/', views.exam_schedule_override_detail),
    path('homepage-config/', views.homepage_config_admin),
    path('public/homepage-config/', views.public_homepage_config),
]
