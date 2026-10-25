from django.test import SimpleTestCase

from config.db_url import sqlalchemy_url


class SqlalchemyUrlTests(SimpleTestCase):
    def test_platform_postgres_scheme_becomes_psycopg2(self):
        self.assertEqual(sqlalchemy_url("postgres://u:p@h:5432/db"), "postgresql+psycopg2://u:p@h:5432/db")

    def test_plain_postgresql_scheme_gets_explicit_driver(self):
        self.assertEqual(sqlalchemy_url("postgresql://u:p@h/db?sslmode=require"), "postgresql+psycopg2://u:p@h/db?sslmode=require")

    def test_explicit_driver_is_left_alone(self):
        self.assertEqual(sqlalchemy_url("postgresql+psycopg://u:p@h/db"), "postgresql+psycopg://u:p@h/db")

    def test_sqlite_and_empty_values_are_left_alone(self):
        self.assertEqual(sqlalchemy_url("sqlite:///x.db"), "sqlite:///x.db")
        self.assertIsNone(sqlalchemy_url(None))
        self.assertEqual(sqlalchemy_url(""), "")
