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
]
